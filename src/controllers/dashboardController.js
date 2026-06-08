'use strict';

/**
 * Dashboard Analytics Core controller (Module 10).
 * -------------------------------------------------------------
 * Real-time operational counters, financial metric cards and the
 * datasets that drive the SPA charts (workforce by department,
 * monthly payroll trend, expenditure breakdown).
 */

const db = require('../config/db');
const { ok } = require('../utils/response');
const expiry = require('../services/expiryMonitor');

/** GET /api/dashboard/metrics — top counter cards. */
async function metrics(req, res) {
  const c = req.user.companyId;
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  const [workforce, presentToday, onLeave, payroll, expirySummary] = await Promise.all([
    db.queryOne("SELECT COUNT(*) AS total FROM employees WHERE company_id=:c AND employment_status NOT IN ('inactive','terminated')", { c }),
    db.queryOne(
      `SELECT COALESCE(SUM(a.status IN ('present','late','half_day')),0) AS present
         FROM attendance a JOIN employees e ON e.id=a.employee_id
        WHERE e.company_id=:c AND a.work_date=:d`,
      { c, d: today }
    ),
    db.queryOne(
      `SELECT COUNT(*) AS on_leave FROM leave_applications la JOIN employees e ON e.id=la.employee_id
        WHERE e.company_id=:c AND la.status IN ('hr_approved','disbursed')
          AND :d BETWEEN la.start_date AND la.end_date`,
      { c, d: today }
    ),
    db.queryOne(
      `SELECT COALESCE(total_net,0) AS net, COALESCE(total_gross,0) AS gross,
              COALESCE((SELECT SUM(overtime_normal+overtime_sunday+overtime_holiday)
                          FROM payslips p WHERE p.payroll_run_id = pr.id),0) AS overtime
         FROM payroll_runs pr
        WHERE pr.company_id=:c AND pr.period_year=:y AND pr.period_month=:m
        ORDER BY pr.id DESC LIMIT 1`,
      { c, y: year, m: month }
    ),
    expiry.expirySummary(c, 30),
  ]);

  const totalWorkforce = workforce.total;
  const present = Number(presentToday.present) || 0;
  return ok(res, {
    totalWorkforce,
    presentToday: present,
    absentToday: Math.max(0, totalWorkforce - present - (Number(onLeave.on_leave) || 0)),
    onLeave: Number(onLeave.on_leave) || 0,
    monthlyPayroll: payroll ? payroll.net : '0.00',
    monthlyGross: payroll ? payroll.gross : '0.00',
    overtimeExpense: payroll ? payroll.overtime : '0.00',
    expirySummary,
  });
}

/** GET /api/dashboard/charts — datasets for frontend visualisations. */
async function charts(req, res) {
  const c = req.user.companyId;

  const workforceByDept = await db.query(
    `SELECT d.name AS label, COUNT(e.id) AS value
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id AND e.employment_status NOT IN ('inactive','terminated')
      WHERE d.company_id = :c GROUP BY d.id ORDER BY value DESC`,
    { c }
  );

  const departmentCost = await db.query(
    `SELECT d.name AS label, d.cost_center, COALESCE(SUM(p.net_salary),0) AS value
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id
       LEFT JOIN payslips p ON p.employee_id = e.id
       LEFT JOIN payroll_runs r ON r.id = p.payroll_run_id
         AND r.period_year = YEAR(CURDATE()) AND r.period_month = MONTH(CURDATE())
      WHERE d.company_id = :c GROUP BY d.id ORDER BY value DESC`,
    { c }
  );

  // 6-month payroll trend.
  const payrollTrend = await db.query(
    `SELECT CONCAT(period_year,'-',LPAD(period_month,2,'0')) AS label,
            COALESCE(SUM(total_net),0) AS value
       FROM payroll_runs
      WHERE company_id = :c
      GROUP BY period_year, period_month
      ORDER BY period_year DESC, period_month DESC
      LIMIT 6`,
    { c }
  );

  return ok(res, {
    workforceByDept,
    departmentCost,
    payrollTrend: payrollTrend.reverse(),
  });
}

module.exports = { metrics, charts };
