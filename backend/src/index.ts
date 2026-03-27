import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/env';
import logger from './utils/logger';
import transactionsRouter from './api/routes/transactions.route';
import sep24Router from './api/routes/sep24.route';
import infoRouter from './api/routes/info.route';
import { errorHandler } from './api/middleware/error.middleware';

const app = express();
const PORT = config.PORT;

app.use(cors());
app.use(express.json());

app.use('/api/transactions', transactionsRouter);

// SEP-1 Info endpoint
app.use('/info', infoRouter);

// SEP-24 routes
app.use('/sep24', sep24Router);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'UP', timestamp: new Date().toISOString() });
});

app.get('/', (req: Request, res: Response) => {
  res.send('AnchorPoint Backend API is running.');
});

// Global error handling middleware (must be last)
app.use(errorHandler);

/* istanbul ignore next */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Backend service listening at http://localhost:${PORT}`);
  });
}

export default app;
