import { RequestHandler } from "express";
import { Redis } from "ioredis";
import { ApiKeyService } from "../../services/api-key.service";
import { TierConfigService, Tier } from "../../services/tier-config.service";
import logger from "../../utils/logger";

declare module "express-serve-static-core" {
  interface Request {
    apiKeyTier?: Tier;
    apiKeyId?: string;
  }
}

const BYPASS_PATHS = ["/health", "/metrics"];

let lastRedisWarnTime = 0;

function logRedisWarning(message: string): void {
  const now = Date.now();
  if (now - lastRedisWarnTime > 60_000) {
    lastRedisWarnTime = now;
    logger.warn(message);
  }
}

export function dynamicRateLimiter(
  apiKeyService: ApiKeyService,
  tierConfig: TierConfigService,
  redisClient: Redis,
): RequestHandler {
  return async (req, res, next) => {
    // Step 1: Bypass paths
    const path = req.path;
    if (BYPASS_PATHS.includes(path) || path.startsWith("/api-docs")) {
      return next();
    }

    // Step 2: Extract X-API-Key header
    const apiKey = req.headers["x-api-key"];
    if (!apiKey || typeof apiKey !== "string") {
      res.status(401).json({ error: "API key required" });
      return;
    }

    // Step 3: Validate API key against Postgres
    let record;
    try {
      record = await apiKeyService.findActiveKey(apiKey);
    } catch (err) {
      logger.error("Postgres error during API key lookup", err);
      res.status(503).json({ error: "Service temporarily unavailable" });
      return;
    }

    if (record === null) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    if (!record.isActive) {
      res.status(403).json({ error: "API key is inactive" });
      return;
    }

    // Step 4: Resolve tier limits
    let limits;
    try {
      limits = tierConfig.getLimits(record.tier);
    } catch (err) {
      logger.error("Unknown tier encountered", err);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const { burstLimit, sustainedLimit } = limits;

    // Steps 5–8: Redis quota enforcement (fail-open on Redis errors)
    try {
      const burstKey = `drl:burst:${apiKey}`;
      const sustainedKey = `drl:sustained:${apiKey}`;

      // Burst window
      const burstCount = await redisClient.incr(burstKey);
      if (burstCount === 1) {
        await redisClient.expire(burstKey, 1);
      }

      if (burstCount > burstLimit) {
        const pttl = await redisClient.pttl(burstKey);
        const retryAfter = Math.max(1, Math.ceil(pttl / 1000));
        res.set("Retry-After", String(retryAfter));
        res.status(429).json({ error: "Burst rate limit exceeded" });
        return;
      }

      // Sustained window
      const sustainedCount = await redisClient.incr(sustainedKey);
      if (sustainedCount === 1) {
        await redisClient.expire(sustainedKey, 60);
      }

      if (sustainedCount > sustainedLimit) {
        const pttl = await redisClient.pttl(sustainedKey);
        const retryAfter = Math.max(1, Math.ceil(pttl / 1000));
        res.set("Retry-After", String(retryAfter));
        res.status(429).json({ error: "Sustained rate limit exceeded" });
        return;
      }

      // Step 9: Set remaining headers
      res.set(
        "X-RateLimit-Burst-Remaining",
        String(Math.max(0, burstLimit - burstCount)),
      );
      res.set(
        "X-RateLimit-Sustained-Remaining",
        String(Math.max(0, sustainedLimit - sustainedCount)),
      );
    } catch (err) {
      // Step 10: Redis error — fail-open
      logRedisWarning(`Redis unavailable in dynamicRateLimiter: ${err}`);
    }

    // Attach tier and key id to request context
    req.apiKeyTier = record.tier;
    req.apiKeyId = record.id;

    next();
  };
}
