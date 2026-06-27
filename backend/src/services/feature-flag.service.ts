import { RedisService } from './redis.service';
import logger from '../utils/logger';

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  rolloutPercentage?: number; // 0-100, for gradual rollout
  targetUsers?: string[]; // User IDs or accounts to target
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureFlagContext {
  userId?: string;
  account?: string;
  customAttributes?: Record<string, string | number | boolean>;
}

/**
 * FeatureFlagService manages feature flags for gradual rollout
 * Supports both Redis and in-memory storage with configuration file fallback
 */
export class FeatureFlagService {
  private readonly REDIS_PREFIX = 'feature_flag:';
  private readonly REDIS_CACHE_KEY = 'feature_flags_all';
  private readonly CACHE_TTL = 300; // 5 minutes
  private inMemoryFlags: Map<string, FeatureFlag> = new Map();

  constructor(
    private redisService?: RedisService,
    private configFlags?: Map<string, FeatureFlag>
  ) {
    if (configFlags) {
      this.inMemoryFlags = new Map(configFlags);
    }
  }

  /**
   * Check if a feature flag is enabled
   * @param flagName - Name of the feature flag
   * @param context - Optional context for evaluating the flag (user, account, etc.)
   * @returns boolean indicating if the flag is enabled for the given context
   */
  async isEnabled(flagName: string, context?: FeatureFlagContext): Promise<boolean> {
    try {
      const flag = await this.getFlag(flagName);

      if (!flag) {
        logger.warn(`Feature flag '${flagName}' not found, defaulting to disabled`);
        return false;
      }

      if (!flag.enabled) {
        return false;
      }

      // Check rollout percentage
      if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
        const rolloutKey = context?.userId || context?.account || 'anonymous';
        if (!this.isWithinRollout(rolloutKey, flagName, flag.rolloutPercentage)) {
          return false;
        }
      }

      // Check target users
      if (flag.targetUsers && flag.targetUsers.length > 0) {
        const contextIdentifier = context?.userId || context?.account;
        if (contextIdentifier && !flag.targetUsers.includes(contextIdentifier)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error(`Error checking feature flag '${flagName}':`, error);
      return false;
    }
  }

  /**
   * Get a specific feature flag
   */
  async getFlag(flagName: string): Promise<FeatureFlag | null> {
    try {
      // Try Redis first
      if (this.redisService) {
        const cachedFlag = await this.redisService.getJSON<FeatureFlag>(
          `${this.REDIS_PREFIX}${flagName}`
        );
        if (cachedFlag) {
          return cachedFlag;
        }
      }

      // Fall back to in-memory config
      if (this.inMemoryFlags.has(flagName)) {
        return this.inMemoryFlags.get(flagName) || null;
      }

      return null;
    } catch (error) {
      logger.error(`Error getting feature flag '${flagName}':`, error);
      return null;
    }
  }

  /**
   * Get all feature flags
   */
  async getAllFlags(): Promise<FeatureFlag[]> {
    try {
      // Try Redis cache first
      if (this.redisService) {
        const cached = await this.redisService.getJSON<FeatureFlag[]>(
          this.REDIS_CACHE_KEY
        );
        if (cached) {
          return cached;
        }
      }

      // Fall back to in-memory config
      const flags = Array.from(this.inMemoryFlags.values());

      // Cache in Redis if available
      if (this.redisService && flags.length > 0) {
        await this.redisService.setJSON(this.REDIS_CACHE_KEY, flags, this.CACHE_TTL);
      }

      return flags;
    } catch (error) {
      logger.error('Error getting all feature flags:', error);
      return [];
    }
  }

  /**
   * Create or update a feature flag
   */
  async setFlag(flagName: string, flag: FeatureFlag): Promise<void> {
    try {
      const now = new Date();
      const flagWithTimestamp: FeatureFlag = {
        ...flag,
        createdAt: flag.createdAt || now,
        updatedAt: now,
      };

      // Update in-memory storage
      this.inMemoryFlags.set(flagName, flagWithTimestamp);

      // Update Redis if available
      if (this.redisService) {
        await this.redisService.setJSON(
          `${this.REDIS_PREFIX}${flagName}`,
          flagWithTimestamp
        );
        // Invalidate cache
        await this.redisService.del(this.REDIS_CACHE_KEY);
      }

      logger.info(`Feature flag '${flagName}' updated`, flagWithTimestamp);
    } catch (error) {
      logger.error(`Error setting feature flag '${flagName}':`, error);
      throw error;
    }
  }

  /**
   * Delete a feature flag
   */
  async deleteFlag(flagName: string): Promise<void> {
    try {
      this.inMemoryFlags.delete(flagName);

      if (this.redisService) {
        await this.redisService.del(`${this.REDIS_PREFIX}${flagName}`);
        // Invalidate cache
        await this.redisService.del(this.REDIS_CACHE_KEY);
      }

      logger.info(`Feature flag '${flagName}' deleted`);
    } catch (error) {
      logger.error(`Error deleting feature flag '${flagName}':`, error);
      throw error;
    }
  }

  /**
   * Enable a feature flag
   */
  async enableFlag(flagName: string): Promise<void> {
    const flag = await this.getFlag(flagName);
    if (flag) {
      flag.enabled = true;
      await this.setFlag(flagName, flag);
    }
  }

  /**
   * Disable a feature flag
   */
  async disableFlag(flagName: string): Promise<void> {
    const flag = await this.getFlag(flagName);
    if (flag) {
      flag.enabled = false;
      await this.setFlag(flagName, flag);
    }
  }

  /**
   * Update rollout percentage for gradual rollout
   */
  async updateRolloutPercentage(flagName: string, percentage: number): Promise<void> {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Rollout percentage must be between 0 and 100');
    }

    const flag = await this.getFlag(flagName);
    if (flag) {
      flag.rolloutPercentage = percentage;
      await this.setFlag(flagName, flag);
    }
  }

  /**
   * Add target users for a feature flag
   */
  async addTargetUsers(flagName: string, userIds: string[]): Promise<void> {
    const flag = await this.getFlag(flagName);
    if (flag) {
      flag.targetUsers = [...new Set([...(flag.targetUsers || []), ...userIds])];
      await this.setFlag(flagName, flag);
    }
  }

  /**
   * Remove target users from a feature flag
   */
  async removeTargetUsers(flagName: string, userIds: string[]): Promise<void> {
    const flag = await this.getFlag(flagName);
    if (flag) {
      const userSet = new Set(flag.targetUsers || []);
      userIds.forEach(id => userSet.delete(id));
      flag.targetUsers = Array.from(userSet);
      await this.setFlag(flagName, flag);
    }
  }

  /**
   * Determine if a user/account should get the feature based on rollout percentage
   * Uses consistent hashing to ensure consistent rollout
   */
  private isWithinRollout(identifier: string, flagName: string, percentage: number): boolean {
    // Create a deterministic hash based on identifier + flag name
    const hash = this.hashString(`${identifier}:${flagName}`);
    const hashPercentage = (hash % 100) + 1; // 1-100
    return hashPercentage <= percentage;
  }

  /**
   * Simple consistent hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Initialize default flags from configuration
   */
  async initialize(defaultFlags?: Map<string, FeatureFlag>): Promise<void> {
    try {
      if (defaultFlags) {
        for (const [name, flag] of defaultFlags) {
          // Only set if not already in Redis
          const existing = await this.getFlag(name);
          if (!existing) {
            await this.setFlag(name, flag);
          }
        }
      }
      logger.info('Feature flag service initialized');
    } catch (error) {
      logger.error('Error initializing feature flag service:', error);
      throw error;
    }
  }
}
