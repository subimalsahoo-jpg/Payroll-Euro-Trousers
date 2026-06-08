'use strict';

/**
 * Standardised API response envelope + typed AppError.
 * -------------------------------------------------------------
 * Every controller returns a consistent shape so the SPA can
 * reliably parse success/failure without guesswork.
 */

/** Application-level error carrying an HTTP status code. */
class AppError extends Error {
  /**
   * @param {string} message - Human readable message.
   * @param {number} [statusCode=400] - HTTP status.
   * @param {string} [code] - Stable machine-readable error code.
   * @param {object} [details] - Optional extra context (e.g. validation).
   */
  constructor(message, statusCode = 400, code = 'BAD_REQUEST', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Send a success envelope. */
function ok(res, data = null, message = 'OK', status = 200, meta = undefined) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/** Send a "created" envelope. */
function created(res, data = null, message = 'Created') {
  return ok(res, data, message, 201);
}

/** Send a failure envelope. */
function fail(res, message = 'Error', status = 400, code = 'ERROR', details = null) {
  const body = { success: false, message, code };
  if (details) body.details = details;
  return res.status(status).json(body);
}

module.exports = { AppError, ok, created, fail };
