import { Request, Response, NextFunction } from "express";
import logger from "../../utils/logger";
import { loadSamplingConfig } from "../../utils/sampling-config";
import { getTraceContext } from "../../utils/tracing";

/**
 * Express middleware that logs structured HTTP request completion entries.
 * Requirements: 1.4, 1.5, 7.1, 7.2, 7.3, 7.4, 8.2, 8.4
 *
 * Emits top-level `route`, `statusCode`, `requestId`, and `traceId` fields
 * so Promtail can extract them as Loki labels for querying by trace ID and
 * request ID in Grafana Explore (Issue #1673).
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

    // Resolve trace ID from the active tracing context so logs can be
    // correlated with traces in Grafana (Issue #1673).
    const traceId = getTraceContext()?.traceId ?? res.locals["traceId"];

    logger.log(level, `${httpMethod} ${httpRoute} ${httpStatusCode}`, {
      // Top-level fields extracted as Loki labels by Promtail
      route: httpRoute,
      statusCode: httpStatusCode,
      requestId,
      traceId,
      // Additional structured context
      httpMethod,
      httpRoute,
      httpStatusCode,
      durationMs,
    });
  });

  next();
}