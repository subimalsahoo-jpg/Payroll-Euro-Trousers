'use strict';

/**
 * Precision decimal money utilities.
 * -------------------------------------------------------------
 * Payroll math must never use raw IEEE-754 floats for chained
 * additions/subtractions (0.1 + 0.2 !== 0.3). We perform all
 * arithmetic in integer "minor units" (fils for AED -> 1/100)
 * and only convert back to a fixed-2 decimal string at the edges.
 *
 * All amounts are treated as 2-decimal currency values.
 */

const SCALE = 100; // 2 decimal places (AED fils)

/** Convert any numeric/string amount to integer minor units, rounded. */
function toMinor(amount) {
  if (amount === null || amount === undefined || amount === '') return 0;
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(n)) return 0;
  return Math.round(n * SCALE);
}

/** Convert integer minor units back to a fixed-2 decimal string. */
function fromMinor(minor) {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / SCALE);
  const frac = String(abs % SCALE).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** Sum a list of amounts and return a fixed-2 decimal string. */
function sum(...amounts) {
  const total = amounts
    .flat()
    .reduce((acc, a) => acc + toMinor(a), 0);
  return fromMinor(total);
}

/** Subtract b (and further args) from a; returns fixed-2 string. */
function subtract(a, ...bs) {
  const total = bs.reduce((acc, b) => acc - toMinor(b), toMinor(a));
  return fromMinor(total);
}

/** Multiply an amount by a (possibly fractional) factor; rounds half-up. */
function multiply(amount, factor) {
  const minor = toMinor(amount);
  return fromMinor(Math.round(minor * factor));
}

/** Divide an amount by a divisor; rounds half-up. */
function divide(amount, divisor) {
  if (!divisor) return '0.00';
  return fromMinor(Math.round(toMinor(amount) / divisor));
}

/** Compute a percentage (e.g. percent(1000, 12.5) -> '125.00'). */
function percent(amount, pct) {
  return fromMinor(Math.round((toMinor(amount) * pct) / 100));
}

/** Round a numeric/string amount to a clean fixed-2 string. */
function round(amount) {
  return fromMinor(toMinor(amount));
}

/** Compare two amounts: returns -1, 0 or 1. */
function compare(a, b) {
  const ma = toMinor(a);
  const mb = toMinor(b);
  if (ma < mb) return -1;
  if (ma > mb) return 1;
  return 0;
}

/** Format an amount for display with a currency code, e.g. "AED 1,250.00". */
function format(amount, currency = 'AED') {
  const value = round(amount);
  const [whole, frac] = value.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = String(value).startsWith('-') ? '-' : '';
  return `${currency} ${sign}${grouped}.${frac}`;
}

module.exports = {
  toMinor,
  fromMinor,
  sum,
  subtract,
  multiply,
  divide,
  percent,
  round,
  compare,
  format,
};
