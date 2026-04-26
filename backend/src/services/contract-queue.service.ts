import { Queue, Job, JobsOptions } from 'bullmq';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import {
  defaultQueueOptions,
  jobTypeConfigs,
  JobPriority,
  QUEUE_NAMES,
  retryStrategies,
} from '../config/queue';
import { JobStatus } from '@prisma/client';
import sorobanErrorService from './soroban-error.service';

/**
 * Contract Interaction Job Data
 */
export interface ContractJobData {
  type: string;
  contractId?: string;
  functionName?: string;
  parameters?: Record<string, any>;
  createdBy?: string;
  metadata?: Record<string, any>;
  priority?: JobPriority;
}

/**
 * Job Result
 */
export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  errorDetails?: {
    category: string;
    severity: string;
    code: string;
    userMessage: string;
    suggestedAction: string;
    retryable: boolean;
  };
  transactionId?: string;
  timestamp: Date;
}

/**
 * Contract Queue Service
 * Manages distributed task queue for smart contract interactions
 */
class ContractQueueService {
  private queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.CONTRACT_INTERACTIONS, defaultQueueOptions);
    this.setupEventListeners();
  }

  /**
   * Add a job to the queue
   */
  async addJob(
    jobData: ContractJobData,
    options?: Partial<JobsOptions>
  ): Promise<{ jobId: string; dbId: string }> {
    try {
      // Get job configuration based on type
      const typeConfig = jobTypeConfigs[jobData.type] || {};

      // Merge options
      const jobOptions: JobsOptions = {
        ...typeConfig,
        ...options,
        priority: jobData.priority || typeConfig.priority || JobPriority.NORMAL,
      };

      // Add job to BullMQ
      const job = await this.queue.add(jobData.type, jobData, jobOptions);

      // Create database record
      const dbJob = await prisma.contractJob.create({
        data: {
          jobId: job.id!,
          type: jobData.type,
          priority: this.mapPriorityToEnum(jobOptions.priority || JobPriority.NORMAL),
          status: JobStatus.PENDING,
          contractId: jobData.contractId,
          functionName: jobData.functionName,
          parameters: jobData.parameters || {},
          maxAttempts: jobOptions.attempts || 3,
          createdBy: jobData.createdBy,
          metadata: jobData.metadata || {},
        },
      });

      logger.info(`Job added to queue: ${job.id} (DB: ${dbJob.id})`);

      return {
        jobId: job.id!,
        dbId: dbJob.id,
      };
    } catch (error: any) {
      logger.error('Error adding job to queue:', error);
      throw new Error(`Failed to add job: ${error.message}`);
    }
  }

  /**
   * Add a high-priority settlement job
   */
  async addSettlementJob(
    contractId: string,
    functionName: string,
    parameters: Record<string, any>,
    createdBy?: string
  ): Promise<{ jobId: string; dbId: string }> {
    return this.addJob(
      {
        type: 'SETTLEMENT',
        contractId,
        functionName,
        parameters,
        createdBy,
        priority: JobPriority.URGENT,
        metadata: {
          category: 'settlement',
          urgent: true,
        },
      },
      {
        priority: JobPriority.URGENT,
      }
    );
  }

  /**
   * Add a contract call job
   */
  async addContractCallJob(
    contractId: string,
    functionName: string,
    parameters: Record<string, any>,
    createdBy?: string,
    priority: JobPriority = JobPriority.NORMAL
  ): Promise<{ jobId: string; dbId: string }> {
    return this.addJob({
      type: 'CONTRACT_CALL',
      contractId,
      functionName,
      parameters,
      createdBy,
      priority,
    });
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<any> {
    try {
      const job = await this.queue.getJob(jobId);
      
      if (!job) {
        // Check database
        const dbJob = await prisma.contractJob.findUnique({
          where: { jobId },
        });
        
        if (!dbJob) {
          throw new Error('Job not found');
        }
        
        return {
          id: dbJob.id,
          jobId: dbJob.jobId,
          type: dbJob.type,
          status: dbJob.status,
          priority: dbJob.priority,
          attempts: dbJob.attempts,
          maxAttempts: dbJob.maxAttempts,
          result: dbJob.result,
          error: dbJob.error,
          createdAt: dbJob.createdAt,
          startedAt: dbJob.startedAt,
          completedAt: dbJob.completedAt,
          failedAt: dbJob.failedAt,
        };
      }

      const state = await job.getState();
      const progress = job.progress;

      return {
        id: job.id,
        name: job.name,
        data: job.data,
        state,
        progress,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        returnvalue: job.returnvalue,
        failedReason: job.failedReason,
      };
    } catch (error: any) {
      logger.error('Error getting job status:', error);
      throw new Error(`Failed to get job status: ${error.message}`);
    }
  }

  /**
   * Get jobs by status
   */
  async getJobsByStatus(status: JobStatus, limit: number = 50): Promise<any[]> {
    try {
      const jobs = await prisma.contractJob.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return jobs;
    } catch (error: any) {
      logger.error('Error getting jobs by status:', error);
      throw new Error(`Failed to get jobs: ${error.message}`);
    }
  }

  /**
   * Get jobs by user
   */
  async getJobsByUser(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const jobs = await prisma.contractJob.findMany({
        where: { createdBy: userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return jobs;
    } catch (error: any) {
      logger.error('Error getting jobs by user:', error);
      throw new Error(`Failed to get jobs: ${error.message}`);
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);
      
      if (!job) {
        throw new Error('Job not found in queue');
      }

      await job.retry();

      // Update database
      await prisma.contractJob.updateMany({
        where: { jobId },
        data: {
          status: JobStatus.RETRYING,
          attempts: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      logger.info(`Job ${jobId} queued for retry`);
    } catch (error: any) {
      logger.error('Error retrying job:', error);
      throw new Error(`Failed to retry job: ${error.message}`);
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);
      
      if (job) {
        await job.remove();
      }

      // Update database
      await prisma.contractJob.updateMany({
        where: { jobId },
        data: {
          status: JobStatus.FAILED,
          error: 'Job cancelled by user',
          failedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      logger.info(`Job ${jobId} cancelled`);
    } catch (error: any) {
      logger.error('Error cancelling job:', error);
      throw new Error(`Failed to cancel job: ${error.message}`);
    }
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(): Promise<any> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);

      // Get database stats
      const dbStats = await prisma.contractJob.groupBy({
        by: ['status'],
        _count: true,
      });

      return {
        queue: {
          waiting,
          active,
          completed,
          failed,
          delayed,
          total: waiting + active + completed + failed + delayed,
        },
        database: dbStats.reduce((acc, stat) => {
          acc[stat.status] = stat._count;
          return acc;
        }, {} as Record<string, number>),
      };
    } catch (error: any) {
      logger.error('Error getting queue metrics:', error);
      throw new Error(`Failed to get metrics: ${error.message}`);
    }
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // Clean from BullMQ
      await this.queue.clean(olderThanDays * 24 * 60 * 60 * 1000, 1000, 'completed');
      await this.queue.clean(olderThanDays * 24 * 60 * 60 * 1000, 1000, 'failed');

      // Clean from database
      const result = await prisma.contractJob.deleteMany({
        where: {
          status: { in: [JobStatus.COMPLETED, JobStatus.FAILED] },
          completedAt: { lt: cutoffDate },
        },
      });

      logger.info(`Cleaned ${result.count} old jobs`);
      return result.count;
    } catch (error: any) {
      logger.error('Error cleaning old jobs:', error);
      throw new Error(`Failed to clean jobs: ${error.message}`);
    }
  }

  /**
   * Update job in database
   */
  async updateJobInDatabase(
    jobId: string,
    updates: {
      status?: JobStatus;
      result?: any;
      error?: string;
      attempts?: number;
      startedAt?: Date;
      completedAt?: Date;
      failedAt?: Date;
      errorCategory?: string;
      errorSeverity?: string;
      errorCode?: string;
      userMessage?: string;
      suggestedAction?: string;
      retryable?: boolean;
    }
  ): Promise<void> {
    try {
      await prisma.contractJob.updateMany({
        where: { jobId },
        data: {
          ...updates,
          updatedAt: new Date(),
        },
      });
    } catch (error: any) {
      logger.error('Error updating job in database:', error);
    }
  }

  /**
   * Setup event listeners for queue
   */
  private setupEventListeners(): void {
    this.queue.on('waiting', (job: Job) => {
      logger.debug(`Job ${job.id} is waiting`);
    });

    this.queue.on('active', (job: Job) => {
      logger.info(`Job ${job.id} started processing`);
      this.updateJobInDatabase(job.id!, {
        status: JobStatus.ACTIVE,
        startedAt: new Date(),
      });
    });

    this.queue.on('completed', (job: Job, result: any) => {
      logger.info(`Job ${job.id} completed successfully`);
      this.updateJobInDatabase(job.id!, {
        status: JobStatus.COMPLETED,
        result,
        completedAt: new Date(),
      });
    });

    this.queue.on('failed', (job: Job | undefined, error: Error) => {
      if (job) {
        logger.error(`Job ${job.id} failed:`, error);
        
        // Parse error using Soroban error service
        const errorDetails = sorobanErrorService.formatForApi(error);
        
        this.updateJobInDatabase(job.id!, {
          status: JobStatus.FAILED,
          error: error.message,
          errorCategory: errorDetails.category,
          errorSeverity: errorDetails.severity,
          errorCode: errorDetails.code,
          userMessage: errorDetails.userMessage,
          suggestedAction: errorDetails.suggestedAction,
          retryable: errorDetails.retryable,
          failedAt: new Date(),
        });
      }
    });

    this.queue.on('progress', (job: Job, progress: number | object) => {
      logger.debug(`Job ${job.id} progress:`, progress);
    });

    this.queue.on('error', (error: Error) => {
      logger.error('Queue error:', error);
    });
  }

  /**
   * Map priority number to enum
   */
  private mapPriorityToEnum(priority: number): any {
    if (priority >= 4) return 'URGENT';
    if (priority === 3) return 'HIGH';
    if (priority === 2) return 'NORMAL';
    return 'LOW';
  }

  /**
   * Get the queue instance
   */
  getQueue(): Queue {
    return this.queue;
  }

  /**
   * Close the queue
   */
  async close(): Promise<void> {
    await this.queue.close();
    logger.info('Queue closed');
  }
}

export default new ContractQueueService();
