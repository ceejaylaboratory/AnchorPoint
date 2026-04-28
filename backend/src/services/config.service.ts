import { dynamicConfigSchema, DynamicConfig, initialDynamicConfig } from '../config/env';
import prisma from '../lib/prisma';
import { redis } from '../lib/redis';
import logger from '../utils/logger';

const REDIS_CHANNEL = 'CONFIG_UPDATED';

class ConfigService {
  private currentConfig: DynamicConfig;
  private subscriber = redis.duplicate();

  constructor() {
    this.currentConfig = { ...initialDynamicConfig };
    this.setupRedisSubscriber();
  }

  private setupRedisSubscriber() {
    this.subscriber.subscribe(REDIS_CHANNEL, (err) => {
      if (err) {
        logger.error('Failed to subscribe to config updates:', err);
      }
    });

    this.subscriber.on('message', async (channel, message) => {
      if (channel === REDIS_CHANNEL) {
        logger.info(`Received config update notification (version: ${message}), refreshing...`);
        await this.refreshConfig();
      }
    });
  }

  public async initialize() {
    await this.refreshConfig();
  }

  private async refreshConfig() {
    try {
      const activeConfig = await prisma.systemConfig.findFirst({
        where: { isActive: true },
        orderBy: { version: 'desc' },
      });

      if (activeConfig) {
        try {
          const parsed = JSON.parse(activeConfig.settings);
          this.currentConfig = dynamicConfigSchema.parse(parsed);
          logger.info(`Loaded configuration version ${activeConfig.version}`);
        } catch (e) {
          logger.error('Failed to parse or validate active configuration from DB. Falling back to previous.', e);
        }
      } else {
        // No config in DB, seed it
        logger.info('No active configuration found in DB. Seeding initial configuration...');
        const newConfig = await prisma.systemConfig.create({
          data: {
            version: 1,
            settings: JSON.stringify(this.currentConfig),
            isActive: true,
          },
        });
        logger.info(`Seeded initial configuration version ${newConfig.version}`);
      }
    } catch (error) {
      logger.error('Error refreshing configuration from database:', error);
    }
  }

  public getConfig(): DynamicConfig {
    return this.currentConfig;
  }

  public async getHistory() {
    return prisma.systemConfig.findMany({
      orderBy: { version: 'desc' },
      take: 20,
    });
  }

  public async updateConfig(newSettings: unknown) {
    // Validate the new settings
    const validated = dynamicConfigSchema.parse(newSettings);

    // Run in transaction: unset isActive, insert new config
    const activeConfig = await prisma.systemConfig.findFirst({
      where: { isActive: true },
    });

    const newVersion = (activeConfig?.version || 0) + 1;

    const result = await prisma.$transaction(async (tx) => {
      if (activeConfig) {
        await tx.systemConfig.update({
          where: { id: activeConfig.id },
          data: { isActive: false },
        });
      }

      return tx.systemConfig.create({
        data: {
          version: newVersion,
          settings: JSON.stringify(validated),
          isActive: true,
        },
      });
    });

    this.currentConfig = validated;
    
    // Notify other instances
    await redis.publish(REDIS_CHANNEL, result.version.toString());

    return result;
  }

  public async rollbackToVersion(version: number) {
    const targetConfig = await prisma.systemConfig.findUnique({
      where: { version },
    });

    if (!targetConfig) {
      throw new Error(`Configuration version ${version} not found`);
    }

    const parsed = dynamicConfigSchema.parse(JSON.parse(targetConfig.settings));

    const activeConfig = await prisma.systemConfig.findFirst({
      where: { isActive: true },
    });

    const newVersion = (activeConfig?.version || 0) + 1;

    const result = await prisma.$transaction(async (tx) => {
      if (activeConfig) {
        await tx.systemConfig.update({
          where: { id: activeConfig.id },
          data: { isActive: false },
        });
      }

      return tx.systemConfig.create({
        data: {
          version: newVersion,
          settings: targetConfig.settings, // copy settings from the rolled-back version
          isActive: true,
        },
      });
    });

    this.currentConfig = parsed;
    
    // Notify other instances
    await redis.publish(REDIS_CHANNEL, result.version.toString());

    return result;
  }
}

export const configService = new ConfigService();
export default configService;
