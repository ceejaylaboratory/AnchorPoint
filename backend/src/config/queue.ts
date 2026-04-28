import { QueueOptions, WorkerOptions, JobsOptions } from 'bullmq';
import { redis } from '../lib/redis';

/**
 * BullMQ Queue Configuration
 */

// Redis connection for BullMQ
export const queueConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
};

// Default queue options
export const defaultQueueOptions: QueueOptions = {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // Start with 2 seconds
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
};

// Worker options
export const defaultWorkerOptions: WorkerOptions = {
  connection: queueConnection,
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
  limiter: {
    max: 10, // Max 10 jobs
    duration: 1000, // Per second
  },
};

// Job type configurations
export const jobTypeConfigs: Record<string, Partial<JobsOptions>> = {
  CONTRACT_CALL: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    priority: 2, // Normal priority
  },
  CONTRACT_DEPLOY: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    priority: 3, // Higher priority
  },
  SETTLEMENT: {
    attempts: 10,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    priority: 4, // Urgent priority
  },
  BATCH_OPERATION: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 10000,
    },
    priority: 1, // Low priority
  },
  TRANSACTION_SUBMIT: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    priority: 3,
  },
};

// Priority mapping
export enum JobPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  URGENT = 4,
}

// Retry strategies for specific errors
export const retryStrategies = {
  too_early: {
    maxAttempts: 10,
    delay: 5000, // 5 seconds
    backoffMultiplier: 1.5,
  },
  transaction_failed: {
    maxAttempts: 5,
    delay: 3000, // 3 seconds
    backoffMultiplier: 2,
  },
  insufficient_balance: {
    maxAttempts: 3,
    delay: 10000, // 10 seconds
    backoffMultiplier: 1,
  },
  network_error: {
    maxAttempts: 7,
    delay: 2000, // 2 seconds
    backoffMultiplier: 2,
  },
};

// Queue names
export const QUEUE_NAMES = {
  CONTRACT_INTERACTIONS: 'contract-interactions',
  SETTLEMENTS: 'settlements',
  NOTIFICATIONS: 'notifications',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];
