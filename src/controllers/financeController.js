'use strict';

/**
 * Finance Reports Workspace controller (Module 9).
 * -------------------------------------------------------------
 * Cost reporting (payroll summary, department cost centers, salary
 * register), operational analyses (overtime cost, outstanding advances)
 * and a Bank Transfer Export engine producing a standardised CSV for
 * institutional file ingestion.
 */

const db = require('../config/db');
const money = require('../utils/money');
const { ok, AppError } = require('../utils/response');
const audit = require('../services/auditService');

/** GET /api/finance/payroll-summary?year=&month= */
async function payrollSummary(req, res) {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
  const summary = await db.queryOne(
    `SELECT COALESCE(SUM(total_gross),0) AS gross, COALESCE(SUM(total_deductions),0) AS deductions,
            COALESCE(SUM(total_net),0) AS net, COALESCE(SUM(employee_count),0) AS employees
       FROM payroll_runs WHERE company_id=:c AND period_year=:y AND period_month=:m`,
    { c: req.user.companyId, y: year, m: month }
  );
  return ok(res, summary, 'OK', 200, { year, month });
}

/** GET /api/finance/department-cost?year=&month= */
async function departmentCost(req, res) {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
  const rows = await db.query(
    `SELECT d.name AS department, d.cost_center,
            COUNT(DISTINCT p.employee_id) AS headcount,
            COALESCE(SUM(p.gross_salary),0) AS gross,
            COALESCE(SUM(p.net_salary),0) AS net
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id
       LEFT JOIN payslips p ON p.employee_id = e.id
       LEFT JOIN payroll_runs r ON r.id = p.payroll_run_id AND r.period_year=:y AND r.period_month=:m
      WHERE d.company_id = :c
      GROUP BY d.id ORDER BY net DESC`,
    { c: req.user.companyId, y: year, m: month }
  );
  return ok(res, rows, 'OK', 200, { year, month });
}

/** GET /api/finance/overtime-cost?year=&month= */
async function overtimeCost(req, res) {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
  const rows = await db.query(
    `SELECT e.employee_code, e.first_name, e.last_name, d.name AS department,
            p.overtime_hours,
            (p.overtime_normal + p.overtime_sunday + p.overtime_holiday) AS overtime_cost,
            p.overtime_normal, p.overtime_sunday, p.overtime_holiday
       FROM payslips p
       JOIN payroll_runs r ON r.id = p.payroll_run_id
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE r.company_id=:c AND r.period_year=:y AND r.period_month=:m
        AND (p.overtime_normal + p.overtime_sunday + p.overtime_holiday) > 0
      ORDER BY overtime_cost DESC`,
    { c: req.user.companyId, y: year, m: month }
  );
  const total = money.sum(rows.map((r) => r.overtime_cost));
  return ok(res, rows, 'OK', 200, { year, month, totalOvertimeCost: total });
}

/** GET /api/finance/outstanding-advances */
async function outstandingAdvances(req, res) {
  const rows = await db.query(
    `SELECT e.employee_code, e.first_name, e.last_name,
            sa.amount, sa.recovered_amount, (sa.amount - sa.recovered_amount) AS outstanding,
            sa.status, sa.request_date
       FROM salary_advances sa JOIN employees e ON e.id = sa.employee_id
      WHERE e.company_id=:c AND sa.status IN ('approved','pending') AND sa.recovered_amount < sa.amount
      ORDER BY outstanding DESC`,
    { c: req.user.companyId }
  );
  const total = money.sum(rows.map((r) => r.outstanding));
  return ok(res, rows, 'OK', 200, { totalOutstanding: total });
}

/**
 * GET /api/finance/bank-transfer/:runId.csv — Bank Transfer Export engine.
 * Produces a standardised CSV suitable for bulk salary credit ingestion.
 */
async function bankTransferExport(req, res) {
  const runId = parseInt(req.params.runId, 10);
  const run = await db.queryOne('SELECT * FROM payroll_runs WHERE id=:id AND company_id=:c', { id: runId, c: req.user.companyId });
  if (!run) throw new AppError('Payroll run not found', 404, 'NOT_FOUND');

  const rows = await db.query(
    `SELECT e.employee_code, e.first_name, e.last_name, e.iban, e.bank_name, e.routing_code, p.net_salary, p.currency
       FROM payslips p JOIN employees e ON e.id = p.employee_id
      WHERE p.payroll_run_id = :id ORDER BY e.employee_code`,
    { id: runId }
  );

  const header = ['EmployeeCode', 'EmployeeName', 'IBAN', 'BankName', 'RoutingCode', 'Amount', 'Currency', 'Period'];
  const period = `${run.period_year}-${String(run.period_month).padStart(2, '0')}`;
  const csvLines = [header.join(',')];
  for (const r of rows) {
    csvLines.push([
      r.employee_code,
      `${r.first_name} ${r.last_name}`.replace(/,/g, ' '),
      r.iban || '',
      (r.bank_name || '').replace(/,/g, ' '),
      r.routing_code || '',
      money.round(r.net_salary),
      r.currency || 'AED',
      period,
    ].join(','));
  }
  const csv = csvLines.join('\r\n') + '\r\n';

  await audit.recordAudit({ actorUserId: req.user.id, action: 'EXPORT', entityType: 'bank_transfer', entityId: runId, after: { rows: rows.length }, ip: req.ip });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="bank_transfer_${period}.csv"`);
  return res.send(csv);
}

module.exports = { payrollSummary, departmentCost, overtimeCost, outstandingAdvances, bankTransferExport };
