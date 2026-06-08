'use strict';

/**
 * Salary Slip controller (Module 7).
 * -------------------------------------------------------------
 * Generates and serves PDF salary slips with a QR verification hash,
 * supports employee acknowledgment and manager authorization, optional
 * email dispatch, and public verification of a slip via its hash.
 */

const fs = require('fs');
const db = require('../config/db');
const { ok, AppError } = require('../utils/response');
const audit = require('../services/auditService');
const pdfService = require('../services/pdfService');
const qrService = require('../services/qrService');
const notifier = require('../services/notificationService');

/** Load a payslip joined with employee + run context. */
async function loadSlip(companyId, payslipId) {
  return db.queryOne(
    `SELECT p.*, e.employee_code, e.first_name, e.last_name, e.work_email, e.company_id,
            d.name AS department_name, dg.title AS designation,
            r.period_year, r.period_month, r.status AS run_status
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       JOIN payroll_runs r ON r.id = p.payroll_run_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations dg ON dg.id = e.designation_id
      WHERE p.id = :id AND e.company_id = :c`,
    { id: payslipId, c: companyId }
  );
}

/** GET /api/payslips?run=&employee= — list payslips. */
async function list(req, res) {
  const run = req.query.run ? parseInt(req.query.run, 10) : null;
  const employee = req.query.employee ? parseInt(req.query.employee, 10) : null;
  const rows = await db.query(
    `SELECT p.id, p.payroll_run_id, p.net_salary, p.gross_salary, p.currency, p.slip_pdf_path,
            p.employee_ack_at, p.manager_auth_at, e.employee_code, e.first_name, e.last_name,
            r.period_year, r.period_month
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       JOIN payroll_runs r ON r.id = p.payroll_run_id
      WHERE e.company_id = :c
        ${run ? 'AND p.payroll_run_id = :run' : ''}
        ${employee ? 'AND p.employee_id = :employee' : ''}
      ORDER BY r.period_year DESC, r.period_month DESC, e.last_name`,
    { c: req.user.companyId, run, employee }
  );
  return ok(res, rows);
}

/** POST /api/payslips/:id/generate — (re)build the PDF + QR hash. */
async function generate(req, res) {
  const id = parseInt(req.params.id, 10);
  const slip = await loadSlip(req.user.companyId, id);
  if (!slip) throw new AppError('Payslip not found', 404, 'NOT_FOUND');

  const hash = qrService.computeHash(slip);
  const qrDataUrl = await qrService.generateQrDataUrl(slip, hash);
  const filePath = await pdfService.generatePayslip({
    payslip: slip,
    employee: slip,
    run: { period_year: slip.period_year, period_month: slip.period_month },
    qrDataUrl,
  });

  await db.query('UPDATE payslips SET slip_pdf_path = :p, qr_hash = :h WHERE id = :id', { p: filePath, h: hash, id });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'GENERATE', entityType: 'payslip', entityId: id, ip: req.ip });
  return ok(res, { id, qrHash: hash, path: filePath }, 'Payslip generated');
}

/** GET /api/payslips/:id/download — stream the PDF (generating if needed). */
async function download(req, res) {
  const id = parseInt(req.params.id, 10);
  const slip = await loadSlip(req.user.companyId, id);
  if (!slip) throw new AppError('Payslip not found', 404, 'NOT_FOUND');

  // ESS guard: an EMPLOYEE may only download their own slip.
  if (req.user.role === 'EMPLOYEE' && req.user.employeeId !== slip.employee_id) {
    throw new AppError('You can only download your own payslip', 403, 'FORBIDDEN');
  }

  let filePath = slip.slip_pdf_path;
  if (!filePath || !fs.existsSync(filePath)) {
    const hash = qrService.computeHash(slip);
    const qrDataUrl = await qrService.generateQrDataUrl(slip, hash);
    filePath = await pdfService.generatePayslip({
      payslip: slip,
      employee: slip,
      run: { period_year: slip.period_year, period_month: slip.period_month },
      qrDataUrl,
    });
    await db.query('UPDATE payslips SET slip_pdf_path = :p, qr_hash = :h WHERE id = :id', { p: filePath, h: hash, id });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip_${slip.employee_code}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
}

/** POST /api/payslips/:id/email — dispatch the slip to the employee. */
async function emailSlip(req, res) {
  const id = parseInt(req.params.id, 10);
  const slip = await loadSlip(req.user.companyId, id);
  if (!slip) throw new AppError('Payslip not found', 404, 'NOT_FOUND');
  const to = slip.work_email;
  if (!to) throw new AppError('Employee has no email on file', 422, 'NO_EMAIL');

  const status = await notifier.sendEmail({
    to,
    subject: `[Euro-Trousers] Salary Slip ${slip.period_year}-${String(slip.period_month).padStart(2, '0')}`,
    html: `<p>Dear ${slip.first_name},</p><p>Your salary slip is available in the HRMS portal.</p>`,
  });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'EMAIL', entityType: 'payslip', entityId: id, after: { status }, ip: req.ip });
  return ok(res, { status }, 'Email dispatched');
}

/** POST /api/payslips/:id/acknowledge — employee acknowledgment signature. */
async function acknowledge(req, res) {
  const id = parseInt(req.params.id, 10);
  const slip = await loadSlip(req.user.companyId, id);
  if (!slip) throw new AppError('Payslip not found', 404, 'NOT_FOUND');
  if (req.user.role === 'EMPLOYEE' && req.user.employeeId !== slip.employee_id) {
    throw new AppError('You can only acknowledge your own payslip', 403, 'FORBIDDEN');
  }
  await db.query('UPDATE payslips SET employee_ack_at = NOW() WHERE id = :id', { id });
  return ok(res, null, 'Payslip acknowledged');
}

/** POST /api/payslips/:id/authorize — manager/HR authorization block. */
async function authorizeSlip(req, res) {
  const id = parseInt(req.params.id, 10);
  await db.query('UPDATE payslips SET manager_auth_by = :u, manager_auth_at = NOW() WHERE id = :id', { u: req.user.id, id });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'AUTHORIZE', entityType: 'payslip', entityId: id, ip: req.ip });
  return ok(res, null, 'Payslip authorized');
}

/** GET /api/payslips/verify?id=&h= — PUBLIC verification of slip authenticity. */
async function verify(req, res) {
  const id = parseInt(req.query.id, 10);
  const hash = req.query.h;
  const slip = await db.queryOne('SELECT * FROM payslips WHERE id = :id', { id });
  if (!slip) return ok(res, { valid: false, reason: 'not_found' });
  const valid = qrService.verifyHash(slip, hash) && slip.qr_hash === hash;
  return ok(res, {
    valid,
    payslipId: id,
    period: valid ? `${slip.payroll_run_id}` : null,
    net: valid ? slip.net_salary : null,
    currency: valid ? slip.currency : null,
  });
}

module.exports = { list, generate, download, emailSlip, acknowledge, authorizeSlip, verify };
