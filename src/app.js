'use strict';

/**
 * Express application factory.
 * -------------------------------------------------------------
 * Builds and wires the full middleware stack and route tree.
 * Exported as a factory so it can be imported by tests without
 * binding to a port, and by server.js for production startup.
 *
 * Security posture (Module 13):
 *   helmet -> CSP/headers, compression, CORS, body limits,
 *   cookie + session, rate limiting, CSRF, input sanitisation,
 *   per-route auth + RBAC guards, central error handling.
 */

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const logger = require('./utils/logger');
const { fail } = require('./utils/response');

const { sanitizeRequest } = require('./middleware/security');
const { globalLimiter } = require('./middleware/rateLimiter');
const { attachLocale } = require('./middleware/locale');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const routes = require('./routes');

function createApp() {
  const app = express();

  // Behind a reverse proxy (Hostinger) we trust the first hop for secure cookies/IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- Hardened HTTP headers / CSP allowing our SPA + CDN charting lib ---
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(compression());
  app.use(
    cors({
      origin: env.app.url,
      credentials: true,
    })
  );

  // --- Body parsing with sane limits ---
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser(env.security.sessionSecret));

  // --- Session (used for CSRF + optional server-side session features) ---
  app.use(
    session({
      name: 'dm.sid',
      secret: env.security.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: env.security.cookieSecure,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
      },
    })
  );

  // --- Cross-cutting middleware ---
  app.use(attachLocale); // resolves req.locale from header/query/cookie
  app.use(sanitizeRequest); // strips control chars / obvious injection vectors
  app.use(globalLimiter); // coarse-grained rate limit

  // --- Static SPA + uploaded assets ---
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // --- API routes ---
  app.use('/api', routes);

  // --- SPA fallback: any non-API GET serves the app shell ---
  app.get(/^\/(?!api).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // --- 404 + error handling ---
  app.use(notFound);
  app.use(errorHandler);

  logger.info('Express application initialised');
  return app;
}

module.exports = createApp;
