if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NODE_ENV === 'test'
    ? 'file:./prisma/test.db'
    : 'file:./prisma/dev.db';
}

import { PrismaClient } from '@prisma/client';
import { metricsService } from '../services/metrics.service';
import { config } from '../config/env';
import { withTracingExtension } from '../tracing/prisma.extension';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// ── Connection pool & SSL configuration ──────────────────────────────
// Append PostgreSQL connection-pool and SSL parameters to DATABASE_URL
// when running against a PostgreSQL datasource. SQLite URLs are left
// untouched.
function buildDatabaseUrl(): string {
  let url = process.env.DATABASE_URL!;

  // Only decorate PostgreSQL connection strings.
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    return url;
  }

  const params = new URLSearchParams();

  // Connection pool limits (Prisma-level; use pgBouncer / Pgpool for
  // external pooling in very high-concurrency deployments).
  params.set('connection_limit', String(config.DB_CONNECTION_LIMIT));
  params.set('pool_timeout', String(config.DB_POOL_TIMEOUT));

  // SSL mode – configurable per environment. Set to 'require' or stricter
  // for production deployments.
  params.set('sslmode', config.DB_SSL_MODE);

  // Merge with any existing query-string params, giving our explicit params
  // precedence.
  const urlParts = url.split('?');
  const baseUrl = urlParts[0];
  if (urlParts[1]) {
    const existing = new URLSearchParams(urlParts[1]);
    for (const [key, value] of existing.entries()) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }

  return `${baseUrl}?${params.toString()}`;
}

// ── Retry helper ──────────────────────────────────────────────────────
const MAX_CONNECT_RETRIES = 5;
const CONNECT_RETRY_BASE_MS = 2_000;

async function connectWithRetry(client: PrismaClient): Promise<void> {
  for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
    try {
      await client.$connect();
      console.log('[Prisma] Successfully connected to database');
      return;
    } catch (error) {
      if (attempt === MAX_CONNECT_RETRIES) {
        const errMsg =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
        console.error(
          `[Prisma] Failed to connect after ${MAX_CONNECT_RETRIES} attempts: ${errMsg}`,
        );
        throw error;
      }
      // Exponential backoff with jitter.
      const delay = CONNECT_RETRY_BASE_MS * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
      console.warn(
        `[Prisma] Connection attempt ${attempt}/${MAX_CONNECT_RETRIES} failed. ` +
          `Retrying in ${Math.round(delay)}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// ── Client instantiation ──────────────────────────────────────────────
const databaseUrl = buildDatabaseUrl();

const prismaClientOptions: { datasources: { db: { url: string } } } | undefined =
  databaseUrl !== process.env.DATABASE_URL
    ? { datasources: { db: { url: databaseUrl } } }
    : undefined;

const prisma =
  global.__prisma ??
  new PrismaClient(prismaClientOptions);

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

// ── Metrics middleware ────────────────────────────────────────────────
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

// ── Tracing (#1201) ───────────────────────────────────────────────────
// Wrap every query in a `prisma:<Model>.<operation>` span. Query extensions
// leave model types unchanged, so the client keeps the PrismaClient type.
const client: PrismaClient =
  typeof (prisma as { $extends?: unknown }).$extends === 'function'
    ? (withTracingExtension(prisma) as unknown as PrismaClient)
    : prisma;

// ── Startup connection retry (production only) ────────────────────────
// Eagerly verify the database connection on startup so the process fails
// fast rather than throwing on the first HTTP request.
if (process.env.NODE_ENV === 'production') {
  connectWithRetry(prisma).catch((error) => {
    console.error('[Prisma] Fatal: could not establish database connection', error);
    process.exit(1);
  });
}

export default client;
