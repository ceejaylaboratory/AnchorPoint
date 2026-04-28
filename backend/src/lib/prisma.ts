import { PrismaClient } from '@prisma/client';
import { metricsService } from '../services/metrics.service';

const prisma = new PrismaClient();

type PrismaMiddlewareParams = {
  model?: string;
  action: string;
};

type PrismaMiddleware = (params: PrismaMiddlewareParams) => Promise<unknown>;

const prismaAny = prisma as unknown as { $use?: (mw: unknown) => void };

if (typeof prismaAny.$use === 'function') {
  prismaAny.$use(async (params: PrismaMiddlewareParams, next: PrismaMiddleware) => {
    const start = process.hrtime.bigint();
    try {
      return await next(params);
    } finally {
      const end = process.hrtime.bigint();
      const seconds = Number(end - start) / 1e9;
      const queryType = `${params.model ?? 'raw'}.${params.action}`;
      metricsService.observeDbQuery(queryType, seconds);
    }
  });
}

export default prisma;
