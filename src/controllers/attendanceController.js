'use strict';

/**
 * Attendance controller (Module 3).
 * -------------------------------------------------------------
 * Daily grid, manual entry/correction, biometric & Anviz CrossChex
 * ingestion wrappers, missing-attendance alerts, and reports.
 */

const db = require('../config/db');
const { ok, created, AppError } = require('../utils/response');
const { validate } = require('../utils/validators');
const engine = require('../services/attendanceEngine');
const audit = require('../services/auditService');

/** Resolve a shift row (or null) for metric computation. */
async function getShift(shiftId) {
  if (!shiftId) return null;
  return db.queryOne('SELECT * FROM shifts WHERE id = :id', { id: shiftId });
}

/** Is the given date a company public holiday? */
async function isHoliday(companyId, date) {
  const row = await db.queryOne(
    'SELECT 1 AS h FROM public_holidays WHERE company_id = :c AND holiday_date = :d',
    { c: companyId, d: date }
  );
  return !!row;
}

/** UAE default weekend = Saturday/Sunday (configurable in real deployments). */
function isWeekend(date) {
  const day = new Date(date).getDay(); // 0 Sun ... 6 Sat
  return day === 0 || day === 6;
}

/** Persist a single computed attendance row (insert or update by emp+date). */
async function upsertAttendance(payload, tx = db) {
  const shift = await getShift(payload.shift_id);
  const holiday = await isHoliday(payload.company_id, payload.work_date);
  const metrics = engine.compute({
    checkIn: payload.check_in,
    checkOut: payload.check_out,
    shift,
    isHoliday: holiday,
    isWeekend: isWeekend(payload.work_date),
  });
  await tx.query(
    `INSERT INTO attendance
       (employee_id, shift_id, work_date, check_in, check_out, worked_minutes, late_minutes,
        early_exit_minutes, overtime_minutes, status, source, source_ref)
     VALUES
       (:employee_id, :shift_id, :work_date, :check_in, :check_out, :worked, :late, :early, :ot, :status, :source, :ref)
     ON DUPLICATE KEY UPDATE
        shift_id=VALUES(shift_id), check_in=VALUES(check_in), check_out=VALUES(check_out),
        worked_minutes=VALUES(worked_minutes), late_minutes=VALUES(late_minutes),
        early_exit_minutes=VALUES(early_exit_minutes), overtime_minutes=VALUES(overtime_minutes),
        status=VALUES(status), source=VALUES(source), source_ref=VALUES(source_ref)`,
    {
      employee_id: payload.employee_id,
      shift_id: payload.shift_id || null,
      work_date: payload.work_date,
      check_in: payload.check_in || null,
      check_out: payload.check_out || null,
      worked: metrics.workedMinutes,
      late: metrics.lateMinutes,
      early: metrics.earlyExitMinutes,
      ot: metrics.overtimeMinutes,
      status: metrics.status,
      source: payload.source || 'manual',
      ref: payload.source_ref || null,
    }
  );
  return metrics;
}

/** GET /api/attendance?date=YYYY-MM-DD — daily grid for the company. */
async function dailyGrid(req, res) {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const rows = await db.query(
    `SELECT a.*, e.employee_code, e.first_name, e.last_name, s.name AS shift_name
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = :d
       LEFT JOIN shifts s ON s.id = a.shift_id
      WHERE e.company_id = :c AND e.employment_status NOT IN ('inactive','terminated')
      ORDER BY e.last_name, e.first_name`,
    { d: date, c: req.user.companyId }
  );
  return ok(res, rows, 'OK', 200, { date });
}

/** POST /api/attendance — manual single entry/upsert. */
async function record(req, res) {
  const b = validate(req.body, {
    employee_id: { required: true, type: 'int' },
    work_date: { required: true, type: 'date' },
    shift_id: { type: 'int' },
    check_in: { type: 'string' },
    check_out: { type: 'string' },
    source: { type: 'string', default: 'manual' },
  });
  const metrics = await upsertAttendance({ ...b, company_id: req.user.companyId });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPSERT', entityType: 'attendance', entityId: `${b.employee_id}:${b.work_date}`, after: metrics, ip: req.ip });
  return created(res, metrics, 'Attendance recorded');
}

/**
 * POST /api/attendance/correct/:id — administrative correction with audit ledger.
 */
async function correct(req, res) {
  const id = parseInt(req.params.id, 10);
  const before = await db.queryOne('SELECT * FROM attendance WHERE id = :id', { id });
  if (!before) throw new AppError('Attendance record not found', 404, 'NOT_FOUND');
  const b = validate(req.body, {
    check_in: { type: 'string' },
    check_out: { type: 'string' },
    reason: { required: true, type: 'string' },
  });

  await db.transaction(async (tx) => {
    const metrics = engine.compute({
      checkIn: b.check_in || before.check_in,
      checkOut: b.check_out || before.check_out,
      shift: await getShift(before.shift_id),
      isHoliday: await isHoliday(req.user.companyId, before.work_date),
      isWeekend: isWeekend(before.work_date),
    });
    await tx.query(
      `UPDATE attendance SET check_in=:ci, check_out=:co, worked_minutes=:w, late_minutes=:l,
          early_exit_minutes=:e, overtime_minutes=:o, status=:s, is_corrected=1 WHERE id=:id`,
      { ci: b.check_in || before.check_in, co: b.check_out || before.check_out, w: metrics.workedMinutes, l: metrics.lateMinutes, e: metrics.earlyExitMinutes, o: metrics.overtimeMinutes, s: metrics.status, id }
    );
    await tx.query(
      `INSERT INTO attendance_corrections (attendance_id, field_changed, old_value, new_value, reason, corrected_by)
       VALUES (:id, 'check_in/out', :old, :new, :reason, :by)`,
      { id, old: `${before.check_in}|${before.check_out}`, new: `${b.check_in}|${b.check_out}`, reason: b.reason, by: req.user.id }
    );
    await audit.recordAudit({ actorUserId: req.user.id, action: 'CORRECT', entityType: 'attendance', entityId: id, before, after: b, ip: req.ip }, tx);
  });
  return ok(res, null, 'Attendance corrected');
}

/**
 * POST /api/attendance/ingest/biometric
 * POST /api/attendance/ingest/crosschex
 * Ready-to-consume ingestion wrappers. Accept an array of raw device logs,
 * normalise them, coalesce IN/OUT punches per employee/day, then upsert.
 */
async function ingest(req, res) {
  const provider = req.params.provider; // 'biometric' | 'crosschex'
  const logs = Array.isArray(req.body.logs) ? req.body.logs : [];
  if (!logs.length) throw new AppError('No logs supplied', 422, 'VALIDATION');

  const normalize = provider === 'crosschex' ? engine.normalizeCrossChex : engine.normalizeBiometric;
  // Map employeeCode -> employee row (single lookup set).
  const codes = [...new Set(logs.map((l) => normalize(l).employeeCode).filter(Boolean))];
  const placeholders = codes.map((_, i) => `:c${i}`).join(',') || 'NULL';
  const params = { company: req.user.companyId };
  codes.forEach((c, i) => { params[`c${i}`] = c; });
  const emps = codes.length
    ? await db.query(`SELECT id, employee_code FROM employees WHERE company_id=:company AND employee_code IN (${placeholders})`, params)
    : [];
  const byCode = new Map(emps.map((e) => [e.employee_code, e.id]));

  // Coalesce per employee+date.
  const grouped = new Map();
  for (const raw of logs) {
    const p = normalize(raw);
    const empId = byCode.get(p.employeeCode);
    if (!empId || !p.timestamp) continue;
    const date = new Date(p.timestamp).toISOString().slice(0, 10);
    const key = `${empId}:${date}`;
    const g = grouped.get(key) || { employee_id: empId, work_date: date, check_in: null, check_out: null, source_ref: p.deviceRef };
    if (p.direction === 'out') g.check_out = p.timestamp;
    else g.check_in = p.timestamp;
    grouped.set(key, g);
  }

  let processed = 0;
  await db.transaction(async (tx) => {
    for (const g of grouped.values()) {
      await upsertAttendance({ ...g, company_id: req.user.companyId, source: provider }, tx);
      processed += 1;
    }
  });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'INGEST', entityType: 'attendance', entityId: provider, after: { processed }, ip: req.ip });
  return ok(res, { received: logs.length, processed }, `${provider} logs ingested`);
}

/** GET /api/attendance/alerts?date= — missing/incomplete punches. */
async function missingAlerts(req, res) {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const rows = await db.query(
    `SELECT e.id AS employee_id, e.employee_code, e.first_name, e.last_name,
            a.id AS attendance_id, a.check_in, a.check_out, a.status
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = :d
      WHERE e.company_id = :c
        AND e.employment_status NOT IN ('inactive','terminated')
        AND (a.id IS NULL OR a.status = 'missing'
             OR (a.check_in IS NOT NULL AND a.check_out IS NULL))
      ORDER BY e.last_name`,
    { d: date, c: req.user.companyId }
  );
  return ok(res, rows, 'OK', 200, { date, count: rows.length });
}

/** GET /api/attendance/report?from=&to=&employee= — summarised report. */
async function report(req, res) {
  const from = req.query.from || new Date().toISOString().slice(0, 8) + '01';
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const employee = req.query.employee ? parseInt(req.query.employee, 10) : null;
  const params = { c: req.user.companyId, from, to, employee };
  const rows = await db.query(
    `SELECT e.id AS employee_id, e.employee_code, e.first_name, e.last_name,
            COUNT(a.id) AS days_recorded,
            SUM(a.status='present' OR a.status='late') AS present_days,
            SUM(a.status='absent') AS absent_days,
            SUM(a.late_minutes) AS total_late_minutes,
            SUM(a.overtime_minutes) AS total_overtime_minutes
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date BETWEEN :from AND :to
      WHERE e.company_id = :c ${employee ? 'AND e.id = :employee' : ''}
      GROUP BY e.id
      ORDER BY e.last_name`,
    params
  );
  return ok(res, rows, 'OK', 200, { from, to });
}

module.exports = { dailyGrid, record, correct, ingest, missingAlerts, report };
