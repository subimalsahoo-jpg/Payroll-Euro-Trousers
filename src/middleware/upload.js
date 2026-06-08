'use strict';

/**
 * Secure file upload middleware (Module 14 - Document Management).
 * -------------------------------------------------------------
 * Uses multer with a UUID-based filename so the stored name never
 * reveals the original (prevents enumeration / scraping). Files land
 * in an isolated, non-web-served storage directory; access is brokered
 * only through authorised controller endpoints that look up the UUID.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const env = require('../config/env');
const { AppError } = require('../utils/response');

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

let upload;

try {
  // eslint-disable-next-line global-require
  const multer = require('multer');

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.resolve(env.storage.documentDir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // Opaque storage key; original name is persisted separately in DB.
      const uuid = crypto.randomUUID();
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      cb(null, `${uuid}${ext}`);
    },
  });

  function fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new AppError('Unsupported file type', 422, 'BAD_FILE_TYPE'));
    }
    return cb(null, true);
  }

  upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: env.storage.maxUploadMb * 1024 * 1024, files: 1 },
  });
} catch (_e) {
  // Fallback so route files can load even before multer is installed.
  const passthrough = () => (req, _res, next) => next();
  upload = { single: passthrough, array: passthrough, none: passthrough };
}

module.exports = { upload, ALLOWED_MIME };
