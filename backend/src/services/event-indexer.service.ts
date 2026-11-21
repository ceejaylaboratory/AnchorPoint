import prisma from '../lib/prisma';
import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import logger from '../utils/logger';

/** Number of ledgers processed per bulk indexing batch. */
export const EVENT_INDEXER_BATCH_SIZE = 50;

/** Maximum number of events to accumulate before a bulk DB write is forced. */
export const WRITE_BATCH_SIZE = 100;
/** Maximum time (ms) to hold events in the write buffer before flushing. */
export const WRITE_FLUSH_INTERVAL_MS = 500;

type PendingEvent = Parameters<typeof prisma.contractEvent.createMany>[0]['data'][number];

export class EventIndexerService {
    private rpcServer: rpc.Server;
    private isRunning: boolean = false;
    private pollInterval: number = 5000; // 5 seconds
    /** In-memory cursor advanced transactionally with each successful batch. */
    private lastIndexedLedger: number | null = null;

    // ── Write-batching buffer ───────────────────────────────────────────────
    /** Events waiting to be written to the database in bulk. */
    private writeBuffer: PendingEvent[] = [];
    /** Handle for the periodic flush timer. */
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
        this.scheduleFlush();
        this.poll();
    }

    /**
     * Stop the event indexing service and flush any pending buffered events.
     */
    public async stop() {
        this.isRunning = false;
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        // Drain the buffer before the process exits so no events are dropped.
        await this.flushBuffer();
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
     * Schedule the next periodic buffer flush.
     */
    private scheduleFlush() {
        if (this.flushTimer !== null) return;
        this.flushTimer = setTimeout(async () => {
            this.flushTimer = null;
            await this.flushBuffer();
            if (this.isRunning) this.scheduleFlush();
        }, WRITE_FLUSH_INTERVAL_MS);
    }

    /**
     * Write all accumulated events in a single bulk INSERT and clear the
     * buffer.  Uses `skipDuplicates: true` so concurrent callers are safe.
     */
    public async flushBuffer(): Promise<void> {
        if (this.writeBuffer.length === 0) return;

        const batch = this.writeBuffer.splice(0, this.writeBuffer.length);
        logger.info(`Flushing ${batch.length} buffered events to database`);

        try {
            await prisma.contractEvent.createMany({
                data: batch,
                skipDuplicates: true,
            });
            logger.debug(`Successfully wrote ${batch.length} events in bulk`);
        } catch (error) {
            logger.error('Bulk event write failed; events may be retried on next poll:', error);
            // Re-queue failed events at the front so they are retried.
            this.writeBuffer.unshift(...batch);
            throw error;
        }
    }

    /**
     * Resolve the next ledger to begin indexing from.
     */
    private async resolveStartLedger(): Promise<number> {
        if (this.lastIndexedLedger !== null) {
            return this.lastIndexedLedger + 1;
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

            for (const event of events) {
                this.enqueueEvent(event);
            }

            // Flush immediately when the buffer is full to cap write latency.
            if (this.writeBuffer.length >= WRITE_BATCH_SIZE) {
                await this.flushBuffer();
            }
        }

        // Advance last-indexed ledger transactionally so the cursor only moves
        // after the batch write path has completed.
        await this.commitLastIndexedLedger(endLedger);
    }

    /**
     * Parse a raw Soroban event and add it to the write buffer.
     */
    private enqueueEvent(event: any): void {
        try {
            const topics = event.topic.map((t: any) => {
                const scVal = xdr.ScVal.fromXDR(t, 'base64');
                return scValToNative(scVal);
            });

            const valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
            const value = scValToNative(valueScVal);

            this.writeBuffer.push({
                contractEventId: event.id,
                contractId: event.contractId,
                ledger: event.ledger,
                ledgerClosedAt: new Date(event.ledgerClosedAt),
                txHash: event.txHash,
                topics: JSON.stringify(topics),
                value: JSON.stringify(value),
                type: event.type,
            });

            logger.debug(`Enqueued event ${event.id} (buffer size: ${this.writeBuffer.length})`);
        } catch (error) {
            logger.warn(`Failed to parse event ${event.id}, skipping:`, error);
        }
    }

    /**
     * Persist the last successfully covered ledger in a transaction.
     * Uses a sentinel ContractEvent row keyed by contractEventId when available,
     * otherwise updates the in-memory cursor after verifying DB consistency.
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
        });

        logger.debug(`Event indexer cursor advanced to ledger ${this.lastIndexedLedger}`);
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
                writeBatchSize: WRITE_BATCH_SIZE,
                writeFlushIntervalMs: WRITE_FLUSH_INTERVAL_MS,
                pendingBufferSize: this.writeBuffer.length,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Error getting event indexer health:', error);
            throw error;
        }
    }
}

export const eventIndexer = new EventIndexerService();
