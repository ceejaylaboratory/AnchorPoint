import winston from "winston";
import path from "path";
import { traceContextFormat } from "../tracing/winston-trace.format";

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Determine log level from environment
const getLogLevel = () => {
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels = ["error", "warn", "info", "debug"];

  if (envLogLevel && validLevels.includes(envLogLevel)) {
    return envLogLevel;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
};

// Build the base format chain (shared between logger and console transport in non-prod)
const isProduction = process.env.NODE_ENV === "production";

const baseFormat = isProduction
  ? combine(
      errors({ stack: true }),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      traceContextFormat(),
      json(),
    )
  : combine(
      errors({ stack: true }),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      traceContextFormat(),
      logFormat,
    );

// Create logger instance
const logger = winston.createLogger({
  level: getLogLevel(),
  format: baseFormat,
  defaultMeta: { service: "anchorpoint-backend" },
  transports: [
    // Console transport for all environments
    new winston.transports.Console({
      format: isProduction
        ? baseFormat
        : combine(
            colorize(),
            errors({ stack: true }),
            timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
            traceContextFormat(),
            logFormat,
          ),
    }),
  ],
});

// Add file transports for production
if (isProduction) {
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");

  // Error log file
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  );

  // Combined log file
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  );
}

export default logger;
