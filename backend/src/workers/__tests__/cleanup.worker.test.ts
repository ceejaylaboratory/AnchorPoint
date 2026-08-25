import { CleanupWorker } from '../cleanup.worker';
import { PrismaClient, Prisma } from '@prisma/client';

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
}));

jest.mock('timers/promises', () => ({ setTimeout: jest.fn().mockResolvedValue(undefined) }));

describe('CleanupWorker', () => {
  let p: any;
  let w: CleanupWorker;
  const c = { host: 'localhost' };

  beforeEach(() => {
    p = {
      session: {
        findMany: jest.fn(),
        deleteMany: jest.fn().mockResolved({ count: 0 }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(p)),
    };
    w = new CleanupWorker(p as any, c);
  });

  afterEach(() => jest.clearAllMocks());

  it('deletes expired sessions in batches of 100 with ordered ids', async () => {
    const b1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const b2 = Array.from({ length: 50 }, (_, i) => ({ id: 101 + i }));
    p.session.findMany.mockResolvedValueOnce(b1).mockResolvedValueOnce(b2).mockResolvedValueOnce([]);

    await w.cleanupExpiredSessions();

    expect(p.session.findMany).toHaveBeenCalledTimes(3);
    expect(p.session.findMany).toHaveBeenNthCalledWith(1, {
      where: { expiresAt: { lt: expect.any(Date) }, id: { gt: 0 } },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
    expect(p.session.deleteMany).toHaveBeenCalledTimes(2);
    expect(p.session.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: b1.map((x:) => x.id) } },
    });
  });

  it('retries on P2034 deadlock error', async () => {
    const b = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const err = new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', meta: {}, clientVersion: 'test' } as any);
    p.session.findMany.mockResolvedValueOnce(b).mockResolvedValueOnce([]);
    p.$transaction.mockRejectedValueOnce(err).mockImplementationOnce(async (fn: any) => fn(p));

    await w.cleanupExpiredSessions();

    expect(p.$transaction).toHaveBeenCalledTimes(2);
  });
});
