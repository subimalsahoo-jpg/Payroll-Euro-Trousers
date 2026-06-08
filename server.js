'use strict';

/**
 * Euro-Trousers HRMS & Payroll - process entrypoint.
 * -------------------------------------------------------------
 * Stateless, cluster-ready bootstrap suitable for Hostinger
 * Application Manager. Performs a DB health check, ensures storage
 * directories exist, then starts the HTTP server with graceful
 * shutdown handlers.
 *
 * Hostinger note: hPanel launches this entry file (server.js) directly and
 * ignores the package.json "start" script, so npm lifecycle hooks never run.
 * To guarantee the schema exists, we run the migration script programmatically
 * and synchronously HERE - before any routes are mounted or DB queries execute.
 * The server then listens on the platform-assigned PORT so Hostinger's reverse
 * proxy can route to it (prevents the boot-time 503).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const express = require('express');

// ---------------------------------------------------------------------------
// Programmatic database migration (runs on every boot, idempotent).
// Placed at the very top, before requiring the app/db modules issue any query.
// `cwd: __dirname` ensures the relative migrate.js path resolves regardless of
// the working directory hPanel uses to launch the process. A migration failure
// is logged but NON-fatal so the server can still come up (and surface a clear
// DB health-check error) rather than leaving the port unbound.
// ---------------------------------------------------------------------------
try {
  console.log('Hostinger environment detected: Running database migrations...');
  execSync('node database/migrate.js up', { stdio: 'inherit', cwd: __dirname });
  console.log('✅ Database migrations executed successfully.');
} catch (error) {
  console.error('❌ Migration failed during programmatic startup:', error.message);
}

const env = require('./src/config/env');
const logger = require('./src/utils/logger');
const db = require('./src/config/db');
const createApp = require('./src/app');

/** Ensure all configured storage directories exist on boot. */
function ensureStorageDirs() {
  const dirs = [
    env.storage.uploadDir,
    env.storage.documentDir,
    env.storage.payslipDir,
    env.storage.backupDir,
  ];
  for (const dir of dirs) {
    const abs = path.resolve(dir);
    fs.mkdirSync(abs, { recursive: true });
  }
  logger.info('Storage directories ready');
}

async function start() {
  try {
    ensureStorageDirs();

    // Verify DB connectivity early so misconfiguration fails fast.
    try {
      await db.healthCheck();
      logger.info('Database connectivity verified');
    } catch (dbErr) {
      logger.error('Database health check failed - is MySQL running and migrated?', dbErr.message);
      if (env.app.isProd) process.exit(1);
    }

    const app = createApp();

    // Serve the glassmorphism frontend assets out of the box. The static
    // mount also lives in the app factory (src/app.js, correctly ordered
    // before the SPA fallback); this explicit mount documents the intent
    // at the boot layer and guarantees /public is served on Hostinger.
    app.use(express.static(path.join(__dirname, 'public')));

    // Dynamic port: Hostinger's web proxy assigns the internal port via
    // process.env.PORT. Falling back to 3000 for local development.
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
      logger.info(`${env.app.name} listening on port ${PORT} [${env.app.env}]`);
      logger.info(`Open ${env.app.url}`);
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} received - shutting down gracefully`);
      server.close(async () => {
        await db.close();
        process.exit(0);
      });
      // Force-exit if connections do not drain in time.
      setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection', reason);
    });
  } catch (err) {
    logger.error('Fatal startup error', err);
    process.exit(1);
  }
}

start();
