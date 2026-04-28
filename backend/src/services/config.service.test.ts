import { configService } from './config.service';
import prisma from '../lib/prisma';
import { redis } from '../lib/redis';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    systemConfig: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/redis', () => {
  const mockSubscriber = {
    subscribe: jest.fn(),
    on: jest.fn(),
  };
  return {
    redis: {
      duplicate: jest.fn().mockReturnValue(mockSubscriber),
      publish: jest.fn(),
    },
  };
});

describe('ConfigService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should seed database on initialization if no config exists', async () => {
    (prisma.systemConfig.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.systemConfig.create as jest.Mock).mockResolvedValue({ version: 1 });

    await configService.initialize();

    expect(prisma.systemConfig.findFirst).toHaveBeenCalled();
    expect(prisma.systemConfig.create).toHaveBeenCalled();
  });

  it('should load active configuration from database', async () => {
    const mockConfig = {
      version: 2,
      settings: JSON.stringify({
        JWT_SECRET: 'test-secret-value',
        INTERACTIVE_URL: 'http://test.local',
        WEBHOOK_TIMEOUT_MS: 1000,
        WEBHOOK_MAX_RETRIES: 1,
        WEBHOOK_RETRY_DELAY_MS: 100
      })
    };
    (prisma.systemConfig.findFirst as jest.Mock).mockResolvedValue(mockConfig);

    await configService.initialize();

    const config = configService.getConfig();
    expect(config.JWT_SECRET).toBe('test-secret-value');
    expect(config.INTERACTIVE_URL).toBe('http://test.local');
  });

  it('should update configuration and publish to Redis', async () => {
    const newSettings = {
      JWT_SECRET: 'new-secret-value',
      INTERACTIVE_URL: 'http://new.local',
      WEBHOOK_TIMEOUT_MS: 2000,
      WEBHOOK_MAX_RETRIES: 2,
      WEBHOOK_RETRY_DELAY_MS: 200
    };

    (prisma.systemConfig.findFirst as jest.Mock).mockResolvedValue({ id: 'old-id', version: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
      return cb(prisma);
    });
    (prisma.systemConfig.create as jest.Mock).mockResolvedValue({ version: 2, settings: JSON.stringify(newSettings) });

    await configService.updateConfig(newSettings);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.systemConfig.update).toHaveBeenCalledWith({
      where: { id: 'old-id' },
      data: { isActive: false },
    });
    expect(prisma.systemConfig.create).toHaveBeenCalled();
    expect(redis.publish).toHaveBeenCalledWith('CONFIG_UPDATED', '2');
    
    expect(configService.getConfig().JWT_SECRET).toBe('new-secret-value');
  });
});
