/**
 * FX Analytics Service
 *
 * Records asset-pair exchange-rate snapshots (with computed bid/ask spread)
 * in the `FxRateHistory` Prisma table. The historical data is then served by
 * the GET /sep38/prices/history endpoint to power analytics dashboards.
 *
 * Design decisions:
 * - A separate table keeps analytics writes isolated from the Quote flow.
 * - Snapshots are recorded asynchronously; a failure to persist does NOT
 *   block the quote API.
 * - The service falls back to an in-memory ring-buffer when the database is
 *   unavailable so the HTTP endpoint keeps working in CI / local dev.
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RateSnapshot {
  /** Source asset code, e.g. "USDC". */
  sourceAsset: string;
  /** Destination asset code, e.g. "XLM". */
  destinationAsset: string;
  /** Mid-market exchange rate (src → dest). */
  rate: number;
  /** Bid price used to compute the spread (optional). */
  bid?: number;
  /** Ask price used to compute the spread (optional). */
  ask?: number;
  /** Spread = ask - bid, expressed in destination-asset units. */
  spread?: number;
  /** ISO-8601 timestamp; defaults to now. */
  recordedAt?: Date;
}

export interface RateHistoryPoint {
  timestamp: number; // Unix ms
  rate: number;
  spread?: number;
}

export interface RateHistoryResult {
  sourceAsset: string;
  destinationAsset: string;
  points: RateHistoryPoint[];
  high: number;
  low: number;
  average: number;
  averageSpread: number;
  changePercent: number;
}

// ─── In-memory fallback (ring-buffer) ─────────────────────────────────────

const MAX_IN_MEMORY = 500;
const inMemoryStore: Map<string, RateSnapshot[]> = new Map();

function pairKey(src: string, dst: string): string {
  return `${src.toUpperCase()}:${dst.toUpperCase()}`;
}

function storeInMemory(snapshot: RateSnapshot): void {
  const key = pairKey(snapshot.sourceAsset, snapshot.destinationAsset);
  const list = inMemoryStore.get(key) ?? [];
  list.push({ ...snapshot, recordedAt: snapshot.recordedAt ?? new Date() });
  if (list.length > MAX_IN_MEMORY) list.shift();
  inMemoryStore.set(key, list);
}

// ─── Service class ─────────────────────────────────────────────────────────

export class FxAnalyticsService {
  /**
   * Records a rate snapshot for an asset pair.
   *
   * The spread is computed automatically when both `bid` and `ask` are
   * supplied. The write is attempted against the database; on failure the
   * snapshot is kept in-memory and the error is logged (non-fatal).
   */
  async recordSnapshot(snapshot: RateSnapshot): Promise<void> {
    const spread =
      snapshot.spread ??
      (snapshot.bid !== undefined && snapshot.ask !== undefined
        ? Math.abs(snapshot.ask - snapshot.bid)
        : undefined);

    const enriched: RateSnapshot = {
      ...snapshot,
      spread,
      recordedAt: snapshot.recordedAt ?? new Date(),
    };

    // Always keep in-memory copy for immediate availability
    storeInMemory(enriched);

    try {
      await (prisma as unknown as {
        fxRateHistory: {
          create(args: {
            data: {
              sourceAsset: string;
              destinationAsset: string;
              rate: number;
              bid: number | null;
              ask: number | null;
              spread: number | null;
              recordedAt: Date;
            };
          }): Promise<unknown>;
        };
      }).fxRateHistory.create({
        data: {
          sourceAsset: enriched.sourceAsset.toUpperCase(),
          destinationAsset: enriched.destinationAsset.toUpperCase(),
          rate: enriched.rate,
          bid: enriched.bid ?? null,
          ask: enriched.ask ?? null,
          spread: enriched.spread ?? null,
          recordedAt: enriched.recordedAt!,
        },
      });
    } catch (err) {
      // Database unavailable or schema not yet migrated; silently degrade to in-memory
      logger.debug('FxAnalyticsService: falling back to in-memory store', {
        error: err instanceof Error ? err.message : String(err),
        pair: pairKey(snapshot.sourceAsset, snapshot.destinationAsset),
      });
    }
  }

  /**
   * Returns historical rate data for an asset pair, covering the last
   * `hoursBack` hours. Tries the database first; falls back to in-memory.
   */
  async getHistory(
    sourceAsset: string,
    destinationAsset: string,
    hoursBack: number = 24,
  ): Promise<RateHistoryResult> {
    const src = sourceAsset.toUpperCase();
    const dst = destinationAsset.toUpperCase();
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    let rows: Array<{ rate: number; spread: number | null; recordedAt: Date }> = [];

    try {
      rows = await (prisma as unknown as {
        fxRateHistory: {
          findMany(args: {
            where: {
              sourceAsset: string;
              destinationAsset: string;
              recordedAt: { gte: Date };
            };
            orderBy: { recordedAt: 'asc' | 'desc' };
            select: { rate: boolean; spread: boolean; recordedAt: boolean };
          }): Promise<Array<{ rate: number; spread: number | null; recordedAt: Date }>>;
        };
      }).fxRateHistory.findMany({
        where: {
          sourceAsset: src,
          destinationAsset: dst,
          recordedAt: { gte: since },
        },
        orderBy: { recordedAt: 'asc' },
        select: { rate: true, spread: true, recordedAt: true },
      });
    } catch {
      // Fall through to in-memory
    }

    // In-memory fallback when DB is empty or unavailable
    if (rows.length === 0) {
      const key = pairKey(src, dst);
      const cached = inMemoryStore.get(key) ?? [];
      rows = cached
        .filter((s) => (s.recordedAt ?? new Date()) >= since)
        .map((s) => ({
          rate: s.rate,
          spread: s.spread ?? null,
          recordedAt: s.recordedAt ?? new Date(),
        }));
    }

    return this.buildResult(src, dst, rows);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private buildResult(
    src: string,
    dst: string,
    rows: Array<{ rate: number; spread: number | null; recordedAt: Date }>,
  ): RateHistoryResult {
    if (rows.length === 0) {
      return {
        sourceAsset: src,
        destinationAsset: dst,
        points: [],
        high: 0,
        low: 0,
        average: 0,
        averageSpread: 0,
        changePercent: 0,
      };
    }

    const points: RateHistoryPoint[] = rows.map((r) => ({
      timestamp: r.recordedAt.getTime(),
      rate: r.rate,
      ...(r.spread !== null ? { spread: r.spread } : {}),
    }));

    const rates = rows.map((r) => r.rate);
    const spreads = rows.map((r) => r.spread ?? 0);
    const high = Math.max(...rates);
    const low = Math.min(...rates);
    const average = rates.reduce((a, b) => a + b, 0) / rates.length;
    const averageSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const changePercent =
      rates.length > 1
        ? ((rates[rates.length - 1] - rates[0]) / rates[0]) * 100
        : 0;

    return {
      sourceAsset: src,
      destinationAsset: dst,
      points,
      high: parseFloat(high.toFixed(7)),
      low: parseFloat(low.toFixed(7)),
      average: parseFloat(average.toFixed(7)),
      averageSpread: parseFloat(averageSpread.toFixed(7)),
      changePercent: parseFloat(changePercent.toFixed(4)),
    };
  }

  /**
   * Exposed for testing: clears the in-memory ring-buffer.
   */
  clearMemoryStore(): void {
    inMemoryStore.clear();
  }
}

export const fxAnalyticsService = new FxAnalyticsService();
export default fxAnalyticsService;
