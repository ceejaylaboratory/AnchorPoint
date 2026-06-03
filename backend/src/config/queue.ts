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

// Priority mapping — must be declared before jobTypeConfigs to allow direct references
export enum JobPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  URGENT = 4,
}

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

// Worker options (mainnet defaults)
export const defaultWorkerOptions: WorkerOptions = {
  connection: queueConnection,
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
  limiter: {
    max: 10, // Max 10 jobs
    duration: 1000, // Per second
  },
};

// Testnet worker options — lower concurrency and rate limit to avoid saturating testnet RPC
export const testnetWorkerOptions: WorkerOptions = {
  connection: queueConnection,
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '2', 10),
  limiter: {
    max: 5, // Max 5 jobs per second on testnet
    duration: 1000,
  },
};

// Job type configurations (mainnet defaults)
export const jobTypeConfigs: Record<string, Partial<JobsOptions>> = {
  CONTRACT_CALL: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    priority: JobPriority.NORMAL,
  },
  CONTRACT_DEPLOY: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    priority: JobPriority.HIGH,
  },
  SETTLEMENT: {
    attempts: 10,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    priority: JobPriority.URGENT,
  },
  BATCH_OPERATION: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 10000,
    },
    priority: JobPriority.LOW,
  },
  TRANSACTION_SUBMIT: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    priority: JobPriority.HIGH,
  },
  NOTIFICATION: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
    priority: JobPriority.LOW,
  },
};

// Testnet-specific job type configurations.
// CONTRACT_DEPLOY is elevated to URGENT for faster iteration during testnet deployments.
// BATCH_OPERATION and NOTIFICATION are kept LOW to avoid saturating testnet RPC endpoints.
export const testnetJobTypeConfigs: Record<string, Partial<JobsOptions>> = {
  CONTRACT_CALL: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // longer delay — testnet finality is slower
    },
    priority: JobPriority.HIGH,
  },
  CONTRACT_DEPLOY: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 8000,
    },
    priority: JobPriority.URGENT, // deployments are the primary testnet workflow
  },
  SETTLEMENT: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    priority: JobPriority.URGENT,
  },
  BATCH_OPERATION: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 15000,
    },
    priority: JobPriority.LOW,
  },
  TRANSACTION_SUBMIT: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 4000,
    },
    priority: JobPriority.NORMAL,
  },
  NOTIFICATION: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
    priority: JobPriority.LOW,
  },
};

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
  DEAD_LETTER_QUEUE: 'dead-letter-queue',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

// Returns effective job options for a given type, adjusted for STELLAR_NETWORK
export function getEffectiveJobOptions(jobType: string): Partial<JobsOptions> {
  const configs =
    process.env.STELLAR_NETWORK === 'testnet' ? testnetJobTypeConfigs : jobTypeConfigs;
  return configs[jobType] ?? {};
}

// Returns effective worker options adjusted for STELLAR_NETWORK
export function getEffectiveWorkerOptions(): WorkerOptions {
  return process.env.STELLAR_NETWORK === 'testnet'
    ? testnetWorkerOptions
    : defaultWorkerOptions;
}
