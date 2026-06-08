'use strict';

/**
 * Application logger.
 * -------------------------------------------------------------
 * Thin wrapper around winston that gracefully degrades to the
 * console when winston is not yet installed. Centralising logging
 * lets us add transports (files, syslog, CloudWatch) in one place.
 */

let logger;

try {
  // eslint-disable-next-line global-require
  const winston = require('winston');
  const { combine, timestamp, printf, colorize, errors, json } = winston.format;

  const devFormat = combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    printf(({ level, message, timestamp: ts, stack }) => {
      return `${ts} [${level}] ${stack || message}`;
    })
  );

  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.NODE_ENV === 'production'
      ? combine(timestamp(), errors({ stack: true }), json())
      : devFormat,
    transports: [new winston.transports.Console()],
  });
} catch (err) {
  // Fallback shim so the app never crashes purely due to a missing logger dep.
  const stamp = () => new Date().toISOString();
  logger = {
    info: (...a) => console.log(stamp(), '[info]', ...a),
    warn: (...a) => console.warn(stamp(), '[warn]', ...a),
    error: (...a) => console.error(stamp(), '[error]', ...a),
    debug: (...a) => console.debug(stamp(), '[debug]', ...a),
  };
}

module.exports = logger;
