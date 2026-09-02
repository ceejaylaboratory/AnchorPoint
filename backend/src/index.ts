import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { config, hydrateEncryptedConfigSecrets } from './config/env';
import { swaggerSpec } from './config/swagger';
import logger from './utils/logger';
import transactionsRouter from './api/routes/transactions.route';
import adminRouter from './api/routes/admin.route';
import sep24Router from './api/routes/sep24.route';
import sep12Router from './api/routes/sep12.route';
import sep6Router from './api/routes/sep6.route';
import sep38Router from './api/routes/sep38.route';
import sep40Router from './api/routes/sep40.route';
import infoRouter from './api/routes/info.route';
import { getInfo } from './api/controllers/info.controller';
import metricsRouter from './api/routes/metrics.route';
import relayerRouter from './api/routes/relayer.route';
import recurringPaymentsRouter from './api/routes/recurring-payments.route';
import configRouter from './api/routes/config.route';
import multisigRouter from './api/routes/multisig.route';
import sep31Router from './api/routes/sep31.route';

import authRouter from './api/routes/auth.route';
import { errorHandler } from './api/middleware/error.middleware';
import { metricsMiddleware, connectionTracker } from './api/middleware/metrics.middleware';
import { securityHeadersMiddleware } from './api/middleware/security-headers.middleware';
import { sanitizeBodyMiddleware } from './api/middleware/sanitize.middleware';
import { tracingMiddleware } from './api/middleware/tracing.middleware';
import configService from './services/config.service';
import { stellarService } from './services/stellar.service';
import feeReportRouter from './api/routes/fee-report.route';
import { feeReportScheduler } from './workers/fee-report.scheduler';
import eventRouter from './api/routes/event.route';
import notificationsRouter from './api/routes/notifications.route';
import { publicLimiter, authLimiter } from './api/middleware/rate-limit.middleware';
import { notificationService } from './services/notification.service';
import { createEmailProvider, ConsoleSmsProvider, FcmPushProvider } from './lib/notifications/providers';
import { NotificationType } from './services/notification.service';
import { validateKmsConfigOnStartup, verifyDecryptionCapabilityOnStartup } from './lib/key-management.service';
import queueDashboardRouter, { dashboardQueues } from './api/routes/queue-dashboard.route';
import prisma from './lib/prisma';
import { redis } from './lib/redis';
import { validateStorageConfigOnStartup } from './services/storage-provider.service';
import { uploadExpiryScheduler } from './workers/upload-expiry.scheduler';
import { dbMetricsScheduler } from './workers/db-metrics.scheduler';
import { initSocket } from './lib/socket';
import { kycExpiryScheduler } from './workers/kyc-expiry.scheduler';
import { cleanupWorker } from './workers/cleanup.worker';
import { feeReportWorker } from './workers/fee-report.worker';
import contractQueueService from './services/contract-queue.service';
import { checkMigrationsOnStartup } from './services/migration-check.service';

let server: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`${signal} received, initiating graceful shutdown`);

  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 30000);
  forceExitTimer.unref();

  // Stop scheduling new work before tearing down the connections it depends on.
  feeReportScheduler.stop();
  uploadExpiryScheduler.stop();
  kycExpiryScheduler.stop();
  cleanupWorker.stop();
  dbMetricsScheduler.stop();

  // Stop accepting new HTTP traffic; let in-flight requests finish.
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close((err) => {
        if (err) {
          logger.error('Error closing HTTP server:', err);
        } else {
          logger.info('HTTP server closed');
        }
        resolve();
      });
    });
  }

  // Drain BullMQ queue connections, then close the database and Redis.
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['fee report queue', () => feeReportScheduler.closeQueue()],
    ['fee report worker', () => feeReportWorker.close()],
    ['contract queue service', () => contractQueueService.close()],
    ...dashboardQueues.map(
      (queue): [string, () => Promise<unknown>] => [`${queue.name} queue`, () => queue.close()]
    ),
    ['Prisma client', () => prisma.$disconnect()],
    ['Redis connection', () => redis.quit()],
  ];

  for (const [label, action] of steps) {
    try {
      await action();
      logger.info(`${label} closed`);
    } catch (err) {
      logger.error(`Error closing ${label}:`, err);
    }
  }

  clearTimeout(forceExitTimer);
  logger.info(`Graceful shutdown complete (${signal})`);
  process.exit(0);
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

// Initialize Notification Engine
notificationService.registerProvider(NotificationType.EMAIL, createEmailProvider());
notificationService.registerProvider(NotificationType.SMS, new ConsoleSmsProvider());
notificationService.registerProvider(NotificationType.PUSH, new FcmPushProvider());

const app = express();
const httpServer = http.createServer(app);
app.disable('x-powered-by');
app.use(securityHeadersMiddleware);
app.use(tracingMiddleware);
const PORT = config.PORT;

const configuredOrigins = process.env.ALLOWED_ORIGINS || process.env.PRODUCTION_CORS_ORIGINS || '';
const allowedOrigins = configuredOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGINS (or PRODUCTION_CORS_ORIGINS) must be configured in production.');
}

const fallbackLocalOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const effectiveAllowedOrigins = allowedOrigins.length > 0 ? allowedOrigins : fallbackLocalOrigins;

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      return callback(null, true);
    }

    if (effectiveAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.warn(`Blocked CORS origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeBodyMiddleware);

/**
 * @swagger
 * /:
 *   get:
 *     summary: Root endpoint
 *     description: Welcome message for the AnchorPoint API
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Welcome message
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: AnchorPoint Backend API is running.
 */
app.get('/', (req: Request, res: Response) => {
  res.send('AnchorPoint Backend API is running.');
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Check if the API server and its backend dependencies (database, Redis, Soroban RPC) are running
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server and all dependencies are healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: UP
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 services:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: string
 *                       example: UP
 *                     redis:
 *                       type: string
 *                       example: UP
 *                     sorobanRpc:
 *                       type: string
 *                       example: UP
 *       503:
 *         description: One or more backend dependencies are down
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: DOWN
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 services:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: string
 *                       example: DOWN
 *                     redis:
 *                       type: string
 *                       example: UP
 *                     sorobanRpc:
 *                       type: string
 *                       example: DOWN
 */
app.get('/health', async (req: Request, res: Response) => {
  let dbStatus = 'UP';
  let redisStatus = 'UP';
  let redisLatency = 0;
  let sorobanRpcStatus = 'UP';
  let isHealthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'DOWN';
    isHealthy = false;
    logger.error('Health Check - Database connection failed:', err);
  }

  try {
    const start = Date.now();
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      redisStatus = 'DOWN';
      isHealthy = false;
    } else {
      redisLatency = Date.now() - start;
    }
  } catch (err) {
    redisStatus = 'DOWN';
    isHealthy = false;
    logger.error('Health Check - Redis connection failed:', err);
  }

  try {
    const rpcHealth = await stellarService.getHealth();
    sorobanRpcStatus = rpcHealth.status;
    if (rpcHealth.status === 'DOWN') {
      isHealthy = false;
    }
  } catch (err) {
    sorobanRpcStatus = 'DOWN';
    isHealthy = false;
    logger.error('Health Check - Soroban RPC connection failed:', err);
  }

  const responsePayload = {
    status: isHealthy ? 'UP' : 'DOWN',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      redis: { status: redisStatus, latencyMs: redisLatency },
      sorobanRpc: sorobanRpcStatus,
    },
  };

  if (!isHealthy) {
    return res.status(503).json(responsePayload);
  }

  return res.status(200).json(responsePayload);
});

// Swagger API Documentation
/**
 * @swagger
 * /api-docs:
 *   get:
 *     summary: API Documentation
 *     description: Interactive Swagger UI documentation for the AnchorPoint API
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Swagger UI HTML page
 */
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'AnchorPoint API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    displayOperationId: true,
    filter: true,
  },
}));

// API Documentation JSON endpoint
app.get('/api-docs.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Apply metrics tracking middleware
app.use(connectionTracker);
app.use(metricsMiddleware);

app.use('/api/transactions', transactionsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/config', configRouter);
app.use('/api/reports', feeReportRouter);
app.use('/api/events', eventRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/multisig', multisigRouter);

// Relayer API for gasless token approvals

app.use('/api/relayer', relayerRouter);

// SEP-40 Swap Rates API
app.use('/sep40', sep40Router);

// SEP-10 Auth routes (SEP-10 WEB_AUTH_ENDPOINT is /auth; /sep10 is kept for compatibility)
app.use('/auth', authLimiter, authRouter);
app.use('/sep10', authLimiter, authRouter);

// SEP-12 KYC routes
app.use('/sep12', sep12Router);

// Public endpoints — mounted once with shared Redis-backed rate limiting
const publicRoutes: Array<[string, express.Router]> = [
  ['/sep31', sep31Router],
  ['/sep38', sep38Router],
  ['/info', infoRouter],
  ['/sep24', sep24Router],
  ['/sep6', sep6Router],
  ['/metrics', metricsRouter],
];

publicRoutes.forEach(([path, router]) => {
  app.use(path, publicLimiter, router);
});

// SEP-1 stellar.toml at the well-known path
app.get('/.well-known/stellar.toml', publicLimiter, getInfo);

app.use('/api/recurring-payments', recurringPaymentsRouter);

// BullMQ queue monitoring dashboard (#362) — admin-only in production
app.use('/api/queue-dashboard', queueDashboardRouter);

// Global error handling middleware (must be last)
app.use(errorHandler);

/* istanbul ignore next */
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    // Check migrations first
    await checkMigrationsOnStartup();

    // Validate and hydrate config
    validateKmsConfigOnStartup(config);
    await hydrateEncryptedConfigSecrets();
    const decryptionOk = await verifyDecryptionCapabilityOnStartup({
      NODE_ENV: config.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      ANCHOR_SECRET_KEY: process.env.ANCHOR_SECRET_KEY,
      STELLAR_DISTRIBUTION_SECRET: process.env.STELLAR_DISTRIBUTION_SECRET,
      STELLAR_FEE_BUMP_SECRET: process.env.STELLAR_FEE_BUMP_SECRET,
      RELAYER_SECRET_KEY: process.env.RELAYER_SECRET_KEY,
      WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
      SIGNING_KEY: process.env.SIGNING_KEY,
    });

    if (!decryptionOk && config.NODE_ENV === 'production') {
      logger.error('Aborting startup: encrypted config secrets could not be decrypted');
      process.exit(1);
    }

    validateStorageConfigOnStartup();

    configService.initialize()
      .catch((error) => {
        logger.error('Failed to initialize config service:', error);
      })
      .finally(() => {
        initSocket(httpServer);
        server = httpServer.listen(PORT, () => {
          logger.info(`Backend service listening at http://localhost:${PORT}`);
          logger.info(`API Documentation available at http://localhost:${PORT}/api-docs`);
          feeReportScheduler.start();
          uploadExpiryScheduler.start();
          kycExpiryScheduler.start();
          dbMetricsScheduler.start();
          cleanupWorker.start();
        });
      });
  })().catch((error) => {
    logger.error('Fatal startup error during secret hydration:', error);
    process.exit(1);
  });
}

export default app;