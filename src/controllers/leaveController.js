'use strict';

/**
 * Leave Management controller (Module 4).
 * -------------------------------------------------------------
 * Allocation tracking, multi-tier approval workflow
 * (pending -> manager_reviewed -> hr_approved -> disbursed | rejected),
 * real-time balances, and a team leave calendar feed.
 */

const db = require('../config/db');
const { ok, created, AppError } = require('../utils/response');
const { validate } = require('../utils/validators');
const audit = require('../services/auditService');
const notifier = require('../services/notificationService');

/** Inclusive whole-day count between two ISO dates. */
function dayCount(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

const CURRENT_YEAR = () => new Date().getFullYear();

/** GET /api/leave/types */
async function listTypes(req, res) {
  const rows = await db.query('SELECT * FROM leave_types WHERE company_id = :c ORDER BY name', { c: req.user.companyId });
  return ok(res, rows);
}

/** GET /api/leave/balances/:employeeId */
async function balances(req, res) {
  const employeeId = parseInt(req.params.employeeId, 10);
  const year = parseInt(req.query.year, 10) || CURRENT_YEAR();
  const rows = await db.query(
    `SELECT lt.id AS leave_type_id, lt.name, lt.code, lt.default_days,
            COALESCE(lb.entitled_days, lt.default_days) AS entitled_days,
            COALESCE(lb.used_days, 0)    AS used_days,
            COALESCE(lb.pending_days, 0) AS pending_days,
            (COALESCE(lb.entitled_days, lt.default_days) - COALESCE(lb.used_days,0) - COALESCE(lb.pending_days,0)) AS available_days
       FROM leave_types lt
       LEFT JOIN leave_balances lb ON lb.leave_type_id = lt.id AND lb.employee_id = :e AND lb.year = :y
      WHERE lt.company_id = :c
      ORDER BY lt.name`,
    { e: employeeId, y: year, c: req.user.companyId }
  );
  return ok(res, rows, 'OK', 200, { year });
}

/** GET /api/leave/applications?status=&employee= */
async function listApplications(req, res) {
  const status = req.query.status || null;
  const employee = req.query.employee ? parseInt(req.query.employee, 10) : null;
  const params = { c: req.user.companyId, status, employee };
  const rows = await db.query(
    `SELECT la.*, lt.name AS leave_type, e.employee_code, e.first_name, e.last_name
       FROM leave_applications la
       JOIN leave_types lt ON lt.id = la.leave_type_id
       JOIN employees e ON e.id = la.employee_id
      WHERE e.company_id = :c
        ${status ? 'AND la.status = :status' : ''}
        ${employee ? 'AND la.employee_id = :employee' : ''}
      ORDER BY la.created_at DESC
      LIMIT 500`,
    params
  );
  return ok(res, rows);
}

/** POST /api/leave/applications — submit a leave request. */
async function apply(req, res) {
  const b = validate(req.body, {
    employee_id: { required: true, type: 'int' },
    leave_type_id: { required: true, type: 'int' },
    start_date: { required: true, type: 'date' },
    end_date: { required: true, type: 'date' },
    reason: { type: 'string' },
  });
  if (new Date(b.end_date) < new Date(b.start_date)) {
    throw new AppError('End date cannot be before start date', 422, 'VALIDATION');
  }
  const total = dayCount(b.start_date, b.end_date);
  const year = new Date(b.start_date).getFullYear();

  const appId = await db.transaction(async (tx) => {
    const r = await tx.query(
      `INSERT INTO leave_applications (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
       VALUES (:e, :t, :s, :end, :days, :reason, 'pending')`,
      { e: b.employee_id, t: b.leave_type_id, s: b.start_date, end: b.end_date, days: total, reason: b.reason }
    );
    const id = r.insertId;
    await tx.query('INSERT INTO leave_workflow_steps (application_id, step, actor_user_id) VALUES (:id, "submitted", :u)', { id, u: req.user.id });
    // Reserve balance as pending.
    await tx.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days, used_days, pending_days)
       VALUES (:e, :t, :y, (SELECT default_days FROM leave_types WHERE id=:t), 0, :days)
       ON DUPLICATE KEY UPDATE pending_days = pending_days + :days`,
      { e: b.employee_id, t: b.leave_type_id, y: year, days: total }
    );
    return id;
  });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'leave_application', entityId: appId, after: { days: total }, ip: req.ip });
  return created(res, { id: appId, total_days: total });
}

/**
 * POST /api/leave/applications/:id/transition
 * Advances the multi-tier workflow. Body: { action, note }.
 * action one of: manager_review, hr_approve, disburse, reject, cancel.
 */
async function transition(req, res) {
  const id = parseInt(req.params.id, 10);
  const action = String(req.body.action || '').toLowerCase();
  const note = req.body.note || null;

  const app = await db.queryOne(
    `SELECT la.*, e.company_id FROM leave_applications la JOIN employees e ON e.id = la.employee_id WHERE la.id = :id`,
    { id }
  );
  if (!app || app.company_id !== req.user.companyId) throw new AppError('Application not found', 404, 'NOT_FOUND');

  // Valid linear transitions.
  const transitions = {
    manager_review: { from: ['pending'], to: 'manager_reviewed', step: 'manager_reviewed' },
    hr_approve: { from: ['manager_reviewed'], to: 'hr_approved', step: 'hr_approved' },
    disburse: { from: ['hr_approved'], to: 'disbursed', step: 'disbursed' },
    reject: { from: ['pending', 'manager_reviewed', 'hr_approved'], to: 'rejected', step: 'rejected' },
    cancel: { from: ['pending', 'manager_reviewed'], to: 'cancelled', step: 'cancelled' },
  };
  const tr = transitions[action];
  if (!tr) throw new AppError('Unknown workflow action', 422, 'VALIDATION');
  if (!tr.from.includes(app.status)) {
    throw new AppError(`Cannot ${action} from status "${app.status}"`, 409, 'INVALID_TRANSITION');
  }

  await db.transaction(async (tx) => {
    const fields = ['status = :to'];
    const params = { to: tr.to, id };
    if (action === 'manager_review') { fields.push('manager_id = :u', 'manager_action_at = NOW()'); params.u = req.user.id; }
    if (action === 'hr_approve') { fields.push('hr_id = :u', 'hr_action_at = NOW()'); params.u = req.user.id; }
    if (action === 'reject') { fields.push('rejection_reason = :note'); params.note = note; }

    await tx.query(`UPDATE leave_applications SET ${fields.join(', ')} WHERE id = :id`, params);
    await tx.query('INSERT INTO leave_workflow_steps (application_id, step, actor_user_id, note) VALUES (:id, :step, :u, :note)', { id, step: tr.step, u: req.user.id, note });

    const year = new Date(app.start_date).getFullYear();
    // Disbursed: move pending -> used. Rejected/cancelled: release pending.
    if (tr.to === 'disbursed') {
      await tx.query(
        `UPDATE leave_balances SET used_days = used_days + :d, pending_days = GREATEST(0, pending_days - :d)
          WHERE employee_id=:e AND leave_type_id=:t AND year=:y`,
        { d: app.total_days, e: app.employee_id, t: app.leave_type_id, y: year }
      );
    } else if (tr.to === 'rejected' || tr.to === 'cancelled') {
      await tx.query(
        `UPDATE leave_balances SET pending_days = GREATEST(0, pending_days - :d)
          WHERE employee_id=:e AND leave_type_id=:t AND year=:y`,
        { d: app.total_days, e: app.employee_id, t: app.leave_type_id, y: year }
      );
    }
    await audit.recordAudit({ actorUserId: req.user.id, action: action.toUpperCase(), entityType: 'leave_application', entityId: id, before: { status: app.status }, after: { status: tr.to }, ip: req.ip }, tx);
  });

  // Fire-and-forget notification on terminal/approval states.
  if (['hr_approved', 'disbursed', 'rejected'].includes(tr.to)) {
    notifier.notifyLeaveDecision(app.employee_id, tr.to, id).catch(() => {});
  }
  return ok(res, { status: tr.to }, 'Workflow updated');
}

/** GET /api/leave/calendar?from=&to= — team calendar feed. */
async function calendar(req, res) {
  const from = req.query.from || new Date().toISOString().slice(0, 8) + '01';
  const to = req.query.to || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  const rows = await db.query(
    `SELECT la.id, la.start_date, la.end_date, la.status, lt.name AS leave_type,
            e.employee_code, e.first_name, e.last_name, d.name AS department
       FROM leave_applications la
       JOIN employees e ON e.id = la.employee_id
       JOIN leave_types lt ON lt.id = la.leave_type_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.company_id = :c
        AND la.status IN ('hr_approved','disbursed','manager_reviewed')
        AND la.start_date <= :to AND la.end_date >= :from
      ORDER BY la.start_date`,
    { c: req.user.companyId, from, to }
  );
  return ok(res, rows, 'OK', 200, { from, to });
}

module.exports = { listTypes, balances, listApplications, apply, transition, calendar };
