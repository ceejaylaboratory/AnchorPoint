const mockRotateKeys = jest.fn();
const mockRotateJwtSigningKey = jest.fn();
const mockTask = { stop: jest.fn() };

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    validate: jest.fn().mockReturnValue(true),
    schedule: jest.fn().mockReturnValue(mockTask),
  },
}));

jest.mock('../config/env', () => ({
  config: {
    ENABLE_KEY_ROTATION_WORKER: 'true',
    KEY_ROTATION_WORKER_CRON: '0 0 1 * *',
    KEY_MANAGEMENT_BACKEND: 'aws-kms',
  },
}));

jest.mock('../services/key-rotation.service', () => ({
  KeyRotationService: jest.fn().mockImplementation(() => ({
    rotateKeys: mockRotateKeys,
    rotateJwtSigningKey: mockRotateJwtSigningKey,
  })),
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import cron from 'node-cron';
import { startWorker, stopWorker } from './key-rotation.worker';

describe('key rotation worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (cron.schedule as jest.Mock).mockReturnValue(mockTask);
    (cron.validate as jest.Mock).mockReturnValue(true);
  });

  it('rotates encryption and JWT signing keys on every scheduled tick', async () => {
    mockRotateKeys.mockResolvedValue({ backend: 'aws-kms', rotated: true, message: 'ok' });
    mockRotateJwtSigningKey.mockResolvedValue({
      rotated: true,
      rotatedAt: new Date().toISOString(),
      gracePeriodSeconds: 86400,
      previousKeyRetained: true,
    });

    startWorker();
    expect(cron.schedule).toHaveBeenCalledTimes(1);
    const tick = (cron.schedule as jest.Mock).mock.calls[0][1];
    tick();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRotateKeys).toHaveBeenCalledTimes(1);
    expect(mockRotateJwtSigningKey).toHaveBeenCalledTimes(1);
    stopWorker();
    expect(mockTask.stop).toHaveBeenCalledTimes(1);
  });

  it('still attempts JWT rotation when encryption key rotation fails', async () => {
    mockRotateKeys.mockRejectedValue(new Error('vault unavailable'));
    mockRotateJwtSigningKey.mockResolvedValue({
      rotated: true,
      rotatedAt: new Date().toISOString(),
      gracePeriodSeconds: 86400,
      previousKeyRetained: true,
    });

    startWorker();
    const tick = (cron.schedule as jest.Mock).mock.calls[0][1];
    tick();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRotateJwtSigningKey).toHaveBeenCalledTimes(1);
    stopWorker();
  });
});
