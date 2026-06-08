'use strict';

/**
 * Central Express error handler.
 * Converts thrown errors (operational AppError or unexpected) into the
 * standard failure envelope. Never leaks stack traces in production.
 */

const logger = require('../utils/logger');
const env = require('../config/env');
const { AppError } = require('../utils/response');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  let status = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let details = err.details || null;

  // Translate common MySQL errors into friendly responses.
  if (err && err.code === 'ER_DUP_ENTRY') {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with the same unique value already exists';
  } else if (err && err.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 422;
    code = 'FK_CONSTRAINT';
    message = 'Referenced record does not exist';
  } else if (err && err.code === 'ER_ROW_IS_REFERENCED_2') {
    status = 409;
    code = 'FK_IN_USE';
    message = 'Record is referenced by other records and cannot be removed';
  }

  const isOperational = err instanceof AppError || status < 500;

  if (!isOperational) {
    logger.error(`${req.method} ${req.originalUrl} -> ${err.stack || err.message}`);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${status} ${code}: ${message}`);
  }

  const body = { success: false, code, message };
  if (details) body.details = details;
  if (!env.app.isProd && !isOperational) body.stack = err.stack;

  res.status(status).json(body);
};
