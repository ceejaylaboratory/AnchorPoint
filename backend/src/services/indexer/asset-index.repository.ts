import prisma from "../../lib/prisma";
import { RedisService } from "../redis.service";
import logger from "../../utils/logger";
import { ValidationResult, CrawlJobSummary } from "../../types/indexer.types";

const CACHE_TTL = 300; // 5 minutes

function cacheKey(assetCode: string, issuerPublicKey: string | null): string {
  return `asset-index:${assetCode}:${issuerPublicKey ?? "native"}`;
}

function toValidationResult(row: {
  assetCode: string;
  issuerPublicKey: string | null;
  homeDomain: string | null;
  complianceStatus: string;
  messages: string;
  rawToml: string | null;
  lastCrawledAt: Date;
}): ValidationResult {
  return {
    assetCode: row.assetCode,
    issuerPublicKey: row.issuerPublicKey,
    homeDomain: row.homeDomain,
    complianceStatus:
      row.complianceStatus as ValidationResult["complianceStatus"],
    messages: JSON.parse(row.messages) as string[],
    rawToml: row.rawToml,
    lastCrawledAt: row.lastCrawledAt,
  };
}

export class AssetIndexRepository {
  constructor(private readonly redis: RedisService | null) {}

  async upsertValidationResult(result: ValidationResult): Promise<void> {
    const data = {
      homeDomain: result.homeDomain,
      complianceStatus: result.complianceStatus,
      messages: JSON.stringify(result.messages),
      rawToml: result.rawToml,
      lastCrawledAt: result.lastCrawledAt,
    };

    await prisma.assetValidationResult.upsert({
      where: {
        assetCode_issuerPublicKey: {
          assetCode: result.assetCode,
          issuerPublicKey: result.issuerPublicKey ?? "",
        },
      },
      update: data,
      create: {
        assetCode: result.assetCode,
        issuerPublicKey: result.issuerPublicKey,
        ...data,
      },
    });

    // Invalidate then write cache
    if (this.redis) {
      try {
        const key = cacheKey(result.assetCode, result.issuerPublicKey);
        await this.redis.del(key);
        await this.redis.setJSON(key, result, CACHE_TTL);
      } catch (err) {
        logger.warn(
          `Redis unavailable during cache write: ${(err as Error).message}`,
        );
      }
    }
  }

  async getValidationResult(code: string): Promise<ValidationResult | null> {
    // Try cache first
    if (this.redis) {
      try {
        const cached = await this.redis.getJSON<ValidationResult>(
          `asset-index:${code}:*`,
        );
        if (cached) return cached;
      } catch (err) {
        logger.warn(
          `Redis unavailable during cache read: ${(err as Error).message}`,
        );
      }
    }

    const row = await prisma.assetValidationResult.findFirst({
      where: { assetCode: code },
      orderBy: { lastCrawledAt: "desc" },
    });
    return row ? toValidationResult(row) : null;
  }

  async getAllValidationResults(): Promise<ValidationResult[]> {
    const rows = await prisma.assetValidationResult.findMany({
      orderBy: { lastCrawledAt: "desc" },
    });
    return rows.map(toValidationResult);
  }

  async saveCrawlJobSummary(summary: CrawlJobSummary): Promise<void> {
    await prisma.crawlJobRecord.create({
      data: {
        id: summary.id,
        startedAt: summary.startedAt,
        completedAt: summary.completedAt,
        totalAssets: summary.totalAssets,
        compliantCount: summary.compliantCount,
        nonCompliantCount: summary.nonCompliantCount,
        suspiciousCount: summary.suspiciousCount,
      },
    });
  }

  async getLatestCrawlJobSummary(): Promise<CrawlJobSummary | null> {
    const row = await prisma.crawlJobRecord.findFirst({
      orderBy: { startedAt: "desc" },
    });
    if (!row) return null;
    return {
      id: row.id,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? row.startedAt,
      totalAssets: row.totalAssets,
      compliantCount: row.compliantCount,
      nonCompliantCount: row.nonCompliantCount,
      suspiciousCount: row.suspiciousCount,
    };
  }
}
