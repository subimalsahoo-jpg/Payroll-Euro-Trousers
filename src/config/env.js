'use strict';

/**
 * Centralised environment configuration loader.
 * -------------------------------------------------------------
 * Reads from process.env (populated by dotenv) and exposes a
 * typed, validated, immutable configuration object. Keeping all
 * env access here means the rest of the codebase never touches
 * process.env directly, which makes the app stateless and easy
 * to deploy on clustered hosts (e.g. Hostinger Application Manager).
 */

require('dotenv').config();

/** Parse an integer env var with a fallback. */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Parse a boolean env var ("true"/"1"/"yes") with a fallback. */
function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(raw).toLowerCase());
}

/** Parse a comma-separated list env var into a trimmed array. */
function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const env = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: int('PORT', 3000),
    name: process.env.APP_NAME || 'Euro-Trousers HRMS & Payroll',
    company: process.env.APP_COMPANY || 'Euro-Trousers',
    url: process.env.APP_URL || 'http://localhost:3000',
    get isProd() {
      return this.env === 'production';
    },
  },

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    database: process.env.DB_NAME || 'divya_moolya_hrms',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
    timezone: process.env.DB_TIMEZONE || '+04:00',
  },

  security: {
    sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
    jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
    bcryptRounds: int('BCRYPT_SALT_ROUNDS', 12),
    cookieSecure: bool('COOKIE_SECURE', false),
    enable2FA: bool('ENABLE_2FA', false),
  },

  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: int('RATE_LIMIT_MAX', 300),
    authMax: int('AUTH_RATE_LIMIT_MAX', 10),
  },

  i18n: {
    defaultLocale: process.env.DEFAULT_LOCALE || 'en',
    supportedLocales: list('SUPPORTED_LOCALES', ['en', 'ar']),
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'AED',
  },

  storage: {
    uploadDir: process.env.UPLOAD_DIR || 'storage/uploads',
    documentDir: process.env.DOCUMENT_DIR || 'storage/documents',
    payslipDir: process.env.PAYSLIP_DIR || 'storage/payslips',
    backupDir: process.env.BACKUP_DIR || 'storage/backups',
    maxUploadMb: int('MAX_UPLOAD_MB', 10),
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || 'Euro-Trousers HRMS <no-reply@example.com>',
  },

  wps: {
    employerId: process.env.WPS_EMPLOYER_ID || '000000000000000',
    bankRoutingCode: process.env.WPS_BANK_ROUTING_CODE || '000000000',
    sifVersion: process.env.WPS_SIF_VERSION || '1.0',
  },
};

module.exports = Object.freeze(env);
