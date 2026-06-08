'use strict';

/**
 * Locale resolution middleware (Module 15 - Globalization).
 * Order of precedence: ?lang query -> x-locale header -> cookie -> default.
 * Attaches req.locale and a bound req.t() translator.
 */

const i18n = require('../config/i18n');

function attachLocale(req, res, next) {
  const candidate =
    (req.query && req.query.lang) ||
    req.get('x-locale') ||
    (req.cookies && req.cookies.locale) ||
    undefined;

  req.locale = i18n.resolveLocale(candidate);
  req.t = (key) => i18n.t(key, req.locale);
  res.set('Content-Language', req.locale);
  next();
}

module.exports = { attachLocale };
