'use strict';

/**
 * QR verification service (Module 7).
 * -------------------------------------------------------------
 * Produces a tamper-evident verification hash for a payslip and a
 * scannable QR data-URL that encodes a verification URL. The hash is an
 * HMAC over the slip's immutable fields keyed by the app JWT secret, so
 * a slip's authenticity can be re-verified server-side.
 */

const crypto = require('crypto');
const env = require('../config/env');

/** Compute a stable HMAC verification hash for a payslip. */
function computeHash(payslip) {
  const material = [
    payslip.id,
    payslip.employee_id,
    payslip.payroll_run_id,
    payslip.net_salary,
    payslip.gross_salary,
    payslip.currency,
  ].join('|');
  return crypto.createHmac('sha256', env.security.jwtSecret).update(material).digest('hex');
}

/** Verify a previously stored hash against the current payslip data. */
function verifyHash(payslip, hash) {
  const expected = computeHash(payslip);
  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(String(hash || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Generate a QR PNG data-URL pointing at the verification endpoint. */
async function generateQrDataUrl(payslip, hash) {
  const url = `${env.app.url}/verify/payslip?id=${payslip.id}&h=${hash}`;
  try {
    // eslint-disable-next-line global-require
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(url, { margin: 1, width: 160 });
  } catch (_e) {
    // If qrcode lib is unavailable, return null; PDF will omit the QR image.
    return null;
  }
}

module.exports = { computeHash, verifyHash, generateQrDataUrl };
