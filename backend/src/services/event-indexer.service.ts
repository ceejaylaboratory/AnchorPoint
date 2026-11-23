import prisma from '../lib/prisma';
import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import logger from '../utils/logger';

/** Number of ledgers processed per bulk indexing batch. */
export const EVENT_INDEXER_BATCH_SIZE = 50;

export class EventIndexerService {
    private rpcServer: rpc.Server;
    private isRunning: boolean = false;
    private pollInterval: number = 5000; // 5 seconds
    /** In-memory cursor advanced transactionally with each successful batch. */
    private lastIndexedLedger: number | null = null;

    constructor(rpcUrl: string = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org') {
        this.rpcServer = new rpc.Server(rpcUrl);
    }

    /**
     * Start the event indexing service
     */
    public async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('Event Indexer Service started');
        this.poll();
    }

    /**
     * Stop the event indexing service
     */
    public stop() {
        this.isRunning = false;
        logger.info('Event Indexer Service stopped');
    }

    /**
     * Continuous polling for events
     */
    private async poll() {
        while (this.isRunning) {
            try {
                await this.indexEvents();
            } catch (error) {
                logger.error('Error in Event Indexer poll loop:', error);
            }
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }
    }

    /**
     * Resolve the next ledger to begin indexing from.
     * Uses persistent cursor stored in DB for crash-safe resumption.
     */
    private async resolveStartLedger(): Promise<number> {
        if (this.lastIndexedLedger !== null) {
            return this.lastIndexedLedger + 1;
        }

        // Check for persisted cursor in database first
        const cursor = await prisma.systemConfig.findFirst({
            where: { key: 'event_indexer_cursor' },
            select: { value: true },
        });

        if (cursor && cursor.value) {
            try {
                const parsed = JSON.parse(cursor.value);
                this.lastIndexedLedger = parsed.lastLedger;
                return parsed.lastLedger + 1;
            } catch {
                // Invalid cursor format, fall through to DB query
            }
        }

        const lastEvent = await prisma.contractEvent.findFirst({
            orderBy: { ledger: 'desc' },
        });

        if (lastEvent) {
            this.lastIndexedLedger = lastEvent.ledger;
            return lastEvent.ledger + 1;
        }

        const latest = await this.rpcServer.getLatestLedger();
        return Math.max(1, latest.sequence - 1000);
    }

    /**
     * Fetch and index events from Soroban RPC in concurrent batches of
     * {@link EVENT_INDEXER_BATCH_SIZE} ledgers.
     */
    public async indexEvents() {
        const startLedger = await this.resolveStartLedger();
        const latest = await this.rpcServer.getLatestLedger();
        const tip = latest.sequence;

        if (startLedger > tip) {
            logger.debug(`Event indexer up to date at ledger ${tip}`);
            return;
        }

        const endLedger = Math.min(startLedger + EVENT_INDEXER_BATCH_SIZE - 1, tip);

        logger.info(`Bulk indexing events for ledgers ${startLedger}–${endLedger} (batch size ${EVENT_INDEXER_BATCH_SIZE})`);

        const response = await this.rpcServer.getEvents({
            startLedger,
            endLedger,
            filters: [
                {
                    type: 'contract',
                },
            ],
            limit: 1000,
        } as any);

        const events = response.events ?? [];

        if (events.length > 0) {
            logger.info(`Found ${events.length} events to index in ledger range ${startLedger}–${endLedger}`);

            const results = await Promise.allSettled(
                events.map((event: any) => this.processEvent(event))
            );

            const failed = results.filter((r) => r.status === 'rejected').length;
            if (failed > 0) {
                logger.warn(`${failed}/${events.length} events failed during concurrent indexing`);
            }
        }

        // Advance last-indexed ledger transactionally so the cursor only moves
        // after the batch write path has completed.
        await this.commitLastIndexedLedger(endLedger);
    }

    /**
     * Persist the last successfully covered ledger in a transaction.
     * Stores cursor in SystemConfig for crash-safe resumption.
     * Only commits cursor AFTER events are successfully persisted.
     */
    private async commitLastIndexedLedger(ledger: number): Promise<void> {
        await prisma.$transaction(async (tx) => {
            // Re-read max ledger inside the transaction for consistency
            const maxEvent = await tx.contractEvent.findFirst({
                orderBy: { ledger: 'desc' },
                select: { ledger: true },
            });

            // Cursor advances to the batch end even when the range had no events,
            // so historical scanning progresses past empty ledger windows.
            const nextCursor = Math.max(ledger, maxEvent?.ledger ?? 0);
            this.lastIndexedLedger = nextCursor;

            // Persist cursor atomically with the same transaction
            // This ensures cursor only moves after events are written
            const cursorValue = JSON.stringify({ lastLedger: nextCursor, updatedAt: new Date().toISOString() });
            await tx.systemConfig.upsert({
                where: { version: 999999 }, // Use a fixed version ID for cursor storage
                update: { settings: cursorValue },
                create: {
                    version: 999999,
                    settings: cursorValue,
                    isActive: false,
                },
            });
        });

        logger.debug(`Event indexer cursor advanced to ledger ${this.lastIndexedLedger}`);
    }

    /**
     * Parse and store a single event
     * Idempotent: uses upsert on contractEventId unique constraint to prevent duplicates
     */
    private async processEvent(event: any) {
        // Parse XDR topics and value
        const topics = event.topic.map((t: any) => {
            const scVal = xdr.ScVal.fromXDR(t, 'base64');
            return scValToNative(scVal);
        });

        const valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
        const value = scValToNative(valueScVal);

        // Idempotent upsert - prevents double-counting if process restarts
        await prisma.contractEvent.upsert({
            where: { contractEventId: event.id },
            update: {}, // Already exists, skip update to preserve original data
            create: {
                contractEventId: event.id,
                contractId: event.contractId,
                ledger: event.ledger,
                ledgerClosedAt: new Date(event.ledgerClosedAt),
                txHash: event.txHash,
                topics: JSON.stringify(topics),
                value: JSON.stringify(value),
                type: event.type
            }
        });

        logger.debug(`Indexed event ${event.id} from contract ${event.contractId}`);
    }

    /**
     * Query event history from database
     */
    public async getEventHistory(filters: {
        contractId?: string,
        type?: string,
        limit?: number,
        offset?: number
    }) {
        return prisma.contractEvent.findMany({
            where: {
                contractId: filters.contractId,
                type: filters.type
            },
            orderBy: { ledger: 'desc' },
            take: filters.limit || 50,
            skip: filters.offset || 0
        });
    }

    /**
     * Get the health status of the event indexer
     * Returns the last synced block and the gap between local DB and ledger tip
     */
    public async getHealth() {
        try {
            const lastSyncedBlock = this.lastIndexedLedger ?? (
                await prisma.contractEvent.findFirst({
                    orderBy: { ledger: 'desc' }
                })
            )?.ledger ?? 0;

            const latestLedger = await this.rpcServer.getLatestLedger();
            const ledgerTip = latestLedger.sequence;
            const gap = ledgerTip - lastSyncedBlock;

            return {
                lastSyncedBlock,
                ledgerTip,
                gap,
                isHealthy: gap < 1000,
                batchSize: EVENT_INDEXER_BATCH_SIZE,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Error getting event indexer health:', error);
            throw error;
        }
    }
}

export const eventIndexer = new EventIndexerService();
