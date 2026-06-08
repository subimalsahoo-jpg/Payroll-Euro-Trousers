'use strict';

/**
 * Lightweight, dependency-free validation + sanitisation helpers.
 * -------------------------------------------------------------
 * These are deliberately small and explicit. They protect against
 * malformed input and provide consistent placeholder formatting for
 * sensitive UAE identity attributes (Emirates ID, passport, etc.)
 * WITHOUT ever storing or printing real credential numbers in code.
 */

const { AppError } = require('./response');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// UAE Emirates ID display format: 784-YYYY-NNNNNNN-C
const EMIRATES_ID_RE = /^784-\d{4}-\d{7}-\d$/;

/** Assert a value is present (not null/undefined/empty string). */
function required(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new AppError(`Field "${field}" is required`, 422, 'VALIDATION', { field });
  }
  return value;
}

/** Validate an email address. */
function isEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value);
}

/** Validate a positive (or zero) numeric amount. */
function isAmount(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return !Number.isNaN(n) && n >= 0;
}

/** Validate an ISO-ish date (YYYY-MM-DD). */
function isDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

/**
 * Validate an Emirates ID *display* string. We only ever validate the
 * structural format (784-XXXX-XXXXXXX-X); the application is designed so
 * that masked placeholders like "784-XXXX-XXXXXXX-X" pass structural
 * field-parsing checks without real numbers being embedded in source.
 */
function isEmiratesIdFormat(value) {
  if (typeof value !== 'string') return false;
  // Accept both real-shaped values and the masked placeholder form.
  return EMIRATES_ID_RE.test(value) || /^784-X{4}-X{7}-X$/.test(value);
}

/**
 * Mask the middle digits of an Emirates ID for safe display/logging.
 * Always returns a structural placeholder, never the raw value.
 */
function maskEmiratesId(value) {
  if (typeof value !== 'string') return '784-XXXX-XXXXXXX-X';
  const parts = value.split('-');
  if (parts.length !== 4) return '784-XXXX-XXXXXXX-X';
  return `784-XXXX-XXXXXXX-${parts[3] ? 'X' : 'X'}`;
}

/** Mask a passport number leaving only the last 2 characters structural. */
function maskPassport(value) {
  if (typeof value !== 'string' || value.length < 3) return 'XXXXXXXX';
  return `${'X'.repeat(value.length - 2)}${value.slice(-2).replace(/./g, 'X')}`;
}

/** Coerce a value to a clean integer or throw. */
function toInt(value, field = 'value') {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new AppError(`Field "${field}" must be an integer`, 422, 'VALIDATION', { field });
  }
  return n;
}

/**
 * Basic string sanitiser: trims and strips control characters.
 * Defence-in-depth alongside parameterised queries + output encoding.
 */
function clean(value) {
  if (typeof value !== 'string') return value;
  // eslint-disable-next-line no-control-regex
  return value.trim().replace(/[\u0000-\u001F\u007F]/g, '');
}

/**
 * Validate a payload against a simple schema map.
 * schema: { field: { required?, type?, enum? } }
 * type one of: 'string','email','amount','date','int'
 * Throws AppError(422) listing all failures.
 */
function validate(payload, schema) {
  const errors = {};
  const out = {};
  for (const [field, rule] of Object.entries(schema)) {
    let value = payload ? payload[field] : undefined;
    if (typeof value === 'string') value = clean(value);

    const empty = value === null || value === undefined || value === '';
    if (rule.required && empty) {
      errors[field] = 'is required';
      continue;
    }
    if (empty) {
      out[field] = rule.default !== undefined ? rule.default : null;
      continue;
    }
    switch (rule.type) {
      case 'email':
        if (!isEmail(value)) errors[field] = 'must be a valid email';
        break;
      case 'amount':
        if (!isAmount(value)) errors[field] = 'must be a non-negative number';
        break;
      case 'date':
        if (!isDate(value)) errors[field] = 'must be YYYY-MM-DD';
        break;
      case 'int':
        if (Number.isNaN(parseInt(value, 10))) errors[field] = 'must be an integer';
        else value = parseInt(value, 10);
        break;
      default:
        break;
    }
    if (rule.enum && !rule.enum.includes(value)) {
      errors[field] = `must be one of: ${rule.enum.join(', ')}`;
    }
    out[field] = value;
  }
  if (Object.keys(errors).length) {
    throw new AppError('Validation failed', 422, 'VALIDATION', errors);
  }
  return out;
}

module.exports = {
  required,
  isEmail,
  isAmount,
  isDate,
  isEmiratesIdFormat,
  maskEmiratesId,
  maskPassport,
  toInt,
  clean,
  validate,
  EMIRATES_ID_RE,
};
