import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import contractQueueService from '../../services/contract-queue.service';
import { JobPriority } from '../../config/queue';
import logger from '../../utils/logger';

export class QueueController {
  /**
   * Add a new job to the queue
   */
  async addJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        type,
        contractId,
        functionName,
        parameters,
        priority,
        metadata,
      } = req.body;

      const createdBy = req.user?.publicKey;

      const result = await contractQueueService.addJob({
        type,
        contractId,
        functionName,
        parameters,
        createdBy,
        priority: priority || JobPriority.NORMAL,
        metadata,
      });

      res.status(201).json({
        status: 'success',
        data: {
          jobId: result.jobId,
          dbId: result.dbId,
        },
      });
    } catch (error: any) {
      logger.error('Error adding job:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to add job',
      });
    }
  }

  /**
   * Add a settlement job (high priority)
   */
  async addSettlementJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { contractId, functionName, parameters } = req.body;
      const createdBy = req.user?.publicKey;

      const result = await contractQueueService.addSettlementJob(
        contractId,
        functionName,
        parameters,
        createdBy
      );

      res.status(201).json({
        status: 'success',
        data: {
          jobId: result.jobId,
          dbId: result.dbId,
          priority: 'URGENT',
        },
      });
    } catch (error: any) {
      logger.error('Error adding settlement job:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to add settlement job',
      });
    }
  }

  /**
   * Add a contract call job
   */
  async addContractCallJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { contractId, functionName, parameters, priority } = req.body;
      const createdBy = req.user?.publicKey;

      const result = await contractQueueService.addContractCallJob(
        contractId,
        functionName,
        parameters,
        createdBy,
        priority
      );

      res.status(201).json({
        status: 'success',
        data: {
          jobId: result.jobId,
          dbId: result.dbId,
        },
      });
    } catch (error: any) {
      logger.error('Error adding contract call job:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to add contract call job',
      });
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;

      const status = await contractQueueService.getJobStatus(jobId);

      // Include error details if available
      const responseData = { job: status };
      
      if (status.error && status.errorCategory) {
        responseData.job.errorDetails = {
          category: status.errorCategory,
          severity: status.errorSeverity,
          code: status.errorCode,
          userMessage: status.userMessage,
          suggestedAction: status.suggestedAction,
          retryable: status.retryable,
        };
      }

      res.json({
        status: 'success',
        data: responseData,
      });
    } catch (error: any) {
      logger.error('Error getting job status:', error);
      res.status(404).json({
        status: 'error',
        message: error.message || 'Job not found',
      });
    }
  }

  /**
   * Get jobs by status
   */
  async getJobsByStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { status } = req.params;
      const { limit } = req.query;

      const jobs = await contractQueueService.getJobsByStatus(
        status as any,
        limit ? parseInt(limit as string, 10) : 50
      );

      // Include error details for jobs that have them
      const jobsWithDetails = jobs.map((job: any) => {
        if (job.error && job.errorCategory) {
          return {
            ...job,
            errorDetails: {
              category: job.errorCategory,
              severity: job.errorSeverity,
              code: job.errorCode,
              userMessage: job.userMessage,
              suggestedAction: job.suggestedAction,
              retryable: job.retryable,
            },
          };
        }
        return job;
      });

      res.json({
        status: 'success',
        data: { jobs: jobsWithDetails },
      });
    } catch (error: any) {
      logger.error('Error getting jobs by status:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get jobs',
      });
    }
  }

  /**
   * Get user's jobs
   */
  async getMyJobs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.publicKey;
      const { limit } = req.query;

      const jobs = await contractQueueService.getJobsByUser(
        userId,
        limit ? parseInt(limit as string, 10) : 50
      );

      // Include error details for jobs that have them
      const jobsWithDetails = jobs.map((job: any) => {
        if (job.error && job.errorCategory) {
          return {
            ...job,
            errorDetails: {
              category: job.errorCategory,
              severity: job.errorSeverity,
              code: job.errorCode,
              userMessage: job.userMessage,
              suggestedAction: job.suggestedAction,
              retryable: job.retryable,
            },
          };
        }
        return job;
      });

      res.json({
        status: 'success',
        data: { jobs: jobsWithDetails },
      });
    } catch (error: any) {
      logger.error('Error getting user jobs:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get jobs',
      });
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;

      await contractQueueService.retryJob(jobId);

      res.json({
        status: 'success',
        message: 'Job queued for retry',
      });
    } catch (error: any) {
      logger.error('Error retrying job:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to retry job',
      });
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;

      await contractQueueService.cancelJob(jobId);

      res.json({
        status: 'success',
        message: 'Job cancelled',
      });
    } catch (error: any) {
      logger.error('Error cancelling job:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to cancel job',
      });
    }
  }

  /**
   * Get queue metrics
   */
  async getMetrics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const metrics = await contractQueueService.getQueueMetrics();

      res.json({
        status: 'success',
        data: { metrics },
      });
    } catch (error: any) {
      logger.error('Error getting metrics:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get metrics',
      });
    }
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { days } = req.query;
      const olderThanDays = days ? parseInt(days as string, 10) : 30;

      const count = await contractQueueService.cleanOldJobs(olderThanDays);

      res.json({
        status: 'success',
        data: {
          cleaned: count,
          olderThanDays,
        },
      });
    } catch (error: any) {
      logger.error('Error cleaning old jobs:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to clean jobs',
      });
    }
  }
}

export default new QueueController();
