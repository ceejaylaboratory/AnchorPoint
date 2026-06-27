import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { AssetIndexController } from "../controllers/asset-index.controller";
import { IndexerService } from "../../services/indexer/indexer.service";
import { AssetIndexRepository } from "../../services/indexer/asset-index.repository";

export function createAssetIndexRouter(
  indexerService: IndexerService,
  repository: AssetIndexRepository,
): Router {
  const router = Router();
  const controller = new AssetIndexController(indexerService, repository);

  router.use(authMiddleware);

  router.get("/", controller.getAll);
  router.get("/:code", controller.getByCode);
  router.post("/crawl", controller.triggerCrawl);

  return router;
}
