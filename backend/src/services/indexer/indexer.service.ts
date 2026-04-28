import cron from "node-cron";
import { randomUUID } from "crypto";
import logger from "../../utils/logger";
import { ASSETS } from "../../config/assets";
import {
  AssetConfig,
  CrawlJobResult,
  CrawlJobSummary,
  ValidationResult,
} from "../../types/indexer.types";
import { HorizonResolverImpl, HorizonError } from "./horizon.resolver";
import {
  TomlFetcherImpl,
  TomlFetchError,
  TomlParseError,
} from "./toml.fetcher";
import { Sep1ValidatorImpl } from "./sep1.validator";
import { AssetIndexRepository } from "./asset-index.repository";

const DEFAULT_CRON = "0 * * * *";

export class IndexerService {
  private running = false;
  private lastJobId: string | null = null;

  private readonly horizonResolver = new HorizonResolverImpl();
  private readonly tomlFetcher = new TomlFetcherImpl();
  private readonly validator = new Sep1ValidatorImpl();

  constructor(private readonly repository: AssetIndexRepository) {}

  start(): void {
    const schedule = process.env.INDEXER_CRON_SCHEDULE ?? DEFAULT_CRON;
    const validSchedule = cron.validate(schedule)
      ? schedule
      : (() => {
          logger.error(
            `Invalid INDEXER_CRON_SCHEDULE "${schedule}", falling back to default`,
          );
          return DEFAULT_CRON;
        })();

    cron.schedule(validSchedule, () => {
      if (this.running) {
        logger.info(
          "Crawl job already in progress, skipping scheduled trigger",
        );
        return;
      }
      this.triggerCrawl().catch((err) =>
        logger.error(`Scheduled crawl failed: ${(err as Error).message}`),
      );
    });

    // Fire initial crawl immediately
    this.triggerCrawl().catch((err) =>
      logger.error(`Initial crawl failed: ${(err as Error).message}`),
    );
  }

  async triggerCrawl(): Promise<CrawlJobResult> {
    if (this.running) {
      throw new Error("A crawl job is already in progress");
    }
    this.running = true;
    const jobId = randomUUID();
    const startedAt = new Date();
    logger.info(`Crawl job ${jobId} started`);

    const assets: AssetConfig[] = ASSETS.map((a) => ({
      code: a.code,
      issuer: a.issuer ?? null,
    }));

    const results: ValidationResult[] = [];

    for (const asset of assets) {
      try {
        const result = await this.processAsset(asset);
        results.push(result);
        await this.repository.upsertValidationResult(result);
      } catch (err) {
        logger.error(
          `Unexpected error processing asset ${asset.code}: ${(err as Error).message}`,
        );
      }
    }

    const completedAt = new Date();
    const summary: CrawlJobSummary = {
      id: jobId,
      startedAt,
      completedAt,
      totalAssets: results.length,
      compliantCount: results.filter((r) => r.complianceStatus === "COMPLIANT")
        .length,
      nonCompliantCount: results.filter(
        (r) => r.complianceStatus === "NON_COMPLIANT",
      ).length,
      suspiciousCount: results.filter(
        (r) => r.complianceStatus === "SUSPICIOUS",
      ).length,
    };

    await this.repository.saveCrawlJobSummary(summary);
    this.lastJobId = jobId;
    this.running = false;
    logger.info(`Crawl job ${jobId} completed: ${JSON.stringify(summary)}`);

    return { jobId, summary };
  }

  getStatus(): { running: boolean; lastJobId: string | null } {
    return { running: this.running, lastJobId: this.lastJobId };
  }

  private async processAsset(asset: AssetConfig): Promise<ValidationResult> {
    // Assets without an issuer are native/non-Stellar
    if (!asset.issuer) {
      return {
        assetCode: asset.code,
        issuerPublicKey: null,
        homeDomain: null,
        complianceStatus: "NON_COMPLIANT",
        messages: [
          "Asset has no issuer — native or non-Stellar asset, skipping validation",
        ],
        rawToml: null,
        lastCrawledAt: new Date(),
      };
    }

    // Step 1: Resolve home_domain via Horizon
    let homeDomain: string | null;
    try {
      homeDomain = await this.horizonResolver.resolveHomeDomain(asset.issuer);
    } catch (err) {
      return {
        assetCode: asset.code,
        issuerPublicKey: asset.issuer,
        homeDomain: null,
        complianceStatus: "NON_COMPLIANT",
        messages: [(err as HorizonError).message],
        rawToml: null,
        lastCrawledAt: new Date(),
      };
    }

    if (!homeDomain) {
      return {
        assetCode: asset.code,
        issuerPublicKey: asset.issuer,
        homeDomain: null,
        complianceStatus: "NON_COMPLIANT",
        messages: ["Issuer account has no home_domain set"],
        rawToml: null,
        lastCrawledAt: new Date(),
      };
    }

    // Step 2: Fetch stellar.toml
    let parsedToml: Record<string, unknown>;
    let rawToml: string | null = null;
    try {
      parsedToml = await this.tomlFetcher.fetch(homeDomain);
    } catch (err) {
      const isSuspicious =
        err instanceof TomlFetchError &&
        (err as TomlFetchError).message.includes("http://");
      return {
        assetCode: asset.code,
        issuerPublicKey: asset.issuer,
        homeDomain,
        complianceStatus: isSuspicious ? "SUSPICIOUS" : "NON_COMPLIANT",
        messages: [(err as TomlFetchError | TomlParseError).message],
        rawToml: null,
        lastCrawledAt: new Date(),
      };
    }

    // Step 3: Validate
    return this.validator.validate(
      parsedToml,
      asset,
      true,
      homeDomain,
      rawToml ?? undefined,
    );
  }
}
