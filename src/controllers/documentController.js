'use strict';

/**
 * Secure Document Management controller (Module 14).
 * -------------------------------------------------------------
 * Physical files (passport copies, visa pages, Emirates ID scans,
 * contracts, certificates) are stored in an isolated, non-web-served
 * directory under a UUID filename. The DB row is the only index linking
 * a download to a stored file, preventing directory enumeration/scraping.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const env = require('../config/env');
const { ok, created, AppError } = require('../utils/response');
const audit = require('../services/auditService');

const VALID_CATEGORIES = ['passport_copy', 'visa_page', 'emirates_id_scan', 'contract', 'certificate', 'photo', 'other'];

/** GET /api/documents?employee= — list document metadata (never raw files). */
async function list(req, res) {
  const employee = req.query.employee ? parseInt(req.query.employee, 10) : null;
  const rows = await db.query(
    `SELECT d.id, d.uuid, d.category, d.original_name, d.mime_type, d.size_bytes, d.created_at,
            e.employee_code, e.first_name, e.last_name
       FROM documents d
       LEFT JOIN employees e ON e.id = d.employee_id
      WHERE (e.company_id = :c OR d.employee_id IS NULL)
        ${employee ? 'AND d.employee_id = :employee' : ''}
      ORDER BY d.created_at DESC`,
    { c: req.user.companyId, employee }
  );
  return ok(res, rows);
}

/**
 * POST /api/documents — multipart upload (field "file").
 * The upload middleware has already stored the file with a UUID name;
 * here we persist the metadata row that brokers future access.
 */
async function upload(req, res) {
  if (!req.file) throw new AppError('No file uploaded', 422, 'NO_FILE');
  const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
  const employeeId = req.body.employee_id ? parseInt(req.body.employee_id, 10) : null;
  const uuid = crypto.randomUUID();

  const r = await db.query(
    `INSERT INTO documents (uuid, employee_id, category, original_name, stored_name, mime_type, size_bytes, uploaded_by)
     VALUES (:uuid, :employee_id, :category, :original, :stored, :mime, :size, :by)`,
    {
      uuid,
      employee_id: employeeId,
      category,
      original: req.file.originalname,
      stored: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
      by: req.user.id,
    }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPLOAD', entityType: 'document', entityId: r.insertId, after: { category, employeeId }, ip: req.ip });
  return created(res, { id: r.insertId, uuid }, 'Document uploaded');
}

/** GET /api/documents/:uuid/download — stream the file via its opaque UUID. */
async function download(req, res) {
  const doc = await db.queryOne(
    `SELECT d.*, e.company_id FROM documents d LEFT JOIN employees e ON e.id = d.employee_id WHERE d.uuid = :u`,
    { u: req.params.uuid }
  );
  if (!doc) throw new AppError('Document not found', 404, 'NOT_FOUND');
  // Tenancy guard: documents linked to an employee must match the caller's company.
  if (doc.company_id && doc.company_id !== req.user.companyId) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  // ESS guard: employees may only fetch their own documents.
  if (req.user.role === 'EMPLOYEE' && doc.employee_id !== req.user.employeeId) {
    throw new AppError('You can only access your own documents', 403, 'FORBIDDEN');
  }

  const filePath = path.join(path.resolve(env.storage.documentDir), doc.stored_name);
  if (!fs.existsSync(filePath)) throw new AppError('Stored file missing', 410, 'GONE');

  await audit.recordAudit({ actorUserId: req.user.id, action: 'DOWNLOAD', entityType: 'document', entityId: doc.id, ip: req.ip });
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.original_name}"`);
  return fs.createReadStream(filePath).pipe(res);
}

/** DELETE /api/documents/:uuid */
async function remove(req, res) {
  const doc = await db.queryOne('SELECT * FROM documents WHERE uuid = :u', { u: req.params.uuid });
  if (!doc) throw new AppError('Document not found', 404, 'NOT_FOUND');
  const filePath = path.join(path.resolve(env.storage.documentDir), doc.stored_name);
  await db.query('DELETE FROM documents WHERE id = :id', { id: doc.id });
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (_e) { /* best effort */ }
  }
  await audit.recordAudit({ actorUserId: req.user.id, action: 'DELETE', entityType: 'document', entityId: doc.id, ip: req.ip });
  return ok(res, null, 'Document deleted');
}

module.exports = { list, upload, download, remove, VALID_CATEGORIES };
