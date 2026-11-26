const mockQueryRaw = jest.fn();
const mockDisconnect = jest.fn();
const mockConnect = jest.fn();
const mockConnectWithRetry = jest.fn();

jest.mock('../lib/prisma', () => ({
  prismaRaw: {
    $queryRaw: mockQueryRaw,
    $disconnect: mockDisconnect,
    $connect: mockConnect,
  },
  connectWithRetry: mockConnectWithRetry,
}));

jest.mock('../services/metrics.service', () => ({
  metricsService: {
    setDbConnectionHealth: jest.fn(),
    incrementDbReconnect: jest.fn(),
    incrementDbHealthcheckFailure: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { DatabaseHealthService } from './database-health.service';
import { metricsService } from './metrics.service';

describe('DatabaseHealthService (#1588)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectWithRetry.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockQueryRaw.mockResolvedValue([{ 1: 1 }]);
  });

  it('reports a successful probe and resets the failure count', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('socket hang up'));
    const service = new DatabaseHealthService(
      {
        $queryRaw: mockQueryRaw,
        $disconnect: mockDisconnect,
        $connect: mockConnect,
      },
      15000,
      2
    );

    await expect(service.check()).resolves.toBe(false);
    await expect(service.check()).resolves.toBe(true);

    expect(service.isHealthy()).toBe(true);
    expect(service.getState().consecutiveFailures).toBe(0);
    expect(service.getState().lastSuccessAt).not.toBeNull();
    expect(metricsService.setDbConnectionHealth).toHaveBeenLastCalledWith(true);
    expect(metricsService.incrementDbHealthcheckFailure).toHaveBeenCalledTimes(1);
  });

  it('recycles the Prisma pool after the configured failure threshold', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection reset by peer'));
    const service = new DatabaseHealthService(
      {
        $queryRaw: mockQueryRaw,
        $disconnect: mockDisconnect,
        $connect: mockConnect,
      },
      15000,
      2
    );

    await service.check();
    expect(mockDisconnect).not.toHaveBeenCalled();

    await service.check();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnectWithRetry).toHaveBeenCalledTimes(1);
    expect(metricsService.incrementDbReconnect).toHaveBeenCalledTimes(1);
    expect(metricsService.incrementDbHealthcheckFailure).toHaveBeenCalledTimes(2);
    expect(service.isHealthy()).toBe(true);
    expect(service.getState().lastReconnectAt).not.toBeNull();
  });

  it('keeps probing on the configured interval and stops cleanly', async () => {
    jest.useFakeTimers();
    const service = new DatabaseHealthService(
      {
        $queryRaw: mockQueryRaw,
        $disconnect: mockDisconnect,
        $connect: mockConnect,
      },
        1000,
        2
    );

    service.start();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);

    service.stop();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
