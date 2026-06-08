'use strict';

/**
 * Employee Self Service (ESS) controller (Module 8).
 * -------------------------------------------------------------
 * Contextualised, identity-safe views for the logged-in employee:
 * dashboard summary, attendance history, leave balances, payslip list,
 * profile self-update, leave application, and corporate announcements.
 * Every query is scoped to req.user.employeeId so an employee can never
 * read another employee's data.
 */

const db = require('../config/db');
const { ok, created, AppError } = require('../utils/response');
const { validate } = require('../utils/validators');

/** Resolve the caller's employee id or fail. */
function myEmployeeId(req) {
  if (!req.user.employeeId) throw new AppError('No employee profile linked to this account', 403, 'NO_PROFILE');
  return req.user.employeeId;
}

/** GET /api/ess/dashboard */
async function dashboard(req, res) {
  const e = myEmployeeId(req);
  const profile = await db.queryOne(
    `SELECT id, employee_code, first_name, last_name, employment_status, profile_image_path,
            (SELECT name FROM departments d WHERE d.id = emp.department_id) AS department
       FROM employees emp WHERE id = :e`,
    { e }
  );
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const [attendanceThisMonth, latestSlip, balanceRows, openLeave] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(status IN ('present','late','half_day')),0) AS present_days,
              COALESCE(SUM(overtime_minutes),0)/60 AS overtime_hours
         FROM attendance WHERE employee_id=:e AND YEAR(work_date)=:y AND MONTH(work_date)=:m`,
      { e, y: year, m: month }
    ),
    db.queryOne(
      `SELECT p.id, p.net_salary, p.currency, r.period_year, r.period_month
         FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
        WHERE p.employee_id = :e ORDER BY r.period_year DESC, r.period_month DESC LIMIT 1`,
      { e }
    ),
    db.query(
      `SELECT lt.name, COALESCE(lb.entitled_days, lt.default_days) - COALESCE(lb.used_days,0) - COALESCE(lb.pending_days,0) AS available
         FROM leave_types lt
         LEFT JOIN leave_balances lb ON lb.leave_type_id = lt.id AND lb.employee_id = :e AND lb.year = :y
        WHERE lt.company_id = :c`,
      { e, y: year, c: req.user.companyId }
    ),
    db.queryOne(
      "SELECT COUNT(*) AS open FROM leave_applications WHERE employee_id=:e AND status IN ('pending','manager_reviewed','hr_approved')",
      { e }
    ),
  ]);
  return ok(res, { profile, attendanceThisMonth, latestSlip, leaveBalances: balanceRows, openLeaveCount: openLeave.open });
}

/** GET /api/ess/attendance?from=&to= */
async function attendanceHistory(req, res) {
  const e = myEmployeeId(req);
  const from = req.query.from || `${new Date().getFullYear()}-01-01`;
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const rows = await db.query(
    `SELECT work_date, check_in, check_out, worked_minutes, late_minutes, overtime_minutes, status
       FROM attendance WHERE employee_id = :e AND work_date BETWEEN :from AND :to
      ORDER BY work_date DESC`,
    { e, from, to }
  );
  return ok(res, rows, 'OK', 200, { from, to });
}

/** GET /api/ess/payslips */
async function payslips(req, res) {
  const e = myEmployeeId(req);
  const rows = await db.query(
    `SELECT p.id, p.net_salary, p.gross_salary, p.currency, p.slip_pdf_path, p.employee_ack_at,
            r.period_year, r.period_month
       FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
      WHERE p.employee_id = :e ORDER BY r.period_year DESC, r.period_month DESC`,
    { e }
  );
  return ok(res, rows);
}

/** POST /api/ess/leave — submit a leave application for myself. */
async function applyLeave(req, res) {
  const e = myEmployeeId(req);
  const b = validate(req.body, {
    leave_type_id: { required: true, type: 'int' },
    start_date: { required: true, type: 'date' },
    end_date: { required: true, type: 'date' },
    reason: { type: 'string' },
  });
  if (new Date(b.end_date) < new Date(b.start_date)) {
    throw new AppError('End date cannot be before start date', 422, 'VALIDATION');
  }
  const days = Math.max(1, Math.round((new Date(b.end_date) - new Date(b.start_date)) / 86400000) + 1);
  const year = new Date(b.start_date).getFullYear();
  const id = await db.transaction(async (tx) => {
    const r = await tx.query(
      `INSERT INTO leave_applications (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
       VALUES (:e, :t, :s, :end, :days, :reason, 'pending')`,
      { e, t: b.leave_type_id, s: b.start_date, end: b.end_date, days, reason: b.reason }
    );
    await tx.query('INSERT INTO leave_workflow_steps (application_id, step, actor_user_id) VALUES (:id, "submitted", :u)', { id: r.insertId, u: req.user.id });
    await tx.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days, used_days, pending_days)
       VALUES (:e, :t, :y, (SELECT default_days FROM leave_types WHERE id=:t), 0, :days)
       ON DUPLICATE KEY UPDATE pending_days = pending_days + :days`,
      { e, t: b.leave_type_id, y: year, days }
    );
    return r.insertId;
  });
  return created(res, { id, total_days: days }, 'Leave application submitted');
}

/** PUT /api/ess/profile — limited self-update of contact details. */
async function updateProfile(req, res) {
  const e = myEmployeeId(req);
  const b = validate(req.body, {
    mobile: { type: 'string' },
    personal_email: { type: 'email' },
  });
  await db.query('UPDATE employees SET mobile = COALESCE(:mobile, mobile), personal_email = COALESCE(:personal_email, personal_email) WHERE id = :e',
    { mobile: b.mobile || null, personal_email: b.personal_email || null, e });
  return ok(res, null, 'Profile updated');
}

/** GET /api/ess/announcements */
async function announcements(req, res) {
  const rows = await db.query(
    `SELECT id, title, body, published_at FROM announcements
      WHERE company_id = :c AND is_published = 1 ORDER BY published_at DESC LIMIT 20`,
    { c: req.user.companyId }
  );
  return ok(res, rows);
}

module.exports = { dashboard, attendanceHistory, payslips, applyLeave, updateProfile, announcements };
