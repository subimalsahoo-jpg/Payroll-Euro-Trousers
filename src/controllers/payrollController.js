'use strict';

/**
 * Payroll controller (Module 5).
 * -------------------------------------------------------------
 * Manages compensation profiles (salary structures) and variable
 * modifiers: salary advances, loans (with amortisation), bonuses and
 * incentives. Revisions to a salary structure are written to the
 * permanent salary_revision_history ledger (Module 6 support).
 */

const db = require('../config/db');
const money = require('../utils/money');
const { ok, created, AppError } = require('../utils/response');
const { validate } = require('../utils/validators');
const audit = require('../services/auditService');
const engine = require('../services/payrollEngine');

/** GET /api/payroll/structure/:employeeId — current + history. */
async function getStructure(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const current = await db.queryOne(
    'SELECT * FROM salary_structures WHERE employee_id = :e AND is_current = 1 ORDER BY effective_from DESC LIMIT 1',
    { e: employeeId }
  );
  const history = await db.query(
    'SELECT * FROM salary_structures WHERE employee_id = :e ORDER BY effective_from DESC',
    { e: employeeId }
  );
  const revisions = await db.query(
    'SELECT * FROM salary_revision_history WHERE employee_id = :e ORDER BY created_at DESC',
    { e: employeeId }
  );
  // Provide a computed gross preview for the current structure.
  let preview = null;
  if (current) {
    preview = engine.computePayslip({ structure: current });
  }
  return ok(res, { current, history, revisions, preview });
}

/** PUT /api/payroll/structure/:employeeId — set a new current structure. */
async function setStructure(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = validate(req.body, {
    effective_from: { required: true, type: 'date' },
    basic_salary: { required: true, type: 'amount' },
    housing_allowance: { type: 'amount', default: 0 },
    transport_allowance: { type: 'amount', default: 0 },
    food_allowance: { type: 'amount', default: 0 },
    other_allowance: { type: 'amount', default: 0 },
    currency: { type: 'string', default: 'AED' },
    reason: { type: 'string' },
  });

  await db.transaction(async (tx) => {
    const previous = await tx.queryOne(
      'SELECT * FROM salary_structures WHERE employee_id = :e AND is_current = 1 LIMIT 1',
      { e: employeeId }
    );
    // Retire prior current structure.
    await tx.query('UPDATE salary_structures SET is_current = 0 WHERE employee_id = :e', { e: employeeId });
    await tx.query(
      `INSERT INTO salary_structures
         (employee_id, effective_from, basic_salary, housing_allowance, transport_allowance,
          food_allowance, other_allowance, currency, is_current)
       VALUES (:e, :effective_from, :basic_salary, :housing_allowance, :transport_allowance,
               :food_allowance, :other_allowance, :currency, 1)`,
      { ...b, e: employeeId }
    );
    // Permanent revision ledger entry.
    await tx.query(
      `INSERT INTO salary_revision_history (employee_id, old_structure, new_structure, reason, revised_by)
       VALUES (:e, :old, :new, :reason, :by)`,
      {
        e: employeeId,
        old: previous ? JSON.stringify(previous) : null,
        new: JSON.stringify(b),
        reason: b.reason || null,
        by: req.user.id,
      }
    );
    await audit.recordAudit({ actorUserId: req.user.id, action: 'REVISE', entityType: 'salary_structure', entityId: employeeId, before: previous, after: b, ip: req.ip }, tx);
  });
  return created(res, null, 'Salary structure updated');
}

/* ----------------------------- Advances ------------------------------ */
async function listAdvances(req, res) {
  const employee = req.query.employee ? parseInt(req.query.employee, 10) : null;
  const rows = await db.query(
    `SELECT sa.*, e.employee_code, e.first_name, e.last_name
       FROM salary_advances sa JOIN employees e ON e.id = sa.employee_id
      WHERE e.company_id = :c ${employee ? 'AND sa.employee_id = :employee' : ''}
      ORDER BY sa.request_date DESC`,
    { c: req.user.companyId, employee }
  );
  return ok(res, rows);
}

async function createAdvance(req, res) {
  const b = validate(req.body, {
    employee_id: { required: true, type: 'int' },
    amount: { required: true, type: 'amount' },
    request_date: { required: true, type: 'date' },
    status: { type: 'string', default: 'approved', enum: ['pending', 'approved', 'recovered', 'rejected'] },
    notes: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO salary_advances (employee_id, amount, request_date, status, notes)
     VALUES (:employee_id, :amount, :request_date, :status, :notes)`,
    b
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'salary_advance', entityId: r.insertId, after: b, ip: req.ip });
  return created(res, { id: r.insertId });
}

/* ------------------------------- Loans -------------------------------- */
async function listLoans(req, res) {
  const employee = req.query.employee ? parseInt(req.query.employee, 10) : null;
  const rows = await db.query(
    `SELECT l.*, e.employee_code, e.first_name, e.last_name
       FROM loans l JOIN employees e ON e.id = l.employee_id
      WHERE e.company_id = :c ${employee ? 'AND l.employee_id = :employee' : ''}
      ORDER BY l.start_date DESC`,
    { c: req.user.companyId, employee }
  );
  return ok(res, rows);
}

async function createLoan(req, res) {
  const b = validate(req.body, {
    employee_id: { required: true, type: 'int' },
    principal_amount: { required: true, type: 'amount' },
    monthly_installment: { required: true, type: 'amount' },
    start_date: { required: true, type: 'date' },
    notes: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO loans (employee_id, principal_amount, monthly_installment, outstanding_amount, start_date, notes)
     VALUES (:employee_id, :principal_amount, :monthly_installment, :principal_amount, :start_date, :notes)`,
    b
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'loan', entityId: r.insertId, after: b, ip: req.ip });
  return created(res, { id: r.insertId });
}

/* --------------------------- Adjustments ------------------------------ */
async function listAdjustments(req, res) {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
  const rows = await db.query(
    `SELECT pa.*, e.employee_code, e.first_name, e.last_name
       FROM payroll_adjustments pa JOIN employees e ON e.id = pa.employee_id
      WHERE e.company_id = :c AND pa.period_year = :y AND pa.period_month = :m
      ORDER BY pa.created_at DESC`,
    { c: req.user.companyId, y: year, m: month }
  );
  return ok(res, rows, 'OK', 200, { year, month });
}

async function createAdjustment(req, res) {
  const b = validate(req.body, {
    employee_id: { required: true, type: 'int' },
    adj_type: { required: true, type: 'string', enum: ['bonus', 'incentive', 'deduction', 'other'] },
    amount: { required: true, type: 'amount' },
    period_year: { required: true, type: 'int' },
    period_month: { required: true, type: 'int' },
    description: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO payroll_adjustments (employee_id, adj_type, amount, period_year, period_month, description)
     VALUES (:employee_id, :adj_type, :amount, :period_year, :period_month, :description)`,
    b
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'payroll_adjustment', entityId: r.insertId, after: b, ip: req.ip });
  return created(res, { id: r.insertId });
}

/** GET /api/payroll/overtime-preview — quick overtime calculator. */
async function overtimePreview(req, res) {
  const basic = req.query.basic || '0';
  const hours = {
    normal: Number(req.query.normal || 0),
    sunday: Number(req.query.sunday || 0),
    holiday: Number(req.query.holiday || 0),
  };
  const result = engine.computeOvertime(basic, hours);
  return ok(res, { hourlyRate: engine.hourlyRate(basic), ...result, formatted: money.format(result.total) });
}

module.exports = {
  getStructure, setStructure,
  listAdvances, createAdvance,
  listLoans, createLoan,
  listAdjustments, createAdjustment,
  overtimePreview,
};
