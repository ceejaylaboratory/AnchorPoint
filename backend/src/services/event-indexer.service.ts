import { PrismaClient } from '@prisma/client';
import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class EventIndexerService {
    private rpcServer: rpc.Server;
    private isRunning: boolean = false;
    private pollInterval: number = 5000; // 5 seconds

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
     * Fetch and index events from Soroban RPC
     */
    public async indexEvents() {
        // Get the last indexed ledger or start from a reasonable default
        const lastEvent = await prisma.contractEvent.findFirst({
            orderBy: { ledger: 'desc' }
        });

        const startLedger = lastEvent ? lastEvent.ledger + 1 : undefined;

        logger.info(`Fetching events from ledger: ${startLedger || 'earliest available'}`);

        // Soroban RPC getEvents call
        // Note: In a real scenario, you'd handle pagination and filters properly
        const response = await this.rpcServer.getEvents({
            startLedger: startLedger,
            filters: [
                {
                    type: 'contract',
                    // Add contract IDs here to filter if needed
                }
            ],
            limit: 100
        });

        if (response.events && response.events.length > 0) {
            logger.info(`Found ${response.events.length} events to index`);

            for (const event of response.events) {
                try {
                    await this.processEvent(event);
                } catch (err) {
                    logger.error(`Failed to process event ${event.id}:`, err);
                }
            }
        }
    }

    /**
     * Parse and store a single event
     */
    private async processEvent(event: rpc.Api.GetEventResponse) {
        // Parse XDR topics and value
        const topics = event.topic.map(t => {
            const scVal = xdr.ScVal.fromXDR(t, 'base64');
            return scValToNative(scVal);
        });

        const valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
        const value = scValToNative(valueScVal);

        // Store in database
        await prisma.contractEvent.upsert({
            where: { contractEventId: event.id },
            update: {},
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
            // Get the last indexed ledger from the database
            const lastEvent = await prisma.contractEvent.findFirst({
                orderBy: { ledger: 'desc' }
            });

            const lastSyncedBlock = lastEvent ? lastEvent.ledger : 0;

            // Get the current ledger tip from the RPC server
            const latestLedger = await this.rpcServer.getLatestLedger();
            const ledgerTip = latestLedger.sequence;

            // Calculate the gap
            const gap = ledgerTip - lastSyncedBlock;

            return {
                lastSyncedBlock,
                ledgerTip,
                gap,
                isHealthy: gap < 1000, // Consider healthy if gap is less than 1000 blocks
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Error getting event indexer health:', error);
            throw error;
        }
    }
}

export const eventIndexer = new EventIndexerService();
