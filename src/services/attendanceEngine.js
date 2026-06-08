'use strict';

/**
 * Attendance calculation engine (Module 3).
 * -------------------------------------------------------------
 * Pure functions that turn raw check-in/out timestamps + a shift
 * definition into derived metrics: worked minutes, late arrival,
 * early exit, overtime and a work status. Kept side-effect free so
 * it is trivially testable and reused by manual entry, biometric and
 * CrossChex ingestion paths.
 */

/** Parse 'HH:MM:SS' (shift time) into minutes-from-midnight. */
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Minutes between two Date objects (>= 0). */
function diffMinutes(a, b) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

/**
 * Compute attendance metrics.
 * @param {object} input
 * @param {Date|string|null} input.checkIn
 * @param {Date|string|null} input.checkOut
 * @param {object|null} input.shift  { start_time, end_time, grace_minutes, break_minutes, is_night_shift }
 * @param {boolean} [input.isHoliday]
 * @param {boolean} [input.isWeekend]
 * @returns {{workedMinutes:number, lateMinutes:number, earlyExitMinutes:number,
 *           overtimeMinutes:number, status:string}}
 */
function compute(input) {
  const { shift, isHoliday = false, isWeekend = false } = input;
  const checkIn = input.checkIn ? new Date(input.checkIn) : null;
  const checkOut = input.checkOut ? new Date(input.checkOut) : null;

  // No timestamps at all.
  if (!checkIn && !checkOut) {
    if (isHoliday) return base('holiday');
    if (isWeekend) return base('weekend');
    return base('absent');
  }

  // Incomplete punch -> flagged for the Missing Attendance Alert pipeline.
  if (!checkIn || !checkOut) {
    return base('missing');
  }

  let worked = diffMinutes(checkIn, checkOut);
  const breakMin = shift ? shift.break_minutes || 0 : 0;
  worked = Math.max(0, worked - breakMin);

  let late = 0;
  let earlyExit = 0;
  let scheduled = 8 * 60; // default 8h if no shift

  if (shift) {
    const grace = shift.grace_minutes || 0;
    const shiftStart = timeToMinutes(shift.start_time);
    let shiftEnd = timeToMinutes(shift.end_time);
    if (shift.is_night_shift && shiftEnd <= shiftStart) shiftEnd += 24 * 60; // crosses midnight
    scheduled = Math.max(0, shiftEnd - shiftStart - breakMin);

    const inMin = checkIn.getHours() * 60 + checkIn.getMinutes();
    const outMin = checkOut.getHours() * 60 + checkOut.getMinutes() + (shift.is_night_shift && checkOut.getHours() < 12 ? 24 * 60 : 0);

    if (inMin > shiftStart + grace) late = inMin - shiftStart;
    if (outMin < shiftEnd) earlyExit = shiftEnd - outMin;
  }

  // Overtime: time worked beyond the scheduled minutes (holiday/weekend = all worked time).
  let overtime = 0;
  if (isHoliday || isWeekend) overtime = worked;
  else overtime = Math.max(0, worked - scheduled);

  let status = 'present';
  if (isHoliday) status = 'holiday';
  else if (isWeekend) status = 'weekend';
  else if (worked > 0 && worked < scheduled / 2) status = 'half_day';
  else if (late > 0) status = 'late';

  return {
    workedMinutes: worked,
    lateMinutes: late,
    earlyExitMinutes: earlyExit,
    overtimeMinutes: overtime,
    status,
  };
}

function base(status) {
  return { workedMinutes: 0, lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 0, status };
}

/**
 * Normalise an Anviz CrossChex export row into a generic punch record.
 * CrossChex typically exports: { userId/employee code, checkTime, checkType }.
 * We coalesce IN/OUT punches per employee per day downstream.
 */
function normalizeCrossChex(row) {
  return {
    employeeCode: row.UserCode || row.user_code || row.employeeCode || row.pin,
    timestamp: row.CheckTime || row.check_time || row.timestamp,
    direction: (row.CheckType || row.check_type || row.direction || '').toString().toLowerCase().includes('out')
      ? 'out'
      : 'in',
    deviceRef: row.DeviceSN || row.device_sn || row.deviceRef || null,
  };
}

/** Normalise a generic biometric webhook payload into a punch record. */
function normalizeBiometric(row) {
  return {
    employeeCode: row.employeeCode || row.code || row.pin,
    timestamp: row.timestamp || row.time,
    direction: (row.direction || row.type || 'in').toString().toLowerCase().includes('out') ? 'out' : 'in',
    deviceRef: row.deviceId || row.device || null,
  };
}

module.exports = { compute, normalizeCrossChex, normalizeBiometric, timeToMinutes, diffMinutes };
