import { Request, Response, NextFunction } from "express";
import logger from "../../utils/logger";
import { loadSamplingConfig } from "../../utils/sampling-config";

/**
 * Express middleware that logs structured HTTP request completion entries.
 * Requirements: 1.4, 1.5, 7.1, 7.2, 7.3, 7.4, 8.2, 8.4
 */
export function requestLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startMs = Date.now();

  // Attach requestId to res.locals for downstream use (Requirement 1.4)
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();
  res.locals["requestId"] = requestId;

  res.on("finish", () => {
    const durationMs = Date.now() - startMs;
    const httpMethod = req.method;
    const httpRoute = req.route?.path ?? req.path;
    const httpStatusCode = res.statusCode;

    // Apply sampling (Requirement 8.2)
    const samplingConfig = loadSamplingConfig();
    const ratio = samplingConfig.getRatio(httpMethod, httpRoute);
    if (Math.random() > ratio) {
      // Sampled out — drop silently, no error counters (Requirement 8.4)
      return;
    }

    // Select log level by status code (Requirements 7.3, 7.4)
    const level =
      httpStatusCode >= 500 ? "error" : httpStatusCode >= 400 ? "warn" : "info";

    logger.log(level, `${httpMethod} ${httpRoute} ${httpStatusCode}`, {
      httpMethod,
      httpRoute,
      httpStatusCode,
      durationMs,
      requestId,
    });
  });

  next();
}
