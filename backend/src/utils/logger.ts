import winston from "winston";
import path from "path";
import { traceContextFormat } from "../tracing/winston-trace.format";
import { structuredJsonFormat } from "./log-format";
import { LogstashTransport } from "./logstash.transport";
import { tracingManager } from "./tracing";

export function correlationIdFormat(): winston.Logform.Format {
  return winston.format((info) => {
    const ctx = tracingManager.getCurrentContext();
    if (ctx?.correlationId) {
      info["correlationId"] = ctx.correlationId;
    }
    return info;
  })();
}

// Ensure traceId / requestId are present as top-level fields so Loki/Promtail
// can extract them as structured labels and Grafana can correlate logs to traces.
export function traceFieldsFormat(): winston.Logform.Format {
  return winston.format((info) => {
    const ctx = tracingManager.getCurrentContext();
    if (ctx?.traceId && info["traceId"] === undefined) {
      info["traceId"] = ctx.traceId;
    }
    if (ctx?.requestId && info["requestId"] === undefined) {
      info["requestId"] = ctx.requestId;
    }
    return info;
  })();
}

// Determine log level from environment
const getLogLevel = () => {
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels = ["error", "warn", "info", "debug"];

  if (envLogLevel && validLevels.includes(envLogLevel)) {
    return envLogLevel;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
};

const SENSITIVE_KEYS = /secret|token|password|tax_id|email/i;

export const maskPIIFormat = winston.format((info) => {
  const redact = (obj: any): any => {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(redact);

    const redactedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.test(key)) {
        redactedObj[key] = "***REDACTED***";
      } else {
        redactedObj[key] = redact(value);
      }
    }
    return redactedObj;
  };

  for (const key of Object.keys(info)) {
    if (typeof key === "string" && SENSITIVE_KEYS.test(key)) {
      info[key] = "***REDACTED***";
    } else if (typeof key === "string" && typeof info[key] === "object") {
      info[key] = redact(info[key]);
    }
  }

  return info;
});

// LOG_FORMAT env switch: "json" (default, required for Loki label extraction)
// or "pretty" for local development. Production always emits JSON.
const isProductionEnv = process.env.NODE_ENV === "production";
const requestedLogFormat = process.env.LOG_FORMAT?.toLowerCase();
const usePrettyFormat = !isProductionEnv && requestedLogFormat === "pretty";

// Structured JSON format chain: trace context first, then structured JSON
const jsonLogFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  traceContextFormat(),
  correlationIdFormat(),
  traceFieldsFormat(),
  structuredJsonFormat(),
  maskPIIFormat(),
  winston.format.json()
);

const prettyLogFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  traceContextFormat(),
  correlationIdFormat(),
  traceFieldsFormat(),
  maskPIIFormat(),
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${message}${extra}`;
  })
);

const logFormat = usePrettyFormat ? prettyLogFormat : jsonLogFormat;

// Create logger instance with structured JSON format in all environments
const logger = winston.createLogger({
  level: getLogLevel(),
  format: logFormat,
  defaultMeta: { service: "anchorpoint-backend" },
  transports: [new winston.transports.Console()],
});

const isProduction = process.env.NODE_ENV === "production";
const logstashHost = process.env.LOGSTASH_HOST;
const lokiUrl = process.env.LOKI_URL;

// Optional direct Loki push transport (gated by LOKI_URL). This aggregates
// container logs even when Promtail is not deployed alongside the service.
if (lokiUrl) {
  const lokiLabels: Record<string, string> = {
    app: "anchorpoint-backend",
    environment: process.env.NODE_ENV ?? "development",
    job: "anchorpoint-backend",
  };

  logger.add(
    new winston.transports.Http({
      host: (() => {
        try {
          return new URL(lokiUrl).hostname;
        } catch {
          return undefined;
        }
      })(),
      port: (() => {
        try {
          const parsed = new URL(lokiUrl);
          return parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
        } catch {
          return undefined;
        }
      })(),
      path: (() => {
        try {
          return new URL(lokiUrl).pathname;
        } catch {
          return "/loki/api/v1/push";
        }
      })(),
      ssl: lokiUrl.startsWith("https://"),
      format: winston.format.combine(
        winston.format((info) => {
          // Wrap the log line in Loki's push payload shape.
          const line = JSON.stringify(info);
          info["streams"] = [
            {
              stream: lokiLabels,
              values: [[`${Date.now()}000000`, line]],
            },
          ];
          return info;
        })(),
      ),
    }),
  );
}

// Conditionally add LogstashTransport when LOGSTASH_HOST is set (Req 2.2, 9.4)
if (logstashHost) {
  const logstashPort = parseInt(process.env.LOGSTASH_PORT ?? "5000", 10);
  logger.add(
    new LogstashTransport({
      host: logstashHost,
      port: logstashPort,
    }),
  );
}

// File transport rules (Req 4.1, 4.2, 4.3):
//   - production + LOGSTASH_HOST set   → NO file transports
//   - production + LOGSTASH_HOST unset → KEEP file transports + startup warning
//   - non-production                   → NO file transports
if (isProduction && !logstashHost) {
  // Req 4.2: retain file transports as fallback and warn
  console.warn(
    "ELK shipping disabled: LOGSTASH_HOST is not set. Falling back to file transports.",
  );

  const logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");

  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  );

  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  );
}

// Req 6.8: warn when no alert notification channels are configured
if (!process.env.ALERT_WEBHOOK_URL && !process.env.ALERT_EMAIL_RECIPIENTS) {
  console.warn(
    "No alert notification channels configured: set ALERT_WEBHOOK_URL or ALERT_EMAIL_RECIPIENTS",
  );
}

export default logger;
