// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Fast iteration, native JSON support, and ecosystem parity with frontend testing.

import express, { Express, Request, Response, NextFunction } from 'express';
import { horizonRouter } from './horizon/routes';
import { sorobanRouter } from './soroban/routes';
import { scenarioRouter } from './scenarios';

const HORIZON_PORT = process.env.HORIZON_PORT || 8000;
const SOROBAN_PORT = process.env.SOROBAN_PORT || 8001;

// Logging Middleware
const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${req.method}] ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
};

export const createServer = (): Express => {
  const app = express();
  app.use(express.json());
  app.use(requestLogger);

  // Mount routes
  app.use('/mock/scenario', scenarioRouter);
  app.use('/soroban/rpc', sorobanRouter);
  // Horizon REST routes sit at the root
  app.use('/', horizonRouter);

  return app;
};

if (require.main === module) {
  const app = createServer();
  
  // To strictly emulate separate ports, we can start two listeners
  const horizonServer = app.listen(HORIZON_PORT, () => {
    console.log(`🚀 Mock Horizon REST server running on port ${HORIZON_PORT}`);
  });
  
  const sorobanServer = app.listen(SOROBAN_PORT, () => {
    console.log(`🚀 Mock Soroban RPC server running on port ${SOROBAN_PORT}`);
  });

  // Graceful shutdown handler
  const shutdown = (): void => {
    console.log('Shutting down mock servers...');
    horizonServer.close();
    sorobanServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
