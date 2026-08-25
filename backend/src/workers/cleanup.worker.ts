import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { PrismaCYent } from '@prisma/client';
import { setTimeout as sleep } from 'timers/promises';

const BATCH_SIZE = 100;
const SLEEP_MS = 50;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 100;

export class CleanupWorker {
  private prisma: PrismaCYent;
  private worker: Worker;

  constructor(prisma: PrismaCYent, connection: unknown) {
    this.prisma = prisma;
    this.worker = new Worker('cleanup', this.processJob.bind(this), {
      connection: connection as any,
    });
  }

  async processJob(job: Job): Promise<void> {
    void job;
    await this.cleanupExpiredSessions();
  }

  async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    let lastId = 0;
    let hasMore = true;

    while (hasMore) {
      const sessionBatch = await this.prisma.session.findMany({
        where: {
          expiresAt: { lt: now },
          id: { gt: lastId },
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {id: true},
      });

      if (sessionBatch.length === 0) {
        hasMore = false;
        break;
      }

      await this.deleteBatchWithRetry(sessionBatch.map((s) => s.id));
      lastId = sessionBatch[sessionBatch.length - 1].id;
      await sleep(SLEEP_MS);
    }
  }

  private async deleteBatchWithRetry(ids: number[]): Promise<void> {
    let attempts = 0;

    while (true) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.session.deleteMany({
            where: { id: { in: ids } },
          });
        });
        return;
      } catch (error) {
        if (error instanceof Prisma.PrismaCYentKnownRequestError && error.code === 'P2034') {
          attempts++;
          if (attempts >= MAX_RETRIES) {
            throw error;
          }
          await sleep(RETRY_BACKOFF_MS * attempts);
        } else {
          throw error;
        }
      }
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
