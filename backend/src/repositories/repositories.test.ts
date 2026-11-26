import {
  MockCustomerRepository,
  MockMigrationRepository,
  MockQuoteRepository,
  MockTransactionRepository,
  PrismaMigrationRepository,
  PrismaTransactionRepository,
  type CustomerRecord,
  type QuoteRecord,
  type TransactionRecord,
} from './index';

const now = new Date('2026-01-01T00:00:00.000Z');

const transaction: TransactionRecord = {
  id: 'tx-1',
  userId: 'user-1',
  assetCode: 'USDC',
  amount: '10',
  type: 'DEPOSIT',
  status: 'PENDING',
  externalId: null,
  stellarTxId: null,
  createdAt: now,
  updatedAt: now,
};

const customer: CustomerRecord = {
  id: 'cust-1',
  userId: 'user-1',
  provider: null,
  providerRef: null,
  status: 'PENDING',
  createdAt: now,
  updatedAt: now,
};

const quote: Omit<QuoteRecord, 'id' | 'createdAt' | 'updatedAt'> = {
  sellAsset: 'USDC',
  sellAmount: '10',
  buyAsset: 'XLM',
  buyAmount: '40',
  price: '4',
  status: 'PENDING',
  expiresAt: null,
};

describe('typed repositories', () => {
  it('keeps transaction reads/writes typed and isolated in the mock', async () => {
    const repository = new MockTransactionRepository([transaction]);

    expect(await repository.findById('tx-1')).toEqual(transaction);
    expect(await repository.findByUserId('user-1')).toHaveLength(1);
    const updated = await repository.updateStatus('tx-1', 'COMPLETED');
    expect(updated.status).toBe('COMPLETED');
    expect((await repository.findById('tx-1'))?.status).toBe('COMPLETED');
    expect(await repository.findById('missing')).toBeNull();
  });

  it('supports customer and quote operations without a database', async () => {
    const customers = new MockCustomerRepository([customer]);
    const quotes = new MockQuoteRepository();

    expect(await customers.findByUserId('user-1')).toEqual(customer);
    expect((await customers.updateStatus('cust-1', 'APPROVED')).status).toBe('APPROVED');
    expect(await customers.findByStatus('APPROVED')).toHaveLength(1);

    const created = await quotes.create(quote);
    expect(await quotes.findById(created.id)).toEqual(created);
    expect(await quotes.findActive()).toHaveLength(1);
    expect((await quotes.updateStatus(created.id, 'EXECUTED')).status).toBe('EXECUTED');
    expect(await quotes.findActive()).toHaveLength(0);
  });

  it('delegates Prisma calls through typed repository methods', async () => {
    const calls: unknown[] = [];
    const delegate = {
      findUnique: async (args: unknown) => {
        calls.push(args);
        return transaction;
      },
      findMany: async () => [transaction],
      update: async () => ({ ...transaction, status: 'COMPLETED' }),
    };
    const repository = new PrismaTransactionRepository(delegate);

    expect((await repository.findById('tx-1'))?.id).toBe('tx-1');
    expect(await repository.findByUserId('user-1')).toHaveLength(1);
    expect((await repository.updateStatus('tx-1', 'COMPLETED')).status).toBe('COMPLETED');
    expect(calls).toEqual([{ where: { id: 'tx-1' } }]);
  });

  it('encapsulates the raw migration query behind a repository', async () => {
    const client = {
      $queryRaw: async <T>() =>
        [{ migration_name: '20260101_init' }] as unknown as T,
    };
    const repository = new PrismaMigrationRepository(client);

    expect(await repository.findAppliedMigrationNames()).toEqual(['20260101_init']);
    expect(await new MockMigrationRepository(['20260101_init']).findAppliedMigrationNames()).toEqual([
      '20260101_init',
    ]);
  });
});
