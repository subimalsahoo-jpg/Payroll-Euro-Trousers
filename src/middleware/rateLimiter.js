'use strict';

/**
 * Rate limiting middleware (Module 13).
 * Falls back to a tiny in-memory limiter if express-rate-limit is
 * unavailable, so the app never hard-fails on a missing optional dep.
 */

const env = require('../config/env');

function buildLimiter(windowMs, max, message) {
  try {
    // eslint-disable-next-line global-require
    const rateLimit = require('express-rate-limit');
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, code: 'RATE_LIMIT', message },
    });
  } catch (_e) {
    // Minimal in-memory fallback (per-process; fine for single worker / dev).
    const hits = new Map();
    return function fallbackLimiter(req, res, next) {
      const key = `${req.ip}:${req.baseUrl}`;
      const now = Date.now();
      const rec = hits.get(key) || { count: 0, reset: now + windowMs };
      if (now > rec.reset) {
        rec.count = 0;
        rec.reset = now + windowMs;
      }
      rec.count += 1;
      hits.set(key, rec);
      if (rec.count > max) {
        return res.status(429).json({ success: false, code: 'RATE_LIMIT', message });
      }
      return next();
    };
  }
}

const globalLimiter = buildLimiter(
  env.rateLimit.windowMs,
  env.rateLimit.max,
  'Too many requests, please slow down.'
);

// Stricter limiter applied to authentication endpoints (brute-force defence).
const authLimiter = buildLimiter(
  env.rateLimit.windowMs,
  env.rateLimit.authMax,
  'Too many authentication attempts, please try again later.'
);

module.exports = { globalLimiter, authLimiter, buildLimiter };
