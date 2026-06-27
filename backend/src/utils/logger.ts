import winston from "winston";
import path from "path";
import { traceContextFormat } from "../tracing/winston-trace.format";
import { structuredJsonFormat } from "./log-format";
import { LogstashTransport } from "./logstash.transport";

// Determine log level from environment
const getLogLevel = () => {
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels = ["error", "warn", "info", "debug"];

  if (envLogLevel && validLevels.includes(envLogLevel)) {
    return envLogLevel;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
};

// Structured JSON format chain: trace context first, then structured JSON
const logFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  traceContextFormat(),
  structuredJsonFormat(),
);

// Create logger instance with structured JSON format in all environments
const logger = winston.createLogger({
  level: getLogLevel(),
  format: logFormat,
  defaultMeta: { service: "anchorpoint-backend" },
  transports: [new winston.transports.Console()],
});

const isProduction = process.env.NODE_ENV === "production";
const logstashHost = process.env.LOGSTASH_HOST;

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
