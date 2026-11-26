import { PrismaClient } from '@prisma/client';
import logger from '../src/utils/logger';

const prisma = new PrismaClient();

const EXPECTED_INDEXES = [
  { name: 'idx_transaction_user_status_created', columns: ['userId', 'status', 'createdAt'] },
  { name: 'idx_transaction_asset_created', columns: ['assetCode', 'createdAt'] },
  { name: 'idx_transaction_type_asset_created', columns: ['type', 'assetCode', 'createdAt'] },
  { name: 'idx_transaction_status_updated', columns: ['status', 'updatedAt'] },
];

export async function verifyTransactionIndexes(): Promise<{ valid: boolean; results: Record<string, boolean> }> {
  const results: Record<string, boolean> = {};
  let valid = true;

  for (const index of EXPECTED_INDEXES) {
    try {
      const result = await prisma.$queryRaw`
        SELECT 1 FROM pg_indexes
        WHERE indexname = ${index.name}
        LIMIT 1
      `;

      const exists = Array.isArray(result) && result.length > 0;
      results[index.name] = exists;

      if (!exists) {
        logger.warn('Missing expected index', { indexName: index.name, columns: index.columns });
        valid = false;
      } else {
        logger.info('Index verified', { indexName: index.name });
      }
    } catch (err) {
      logger.error('Failed to verify index', { indexName: index.name, error: err });
      results[index.name] = false;
      valid = false;
    }
  }

  return { valid, results };
}

export async function benchmarkQueryPerformance(): Promise<void> {
  const testAccount = 'G'.repeat(56);
  const testAsset = 'USDC';

  // Warm up
  await prisma.transaction.findMany({
    where: { userId: testAccount, status: 'PENDING' },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });

  const iterations = 100;
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    await prisma.transaction.findMany({
      where: { userId: testAccount, status: 'PENDING' },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
  }

  const elapsed = Date.now() - start;
  const avgMs = elapsed / iterations;

  logger.info('Query benchmark completed', { iterations, totalMs: elapsed, avgMs });
}

if (require.main === module) {
  verifyTransactionIndexes()
    .then(({ valid }) => {
      if (!valid) {
        process.exit(1);
      }
    })
    .catch((err) => {
      logger.error('Verification failed', { error: err });
      process.exit(1);
    });
}