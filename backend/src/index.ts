import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './api/middleware/error.middleware';
import logger from './utils/logger';
import transactionsRouter from './api/routes/transactions.route';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.use('/api/transactions', transactionsRouter);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'UP', timestamp: new Date().toISOString() });
});

app.get('/', (req: Request, res: Response) => {
  res.send('AnchorPoint Backend API is running.');
});

// Global error handling middleware (must be last)
app.use(errorHandler);
// SEP-24 routes
app.use('/sep24', sep24Router);

/* istanbul ignore next */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Backend service listening at http://localhost:${PORT}`);
  });
}

export default app;
