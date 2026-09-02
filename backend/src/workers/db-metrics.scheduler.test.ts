import { DbMetricsScheduler } from './db-metrics.scheduler';
import { metricsService } from '../services/metrics.service';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: { $queryRawUnsafe: jest.fn() },
}));

describe('DbMetricsScheduler', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalConnectionLimit = process.env.DB_CONNECTION_LIMIT;

  beforeEach(() => {
    metricsService.reset();
    jest.useFakeTimers();
    process.env.DB_CONNECTION_LIMIT = '20';
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.DB_CONNECTION_LIMIT = originalConnectionLimit;
  });

  it('publishes the configured pool limit even for non-Postgres datasources', async () => {
    process.env.DATABASE_URL = 'file:./prisma/test.db';
    const scheduler = new DbMetricsScheduler();
    scheduler.start();
    scheduler.stop();

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('db_connections_limit');
    expect(metrics).toContain('db_connections_active');
    const limitLine = metrics
      .split('\n')
      .find((line) => line.startsWith('db_connections_limit'));
    expect(limitLine).toMatch(/20$/);
  });

  it('samples active connections from pg_stat_activity on Postgres', async () => {
    process.env.DATABASE_URL = 'postgresql://anchorpoint:secret@postgres:5432/anchorpoint';
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
      { active_connections: 7 },
    ]);

    const scheduler = new DbMetricsScheduler();
    scheduler.start();
    // Let the initial (immediate) sample run.
    await Promise.resolve();
    await Promise.resolve();
    scheduler.stop();

    const metrics = await metricsService.getMetrics();
    const activeLine = metrics
      .split('\n')
      .find((line) => line.startsWith('db_connections_active'));
    expect(activeLine).toMatch(/7$/);
    const limitLine = metrics
      .split('\n')
      .find((line) => line.startsWith('db_connections_limit'));
    expect(limitLine).toMatch(/20$/);
  });

  it('stops sampling when stop() is called', async () => {
    process.env.DATABASE_URL = 'postgresql://anchorpoint:secret@postgres:5432/anchorpoint';
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
      { active_connections: 1 },
    ]);

    const scheduler = new DbMetricsScheduler();
    scheduler.start();
    await Promise.resolve();
    const callsAfterStart = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.length;
    expect(callsAfterStart).toBe(1);

    scheduler.stop();
    const callsAfterStop = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.length;

    // Advance time far past the 15s interval; sampling must not continue.
    jest.advanceTimersByTime(60_000);
    expect((prisma.$queryRawUnsafe as jest.Mock).mock.calls.length).toBe(callsAfterStop);
  });
});
