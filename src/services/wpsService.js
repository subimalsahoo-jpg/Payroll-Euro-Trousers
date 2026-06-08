'use strict';

/**
 * UAE WPS (Wages Protection System) SIF generator (Module 11).
 * -------------------------------------------------------------
 * Compiles a payroll run into the mandatory Salary Information File
 * (.sif) consumed by UAE banks / the Central Bank WPS. The SIF is a
 * comma-delimited text file with two record families:
 *   - SCR (Salary Control Record): one header summarising the batch.
 *   - SDR (Salary Detail Record): one per employee payment.
 *
 * Field layouts vary slightly by bank; this implements the common
 * MOHRE-aligned layout and is centralised so the exact spec can be
 * tuned in one place. Routing/employer identifiers come from config
 * (env.wps) and are structural placeholders by default.
 */

const crypto = require('crypto');
const env = require('../config/env');
const money = require('../utils/money');

/** Format a Date (or ISO string) as YYYY-MM-DD for SIF fields. */
function ymd(d) {
  const date = d ? new Date(d) : new Date();
  return date.toISOString().slice(0, 10);
}

/**
 * Build the SIF text for a payroll run.
 * @param {object} run payroll_runs row
 * @param {Array} details rows: { employee_code, labour_card_no, iban, routing_code, net_salary, basic_salary, ... , worked_days }
 * @returns {{ content:string, recordCount:number, totalAmount:string, checksum:string }}
 */
function buildSif(run, details) {
  const now = new Date();
  const fileRef = `ET${run.period_year}${String(run.period_month).padStart(2, '0')}${run.id}`;
  const totalAmount = money.sum(details.map((d) => d.net_salary));

  const lines = [];

  // --- SDR: Salary Detail Records (one per employee) ---
  for (const d of details) {
    lines.push(
      [
        'SDR',
        d.labour_card_no || d.employee_code, // Employee/Labour card ID
        d.routing_code || env.wps.bankRoutingCode, // Agent/Bank routing code
        d.iban || '', // Employee IBAN
        ymd(`${run.period_year}-${String(run.period_month).padStart(2, '0')}-01`), // Pay start
        d.worked_days || 30, // Days in period
        money.round(d.net_salary), // Fixed component / net
        money.round(d.basic_salary || 0), // Basic
        money.subtract(d.net_salary, d.basic_salary || 0), // Variable component
        '', // Leave days (optional)
      ].join(',')
    );
  }

  // --- SCR: Salary Control Record (single header/footer summary) ---
  const scr = [
    'SCR',
    env.wps.employerId, // Employer (establishment) ID
    env.wps.bankRoutingCode, // Employer bank routing code
    fileRef, // Unique file reference
    ymd(now), // Creation date
    now.toTimeString().slice(0, 5).replace(':', ''), // Creation time HHMM
    String(details.length), // Number of SDR records
    money.round(totalAmount), // Total salary amount
    env.app.company, // Employer name
    env.wps.sifVersion, // SIF spec version
    'AED', // Currency
  ].join(',');

  // SCR appears first by convention, followed by detail records.
  const content = [scr, ...lines].join('\r\n') + '\r\n';
  const checksum = crypto.createHash('sha256').update(content).digest('hex');

  return { content, recordCount: details.length, totalAmount, checksum, fileRef };
}

module.exports = { buildSif, ymd };
