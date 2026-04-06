/**
 * Logger — structured logging with Winston.
 *
 * In production (Railway/Docker), only console transport is used.
 * File transports are only used in development to avoid filesystem
 * permission errors in containerized environments.
 */
const winston = require('winston');
const config = require('../config');

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const { service, ...displayMeta } = meta;
        const metaStr = Object.keys(displayMeta).length > 0
          ? ` ${JSON.stringify(displayMeta)}`
          : '';
        return `${timestamp} [${level}]: ${message}${metaStr}`;
      })
    ),
  }),
];

// Only add file transports in development — Railway/Docker containers
// may not have a writable logs/ directory
if (config.nodeEnv === 'development') {
  const fs = require('fs');
  const logsDir = 'logs';
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    transports.push(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 5242880,
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        maxsize: 5242880,
        maxFiles: 5,
      })
    );
  } catch (e) {
    console.warn('[logger] Could not create logs directory, file logging disabled:', e.message);
  }
}

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'shopify-manus-integration' },
  transports,
});

module.exports = logger;
