'use strict';

/**
 * UAE Compliance Engine controller (Module 11).
 * -------------------------------------------------------------
 * WPS SIF file generation, MOL/MOHRE validation filters, and the
 * preventive early-warning system for upcoming document expiries
 * (visa, passport, Emirates ID, contract).
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const env = require('../config/env');
const { ok, AppError } = require('../utils/response');
const wps = require('../services/wpsService');
const expiry = require('../services/expiryMonitor');
const audit = require('../services/auditService');
const notifier = require('../services/notificationService');

/**
 * GET /api/compliance/wps/:runId.sif — generate & download the WPS SIF.
 * Persists a wps_exports ledger row for traceability.
 */
async function generateWps(req, res) {
  const runId = parseInt(req.params.runId, 10);
  const run = await db.queryOne('SELECT * FROM payroll_runs WHERE id=:id AND company_id=:c', { id: runId, c: req.user.companyId });
  if (!run) throw new AppError('Payroll run not found', 404, 'NOT_FOUND');
  if (!['approved', 'locked', 'paid', 'processed'].includes(run.status)) {
    throw new AppError('Payroll must be processed before WPS generation', 409, 'NOT_READY');
  }

  const details = await db.query(
    `SELECT e.employee_code, e.labour_card_no, e.iban, e.routing_code,
            p.net_salary, p.basic_salary, p.worked_days
       FROM payslips p JOIN employees e ON e.id = p.employee_id
      WHERE p.payroll_run_id = :id ORDER BY e.employee_code`,
    { id: runId }
  );
  if (!details.length) throw new AppError('No payslips to export', 422, 'EMPTY');

  const sif = wps.buildSif(run, details);

  // Persist the .sif file alongside payslips for audit/re-download.
  const dir = path.resolve(env.storage.payslipDir);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `WPS_${run.period_year}-${String(run.period_month).padStart(2, '0')}_run${runId}.sif`;
  fs.writeFileSync(path.join(dir, fileName), sif.content, 'utf8');

  await db.query(
    `INSERT INTO wps_exports (payroll_run_id, file_name, record_count, total_amount, sif_checksum, generated_by)
     VALUES (:run, :file, :cnt, :total, :sum, :by)`,
    { run: runId, file: fileName, cnt: sif.recordCount, total: sif.totalAmount, sum: sif.checksum, by: req.user.id }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'WPS_EXPORT', entityType: 'payroll_run', entityId: runId, after: { records: sif.recordCount }, ip: req.ip });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(sif.content);
}

/**
 * GET /api/compliance/mol-validation — MOHRE/MOL rule checks.
 * Flags missing labour cards, IBANs, expired documents and contract gaps.
 */
async function molValidation(req, res) {
  const c = req.user.companyId;
  const issues = await db.query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name,
            CASE WHEN e.labour_card_no IS NULL OR e.labour_card_no = '' THEN 1 ELSE 0 END AS missing_labour_card,
            CASE WHEN e.iban IS NULL OR e.iban = '' THEN 1 ELSE 0 END AS missing_iban,
            (SELECT COUNT(*) FROM employee_identity_documents d
              WHERE d.employee_id = e.id AND d.doc_type='visa' AND d.expiry_date < CURDATE()) AS expired_visa,
            (SELECT COUNT(*) FROM employee_identity_documents d
              WHERE d.employee_id = e.id AND d.doc_type='emirates_id' AND d.expiry_date < CURDATE()) AS expired_eid
       FROM employees e
      WHERE e.company_id = :c AND e.employment_status NOT IN ('inactive','terminated')
     HAVING missing_labour_card=1 OR missing_iban=1 OR expired_visa>0 OR expired_eid>0`,
    { c }
  );
  return ok(res, issues, 'OK', 200, { count: issues.length });
}

/** GET /api/compliance/expiries?days=30 — preventive expiry warnings. */
async function expiries(req, res) {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 180);
  const rows = await expiry.upcomingExpiries(req.user.companyId, days);
  const summary = await expiry.expirySummary(req.user.companyId, days);
  return ok(res, { items: rows, summary }, 'OK', 200, { days });
}

/**
 * POST /api/compliance/expiries/notify — fan out expiry warning notifications.
 * Typically invoked by a daily scheduler (cron) but also callable manually.
 */
async function notifyExpiries(req, res) {
  const days = Math.min(parseInt(req.body.days, 10) || 30, 180);
  const rows = await expiry.upcomingExpiries(req.user.companyId, days);
  let sent = 0;
  for (const item of rows) {
    await notifier.notifyDocumentExpiry(item);
    sent += 1;
  }
  // Birthday celebrations (Module 12) handled opportunistically here too.
  const birthdays = await expiry.todaysBirthdays(req.user.companyId);
  for (const emp of birthdays) {
    await notifier.notifyBirthday(emp);
  }
  return ok(res, { expiryAlerts: sent, birthdayAlerts: birthdays.length }, 'Notifications dispatched');
}

module.exports = { generateWps, molValidation, expiries, notifyExpiries };
