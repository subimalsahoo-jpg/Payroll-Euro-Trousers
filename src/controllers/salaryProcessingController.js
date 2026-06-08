'use strict';

/**
 * Salary Processing controller (Module 6).
 * -------------------------------------------------------------
 * Monthly salary generation for an individual or a bulk batch, a
 * multi-stage approval workflow (draft -> processed -> approved ->
 * locked), the Salary Register, and a permanent revision/lock trail.
 * The "Payroll Lock" freezes historical rows from further edits.
 *
 * Everything runs inside ACID transactions so a partial batch never
 * leaves the ledger inconsistent.
 */

const db = require('../config/db');
const money = require('../utils/money');
const { ok, created, AppError } = require('../utils/response');
const { validate } = require('../utils/validators');
const audit = require('../services/auditService');
const engine = require('../services/payrollEngine');
const notifier = require('../services/notificationService');

/** Build the period date window [from, to] for a year/month. */
function periodWindow(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 0).toISOString().slice(0, 10); // last day
  return { from, to };
}

/** Gather overtime hours (split) + worked days for one employee in a period. */
async function overtimeForEmployee(tx, employeeId, from, to) {
  const row = await tx.queryOne(
    `SELECT
        COALESCE(SUM(CASE WHEN ph.id IS NULL AND DAYOFWEEK(a.work_date) <> 1 THEN a.overtime_minutes ELSE 0 END),0) AS normal_min,
        COALESCE(SUM(CASE WHEN ph.id IS NULL AND DAYOFWEEK(a.work_date) = 1 THEN a.overtime_minutes ELSE 0 END),0) AS sunday_min,
        COALESCE(SUM(CASE WHEN ph.id IS NOT NULL THEN a.overtime_minutes ELSE 0 END),0) AS holiday_min,
        COALESCE(SUM(a.status IN ('present','late','half_day')),0) AS worked_days
       FROM attendance a
       LEFT JOIN public_holidays ph ON ph.holiday_date = a.work_date
      WHERE a.employee_id = :e AND a.work_date BETWEEN :from AND :to`,
    { e: employeeId, from, to }
  );
  return {
    hours: {
      normal: (row.normal_min || 0) / 60,
      sunday: (row.sunday_min || 0) / 60,
      holiday: (row.holiday_min || 0) / 60,
    },
    workedDays: row.worked_days || 0,
  };
}

/** Gather variable modifiers for one employee in a period. */
async function modifiersForEmployee(tx, employeeId, year, month) {
  const adjustments = await tx.query(
    'SELECT adj_type, amount FROM payroll_adjustments WHERE employee_id=:e AND period_year=:y AND period_month=:m',
    { e: employeeId, y: year, m: month }
  );
  let bonus = '0.00';
  let incentive = '0.00';
  let otherDeduction = '0.00';
  for (const a of adjustments) {
    if (a.adj_type === 'bonus') bonus = money.sum(bonus, a.amount);
    else if (a.adj_type === 'incentive') incentive = money.sum(incentive, a.amount);
    else otherDeduction = money.sum(otherDeduction, a.amount);
  }

  // Outstanding approved advances -> recover this period.
  const advances = await tx.query(
    `SELECT id, amount, recovered_amount FROM salary_advances
      WHERE employee_id=:e AND status='approved' AND recovered_amount < amount`,
    { e: employeeId }
  );
  let advanceDeduction = '0.00';
  const advanceUpdates = [];
  for (const adv of advances) {
    const remaining = money.subtract(adv.amount, adv.recovered_amount);
    advanceDeduction = money.sum(advanceDeduction, remaining);
    advanceUpdates.push({ id: adv.id, recovered: adv.amount });
  }

  // Active loans -> one monthly installment (capped at outstanding).
  const loans = await tx.query(
    "SELECT id, monthly_installment, outstanding_amount FROM loans WHERE employee_id=:e AND status='active' AND outstanding_amount > 0",
    { e: employeeId }
  );
  let loanDeduction = '0.00';
  const loanUpdates = [];
  for (const loan of loans) {
    const due = money.compare(loan.monthly_installment, loan.outstanding_amount) > 0
      ? loan.outstanding_amount
      : loan.monthly_installment;
    loanDeduction = money.sum(loanDeduction, due);
    loanUpdates.push({ id: loan.id, pay: due, newOutstanding: money.subtract(loan.outstanding_amount, due) });
  }

  return { bonus, incentive, otherDeduction, advanceDeduction, loanDeduction, advanceUpdates, loanUpdates };
}

/** Create or fetch the (draft) payroll run for the scope+period. */
async function ensureRun(tx, companyId, branchId, year, month, userId) {
  let run = await tx.queryOne(
    `SELECT * FROM payroll_runs WHERE company_id=:c AND (branch_id <=> :b) AND period_year=:y AND period_month=:m`,
    { c: companyId, b: branchId, y: year, m: month }
  );
  if (run && ['locked', 'paid'].includes(run.status)) {
    throw new AppError('Payroll for this period is locked', 409, 'PAYROLL_LOCKED');
  }
  if (!run) {
    const r = await tx.query(
      `INSERT INTO payroll_runs (company_id, branch_id, period_year, period_month, status, processed_by)
       VALUES (:c, :b, :y, :m, 'draft', :u)`,
      { c: companyId, b: branchId, y: year, m: month, u: userId }
    );
    run = await tx.queryOne('SELECT * FROM payroll_runs WHERE id = :id', { id: r.insertId });
  }
  return run;
}

/** Process a single employee into a payslip row within the run. */
async function processEmployee(tx, run, employeeId, year, month) {
  const structure = await tx.queryOne(
    'SELECT * FROM salary_structures WHERE employee_id=:e AND is_current=1 ORDER BY effective_from DESC LIMIT 1',
    { e: employeeId }
  );
  if (!structure) return null; // no compensation profile -> skip

  const { from, to } = periodWindow(year, month);
  const ot = await overtimeForEmployee(tx, employeeId, from, to);
  const mod = await modifiersForEmployee(tx, employeeId, year, month);

  const slip = engine.computePayslip({
    structure,
    overtimeHours: ot.hours,
    workedDays: ot.workedDays,
    modifiers: {
      advanceDeduction: mod.advanceDeduction,
      loanDeduction: mod.loanDeduction,
      otherDeduction: mod.otherDeduction,
      bonus: mod.bonus,
      incentive: mod.incentive,
    },
  });

  await tx.query(
    `INSERT INTO payslips
       (payroll_run_id, employee_id, basic_salary, housing_allowance, transport_allowance, food_allowance,
        other_allowance, overtime_normal, overtime_sunday, overtime_holiday, bonus, incentive, gross_salary,
        advance_deduction, loan_deduction, other_deduction, total_deductions, net_salary, currency,
        worked_days, overtime_hours)
     VALUES
       (:run, :e, :basic_salary, :housing_allowance, :transport_allowance, :food_allowance,
        :other_allowance, :overtime_normal, :overtime_sunday, :overtime_holiday, :bonus, :incentive, :gross_salary,
        :advance_deduction, :loan_deduction, :other_deduction, :total_deductions, :net_salary, :currency,
        :worked_days, :overtime_hours)
     ON DUPLICATE KEY UPDATE
        basic_salary=VALUES(basic_salary), housing_allowance=VALUES(housing_allowance),
        transport_allowance=VALUES(transport_allowance), food_allowance=VALUES(food_allowance),
        other_allowance=VALUES(other_allowance), overtime_normal=VALUES(overtime_normal),
        overtime_sunday=VALUES(overtime_sunday), overtime_holiday=VALUES(overtime_holiday),
        bonus=VALUES(bonus), incentive=VALUES(incentive), gross_salary=VALUES(gross_salary),
        advance_deduction=VALUES(advance_deduction), loan_deduction=VALUES(loan_deduction),
        other_deduction=VALUES(other_deduction), total_deductions=VALUES(total_deductions),
        net_salary=VALUES(net_salary), worked_days=VALUES(worked_days), overtime_hours=VALUES(overtime_hours)`,
    { run: run.id, e: employeeId, ...slip }
  );

  // Apply modifier recoveries (advances fully recovered, loans amortised).
  for (const u of mod.advanceUpdates) {
    await tx.query("UPDATE salary_advances SET recovered_amount = :r, status='recovered' WHERE id=:id", { r: u.recovered, id: u.id });
  }
  for (const u of mod.loanUpdates) {
    await tx.query(
      "UPDATE loans SET outstanding_amount = :o, status = IF(:o <= 0,'closed','active') WHERE id=:id",
      { o: u.newOutstanding, id: u.id }
    );
  }
  return slip;
}

/** Recompute and persist run totals from its payslips. */
async function refreshRunTotals(tx, runId) {
  const totals = await tx.queryOne(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(gross_salary),0) AS gross,
            COALESCE(SUM(total_deductions),0) AS ded, COALESCE(SUM(net_salary),0) AS net
       FROM payslips WHERE payroll_run_id = :id`,
    { id: runId }
  );
  await tx.query(
    `UPDATE payroll_runs SET employee_count=:cnt, total_gross=:gross, total_deductions=:ded, total_net=:net,
        status = IF(status='draft','processed',status) WHERE id=:id`,
    { cnt: totals.cnt, gross: totals.gross, ded: totals.ded, net: totals.net, id: runId }
  );
  return totals;
}

/** POST /api/salary/process — body: { year, month, branch_id?, employee_id? } */
async function processRun(req, res) {
  const b = validate(req.body, {
    year: { required: true, type: 'int' },
    month: { required: true, type: 'int' },
    branch_id: { type: 'int' },
    employee_id: { type: 'int' },
  });
  const branchId = b.branch_id || null;

  const summary = await db.transaction(async (tx) => {
    const run = await ensureRun(tx, req.user.companyId, branchId, b.year, b.month, req.user.id);

    // Target set: a single employee, or all active employees in scope (bulk batch).
    let employees;
    if (b.employee_id) {
      employees = await tx.query(
        "SELECT id FROM employees WHERE id=:e AND company_id=:c AND employment_status NOT IN ('inactive','terminated')",
        { e: b.employee_id, c: req.user.companyId }
      );
    } else {
      employees = await tx.query(
        `SELECT id FROM employees
          WHERE company_id=:c AND employment_status NOT IN ('inactive','terminated')
            ${branchId ? 'AND branch_id = :b' : ''}`,
        { c: req.user.companyId, b: branchId }
      );
    }

    let processed = 0;
    for (const emp of employees) {
      const slip = await processEmployee(tx, run, emp.id, b.year, b.month);
      if (slip) processed += 1;
    }
    const totals = await refreshRunTotals(tx, run.id);
    await audit.recordAudit({ actorUserId: req.user.id, action: 'PROCESS', entityType: 'payroll_run', entityId: run.id, after: { processed, ...totals }, ip: req.ip }, tx);
    return { runId: run.id, processed, totals };
  });

  notifier.notifyPayrollCompleted(summary.runId, b.year, b.month).catch(() => {});
  return created(res, summary, 'Payroll processed');
}

/** POST /api/salary/runs/:id/approve */
async function approveRun(req, res) {
  const id = parseInt(req.params.id, 10);
  const run = await db.queryOne('SELECT * FROM payroll_runs WHERE id=:id AND company_id=:c', { id, c: req.user.companyId });
  if (!run) throw new AppError('Payroll run not found', 404, 'NOT_FOUND');
  if (run.status !== 'processed') throw new AppError(`Cannot approve a run in status "${run.status}"`, 409, 'INVALID_TRANSITION');
  await db.query("UPDATE payroll_runs SET status='approved', approved_by=:u WHERE id=:id", { u: req.user.id, id });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'APPROVE', entityType: 'payroll_run', entityId: id, ip: req.ip });
  return ok(res, null, 'Payroll approved');
}

/** POST /api/salary/runs/:id/lock — freezes the run permanently. */
async function lockRun(req, res) {
  const id = parseInt(req.params.id, 10);
  const run = await db.queryOne('SELECT * FROM payroll_runs WHERE id=:id AND company_id=:c', { id, c: req.user.companyId });
  if (!run) throw new AppError('Payroll run not found', 404, 'NOT_FOUND');
  if (!['approved', 'processed'].includes(run.status)) {
    throw new AppError(`Cannot lock a run in status "${run.status}"`, 409, 'INVALID_TRANSITION');
  }
  await db.query("UPDATE payroll_runs SET status='locked', locked_by=:u, locked_at=NOW() WHERE id=:id", { u: req.user.id, id });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'LOCK', entityType: 'payroll_run', entityId: id, ip: req.ip });
  return ok(res, null, 'Payroll locked');
}

/** GET /api/salary/runs */
async function listRuns(req, res) {
  const rows = await db.query(
    `SELECT pr.*, b.name AS branch_name
       FROM payroll_runs pr LEFT JOIN branches b ON b.id = pr.branch_id
      WHERE pr.company_id = :c ORDER BY pr.period_year DESC, pr.period_month DESC`,
    { c: req.user.companyId }
  );
  return ok(res, rows);
}

/** GET /api/salary/runs/:id/register — the Salary Register. */
async function salaryRegister(req, res) {
  const id = parseInt(req.params.id, 10);
  const run = await db.queryOne('SELECT * FROM payroll_runs WHERE id=:id AND company_id=:c', { id, c: req.user.companyId });
  if (!run) throw new AppError('Payroll run not found', 404, 'NOT_FOUND');
  const rows = await db.query(
    `SELECT p.*, e.employee_code, e.first_name, e.last_name, d.name AS department
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE p.payroll_run_id = :id
      ORDER BY e.last_name`,
    { id }
  );
  return ok(res, { run, register: rows });
}

module.exports = { processRun, approveRun, lockRun, listRuns, salaryRegister };
