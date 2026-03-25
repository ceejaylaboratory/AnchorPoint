import winston from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Determine log level from environment
const getLogLevel = () => {
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels = ['error', 'warn', 'info', 'debug'];
  
  if (envLogLevel && validLevels.includes(envLogLevel)) {
    return envLogLevel;
  }
  
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

// Create logger instance
const logger = winston.createLogger({
  level: getLogLevel(),
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  defaultMeta: { service: 'anchorpoint-backend' },
  transports: [
    // Console transport for all environments
    new winston.transports.Console({
      format: combine(
        colorize(),
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      ),
    }),
  ],
});

// Add file transports for production
if (process.env.NODE_ENV === 'production') {
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  
  // Error log file
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  
  // Combined log file
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

export default logger;
