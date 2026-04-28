import { Request, Response } from "express";
import { IndexerService } from "../../services/indexer/indexer.service";
import { AssetIndexRepository } from "../../services/indexer/asset-index.repository";

export class AssetIndexController {
  constructor(
    private readonly indexerService: IndexerService,
    private readonly repository: AssetIndexRepository,
  ) {}

  /**
   * GET /internal/asset-index
   * Returns all validation results and the latest crawl job timestamp.
   */
  getAll = async (_req: Request, res: Response): Promise<void> => {
    const results = await this.repository.getAllValidationResults();
    const latestJob = await this.repository.getLatestCrawlJobSummary();
    res.json({
      results,
      lastCrawledAt: latestJob?.completedAt ?? null,
    });
  };

  /**
   * GET /internal/asset-index/:code
   * Returns the validation result for a single asset by code.
   */
  getByCode = async (req: Request, res: Response): Promise<void> => {
    const { code } = req.params;
    const result = await this.repository.getValidationResult(
      code.toUpperCase(),
    );
    if (!result) {
      res
        .status(404)
        .json({ error: `No validation result found for asset code: ${code}` });
      return;
    }
    res.json(result);
  };

  /**
   * POST /internal/asset-index/crawl
   * Triggers an immediate crawl job.
   */
  triggerCrawl = async (_req: Request, res: Response): Promise<void> => {
    const { running } = this.indexerService.getStatus();
    if (running) {
      res.status(409).json({ error: "A crawl job is already in progress" });
      return;
    }
    // Trigger async — don't await so we return 202 immediately
    const jobId = crypto.randomUUID();
    this.indexerService.triggerCrawl().catch(() => {
      /* logged inside service */
    });
    res.status(202).json({ jobId, message: "Crawl job accepted" });
  };
}
