import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import queueController from '../controllers/queue.controller';

const router = Router();

// Validation schemas
const addJobSchema = z.object({
  type: z.string().min(1, 'Job type is required'),
  contractId: z.string().optional(),
  functionName: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  metadata: z.record(z.any()).optional(),
});

const addSettlementJobSchema = z.object({
  contractId: z.string().min(1, 'Contract ID is required'),
  functionName: z.string().min(1, 'Function name is required'),
  parameters: z.record(z.any()),
});

const addContractCallJobSchema = z.object({
  contractId: z.string().min(1, 'Contract ID is required'),
  functionName: z.string().min(1, 'Function name is required'),
  parameters: z.record(z.any()),
  priority: z.number().int().min(1).max(4).optional(),
});

const queryLimitSchema = z.object({
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 50),
});

const queryDaysSchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
});

/**
 * @swagger
 * components:
 *   schemas:
 *     Job:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         jobId:
 *           type: string
 *         type:
 *           type: string
 *         priority:
 *           type: string
 *           enum: [LOW, NORMAL, HIGH, URGENT]
 *         status:
 *           type: string
 *           enum: [PENDING, ACTIVE, COMPLETED, FAILED, DELAYED, RETRYING]
 *         contractId:
 *           type: string
 *         functionName:
 *           type: string
 *         parameters:
 *           type: object
 *         result:
 *           type: object
 *         error:
 *           type: string
 *         attempts:
 *           type: integer
 *         maxAttempts:
 *           type: integer
 *         createdBy:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         startedAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/queue/jobs:
 *   post:
 *     summary: Add a new job to the queue
 *     description: Creates a new job for contract interaction
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 description: Job type (CONTRACT_CALL, CONTRACT_DEPLOY, SETTLEMENT, etc.)
 *               contractId:
 *                 type: string
 *                 description: Stellar contract ID
 *               functionName:
 *                 type: string
 *                 description: Contract function to call
 *               parameters:
 *                 type: object
 *                 description: Function parameters
 *               priority:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 4
 *                 description: Job priority (1=LOW, 2=NORMAL, 3=HIGH, 4=URGENT)
 *               metadata:
 *                 type: object
 *                 description: Additional metadata
 *     responses:
 *       201:
 *         description: Job created successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/jobs',
  authMiddleware,
  validate({ body: addJobSchema }),
  queueController.addJob.bind(queueController)
);

/**
 * @swagger
 * /api/queue/jobs/settlement:
 *   post:
 *     summary: Add a high-priority settlement job
 *     description: Creates an urgent settlement job
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractId
 *               - functionName
 *               - parameters
 *             properties:
 *               contractId:
 *                 type: string
 *               functionName:
 *                 type: string
 *               parameters:
 *                 type: object
 *     responses:
 *       201:
 *         description: Settlement job created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/jobs/settlement',
  authMiddleware,
  validate({ body: addSettlementJobSchema }),
  queueController.addSettlementJob.bind(queueController)
);

/**
 * @swagger
 * /api/queue/jobs/contract-call:
 *   post:
 *     summary: Add a contract call job
 *     description: Creates a job to call a smart contract function
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractId
 *               - functionName
 *               - parameters
 *             properties:
 *               contractId:
 *                 type: string
 *               functionName:
 *                 type: string
 *               parameters:
 *                 type: object
 *               priority:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 4
 *     responses:
 *       201:
 *         description: Contract call job created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/jobs/contract-call',
  authMiddleware,
  validate({ body: addContractCallJobSchema }),
  queueController.addContractCallJob.bind(queueController)
);

/**
 * @swagger
 * /api/queue/jobs/{jobId}:
 *   get:
 *     summary: Get job status
 *     description: Retrieves the current status of a job
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job status retrieved
 *       404:
 *         description: Job not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/jobs/:jobId',
  authMiddleware,
  queueController.getJobStatus.bind(queueController)
);

/**
 * @swagger
 * /api/queue/jobs/status/{status}:
 *   get:
 *     summary: Get jobs by status
 *     description: Retrieves jobs with a specific status
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *           enum: [PENDING, ACTIVE, COMPLETED, FAILED, DELAYED, RETRYING]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Jobs retrieved
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/jobs/status/:status',
  authMiddleware,
  validate({ query: queryLimitSchema }),
  queueController.getJobsByStatus.bind(queueController)
);

/**
 * @swagger
 * /api/queue/my-jobs:
 *   get:
 *     summary: Get user's jobs
 *     description: Retrieves all jobs created by the authenticated user
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Jobs retrieved
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/my-jobs',
  authMiddleware,
  validate({ query: queryLimitSchema }),
  queueController.getMyJobs.bind(queueController)
);

/**
 * @swagger
 * /api/queue/jobs/{jobId}/retry:
 *   post:
 *     summary: Retry a failed job
 *     description: Queues a failed job for retry
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job queued for retry
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/jobs/:jobId/retry',
  authMiddleware,
  queueController.retryJob.bind(queueController)
);

/**
 * @swagger
 * /api/queue/jobs/{jobId}/cancel:
 *   post:
 *     summary: Cancel a job
 *     description: Cancels a pending or active job
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job cancelled
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/jobs/:jobId/cancel',
  authMiddleware,
  queueController.cancelJob.bind(queueController)
);

/**
 * @swagger
 * /api/queue/metrics:
 *   get:
 *     summary: Get queue metrics
 *     description: Retrieves queue statistics and metrics
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics retrieved
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/metrics',
  authMiddleware,
  queueController.getMetrics.bind(queueController)
);

/**
 * @swagger
 * /api/queue/clean:
 *   post:
 *     summary: Clean old jobs
 *     description: Removes old completed and failed jobs
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Remove jobs older than this many days
 *     responses:
 *       200:
 *         description: Jobs cleaned
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/clean',
  authMiddleware,
  validate({ query: queryDaysSchema }),
  queueController.cleanOldJobs.bind(queueController)
);

export default router;
