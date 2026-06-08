'use strict';

/**
 * Payroll & Overtime calculation engine (Modules 5 & 6).
 * -------------------------------------------------------------
 * Pure, side-effect-free computation of a single payslip from a salary
 * structure, attendance-derived overtime hours, and variable modifiers
 * (advances, loans, bonuses, incentives). All money math is performed via
 * the precision `money` helper (integer minor units) — never raw floats.
 *
 * UAE overtime conventions (configurable multipliers):
 *   - Normal overtime        : 1.25x the basic hourly rate
 *   - Rest-day (Sunday) OT    : 1.50x
 *   - Public-holiday OT       : 1.50x (often paid at premium)
 * The hourly rate is derived from basic salary over a 30-day / configurable
 * working-hours month.
 */

const money = require('../utils/money');

const DEFAULT_RATES = {
  normal: 1.25,
  sunday: 1.5,
  holiday: 1.5,
  // Standard working hours used to derive the hourly rate from monthly basic.
  monthlyWorkingHours: 30 * 8, // 240h baseline; adjust per company policy
};

/** Derive the basic hourly rate from a monthly basic salary. */
function hourlyRate(basicSalary, monthlyHours = DEFAULT_RATES.monthlyWorkingHours) {
  return money.divide(basicSalary, monthlyHours);
}

/**
 * Compute overtime pay split by category.
 * @param {string|number} basicSalary
 * @param {object} hours { normal, sunday, holiday } in decimal hours
 * @param {object} [rates]
 * @returns {{ normal:string, sunday:string, holiday:string, total:string }}
 */
function computeOvertime(basicSalary, hours = {}, rates = DEFAULT_RATES) {
  const hr = hourlyRate(basicSalary, rates.monthlyWorkingHours);
  const normal = money.multiply(money.multiply(hr, rates.normal), hours.normal || 0);
  const sunday = money.multiply(money.multiply(hr, rates.sunday), hours.sunday || 0);
  const holiday = money.multiply(money.multiply(hr, rates.holiday), hours.holiday || 0);
  return { normal, sunday, holiday, total: money.sum(normal, sunday, holiday) };
}

/**
 * Compute a complete payslip.
 * @param {object} input
 * @param {object} input.structure  salary_structures row
 * @param {object} [input.overtimeHours] { normal, sunday, holiday }
 * @param {object} [input.modifiers] { advanceDeduction, loanDeduction, bonus, incentive, otherDeduction }
 * @param {number} [input.workedDays]
 * @returns {object} payslip line amounts (all fixed-2 decimal strings)
 */
function computePayslip(input) {
  const s = input.structure;
  const mod = input.modifiers || {};
  const ot = computeOvertime(s.basic_salary, input.overtimeHours || {});

  // Earnings
  const earnings = money.sum(
    s.basic_salary,
    s.housing_allowance,
    s.transport_allowance,
    s.food_allowance,
    s.other_allowance,
    ot.total,
    mod.bonus || 0,
    mod.incentive || 0
  );

  // Deductions
  const totalDeductions = money.sum(
    mod.advanceDeduction || 0,
    mod.loanDeduction || 0,
    mod.otherDeduction || 0
  );

  const net = money.subtract(earnings, totalDeductions);
  const overtimeHoursTotal =
    (input.overtimeHours && (Number(input.overtimeHours.normal || 0) + Number(input.overtimeHours.sunday || 0) + Number(input.overtimeHours.holiday || 0))) || 0;

  return {
    basic_salary: money.round(s.basic_salary),
    housing_allowance: money.round(s.housing_allowance),
    transport_allowance: money.round(s.transport_allowance),
    food_allowance: money.round(s.food_allowance),
    other_allowance: money.round(s.other_allowance),
    overtime_normal: ot.normal,
    overtime_sunday: ot.sunday,
    overtime_holiday: ot.holiday,
    bonus: money.round(mod.bonus || 0),
    incentive: money.round(mod.incentive || 0),
    gross_salary: earnings,
    advance_deduction: money.round(mod.advanceDeduction || 0),
    loan_deduction: money.round(mod.loanDeduction || 0),
    other_deduction: money.round(mod.otherDeduction || 0),
    total_deductions: totalDeductions,
    net_salary: net,
    currency: s.currency || 'AED',
    worked_days: input.workedDays || 0,
    overtime_hours: overtimeHoursTotal.toFixed(2),
  };
}

module.exports = { hourlyRate, computeOvertime, computePayslip, DEFAULT_RATES };
