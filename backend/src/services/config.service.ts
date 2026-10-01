import { dynamicConfigSchema, DynamicConfig, initialDynamicConfig, DashboardUiConfig } from '../config/env';
import prisma from '../lib/prisma';
import { redis } from '../lib/redis';
import logger from '../utils/logger';
import { Prisma } from '@prisma/client';
import { adminAuditService, AuditActor } from './admin-audit.service';

const REDIS_CHANNEL = 'CONFIG_UPDATED';

class ConfigService {
  private currentConfig: DynamicConfig;
  private subscriber = redis.duplicate();

  constructor() {
    this.currentConfig = { ...initialDynamicConfig };
    this.setupRedisSubscriber();
  }

  private setupRedisSubscriber() {
    (this.subscriber as any).subscribe(REDIS_CHANNEL, (err: unknown) => {
      if (err) {
        logger.error('Failed to subscribe to config updates:', err);
      }
    });

    this.subscriber.on('message', async (channel: string, message: string) => {
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

  public getUiConfig(): DashboardUiConfig {
    return this.currentConfig.ui;
  }

  public getSep31Config(): DynamicConfig['sep31'] {
    return this.currentConfig.sep31;
  }

  public async getHistory() {
    return prisma.systemConfig.findMany({
      orderBy: { version: 'desc' },
      take: 20,
    });
  }

  public async updateConfig(
    newSettings: unknown,
    actor?: AuditActor,
    action: 'CONFIG_UPDATE' | 'CONFIG_UI_UPDATE' = 'CONFIG_UPDATE'
  ) {
    // Validate the new settings
    const validated = dynamicConfigSchema.parse(newSettings);

    // Snapshot the previous config for the audit diff.
    const previousConfig = this.currentConfig;

    // Run in transaction: unset isActive, insert new config
    const activeConfig = await prisma.systemConfig.findFirst({
      where: { isActive: true },
    });

    const newVersion = (activeConfig?.version || 0) + 1;

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    // Record the change in the immutable admin audit trail (best-effort).
    await adminAuditService.recordConfigChange({
      action,
      actor,
      configVersion: result.version,
      previousVersion: activeConfig?.version ?? null,
      before: previousConfig as unknown as Record<string, unknown>,
      after: validated as unknown as Record<string, unknown>,
    });

    // Notify other instances
    await redis.publish(REDIS_CHANNEL, result.version.toString());

    return result;
  }

  public async updateUiConfig(uiSettings: unknown, actor?: AuditActor) {
    const nextConfig = {
      ...this.currentConfig,
      ui: {
        ...this.currentConfig.ui,
        ...(uiSettings as Record<string, unknown>),
        fieldRequirements: {
          ...this.currentConfig.ui.fieldRequirements,
          ...((uiSettings as { fieldRequirements?: Record<string, unknown> })?.fieldRequirements ?? {}),
        },
      },
    };

    return this.updateConfig(nextConfig, actor, 'CONFIG_UI_UPDATE');
  }

  public async rollbackToVersion(version: number, actor?: AuditActor) {
    const targetConfig = await prisma.systemConfig.findUnique({
      where: { version },
    });

    if (!targetConfig) {
      throw new Error(`Configuration version ${version} not found`);
    }

    const parsed = dynamicConfigSchema.parse(JSON.parse(targetConfig.settings));

    const previousConfig = this.currentConfig;

    const activeConfig = await prisma.systemConfig.findFirst({
      where: { isActive: true },
    });

    const newVersion = (activeConfig?.version || 0) + 1;

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    // Record the rollback in the audit trail (best-effort).
    await adminAuditService.recordConfigChange({
      action: 'CONFIG_ROLLBACK',
      actor,
      configVersion: result.version,
      previousVersion: activeConfig?.version ?? null,
      before: previousConfig as unknown as Record<string, unknown>,
      after: parsed as unknown as Record<string, unknown>,
      metadata: { rolledBackToVersion: version },
    });

    // Notify other instances
    await redis.publish(REDIS_CHANNEL, result.version.toString());

    return result;
  }
}

export const configService = new ConfigService();
export default configService;
