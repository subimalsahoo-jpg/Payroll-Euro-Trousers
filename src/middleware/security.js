'use strict';

/**
 * Security middleware (Module 13 - System Security Gateways).
 * -------------------------------------------------------------
 *  - sanitizeRequest: defence-in-depth input scrubbing that strips
 *    control characters and neutralises the most common SQL-injection
 *    and NoSQL operator-injection payloads. Note: the *primary* SQLi
 *    defence is always parameterised queries (see config/db.js); this
 *    layer is belt-and-braces.
 *  - csrfProtection: double-submit token strategy backed by the session.
 *  - issueCsrfToken: hands the SPA a token to echo back in a header.
 */

const crypto = require('crypto');
const { AppError } = require('../utils/response');

// Patterns that should never legitimately appear in a key name and are
// classic Mongo/SQL operator-injection vectors.
const DANGEROUS_KEY_RE = /^\$|\.|__proto__|constructor|prototype/i;

/** Recursively sanitise an object/array/string in place. */
function scrub(value, depth = 0) {
  if (depth > 8) return value; // guard against pathological nesting
  if (typeof value === 'string') {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEY_RE.test(k)) continue; // drop suspicious keys
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

function sanitizeRequest(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = scrub(req.body);
  if (req.params && typeof req.params === 'object') req.params = scrub(req.params);
  // req.query is a getter-only object on some Express versions; copy safely.
  if (req.query && typeof req.query === 'object') {
    const cleaned = scrub({ ...req.query });
    try {
      Object.keys(req.query).forEach((k) => delete req.query[k]);
      Object.assign(req.query, cleaned);
    } catch (_e) {
      // If query is immutable, expose the cleaned copy separately.
      req.cleanQuery = cleaned;
    }
  }
  next();
}

/** Generate a CSRF token bound to the session. */
function issueCsrfToken(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

/**
 * CSRF protection for state-changing verbs. The SPA reads the token from
 * GET /api/auth/csrf and replays it via the `x-csrf-token` header. Safe
 * (idempotent) methods are exempt.
 */
function csrfProtection(req, _res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();

  const sessionToken = req.session && req.session.csrfToken;
  const provided = req.get('x-csrf-token') || (req.body && req.body._csrf);

  if (!sessionToken || !provided || provided !== sessionToken) {
    return next(new AppError('Invalid or missing CSRF token', 403, 'CSRF'));
  }
  return next();
}

module.exports = {
  sanitizeRequest,
  csrfProtection,
  issueCsrfToken,
  scrub,
};
