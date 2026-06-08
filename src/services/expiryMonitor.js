'use strict';

/**
 * Document expiry monitor (Module 11 compliance + Module 12 alerts).
 * -------------------------------------------------------------
 * Scans employee_identity_documents for upcoming Visa / Passport /
 * Emirates ID / Contract expiries within a warning window and surfaces
 * them for the dashboard and notification fan-out. Also detects today's
 * birthdays for the celebration notification.
 */

const db = require('../config/db');

/**
 * Find documents expiring within `days` for a company.
 * @returns rows { employee_id, employee_code, first_name, last_name, doc_type, expiry_date, days_left }
 */
async function upcomingExpiries(companyId, days = 30) {
  return db.query(
    `SELECT e.id AS employee_id, e.employee_code, e.first_name, e.last_name,
            id.doc_type, id.expiry_date,
            DATEDIFF(id.expiry_date, CURDATE()) AS days_left
       FROM employee_identity_documents id
       JOIN employees e ON e.id = id.employee_id
      WHERE e.company_id = :c
        AND e.employment_status NOT IN ('inactive','terminated')
        AND id.expiry_date IS NOT NULL
        AND id.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL :days DAY)
      ORDER BY id.expiry_date ASC`,
    { c: companyId, days }
  );
}

/** Aggregate expiry counts by document type. */
async function expirySummary(companyId, days = 30) {
  const rows = await db.query(
    `SELECT id.doc_type, COUNT(*) AS cnt
       FROM employee_identity_documents id
       JOIN employees e ON e.id = id.employee_id
      WHERE e.company_id = :c
        AND id.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL :days DAY)
      GROUP BY id.doc_type`,
    { c: companyId, days }
  );
  const summary = { passport: 0, emirates_id: 0, visa: 0, contract: 0, labour_card: 0 };
  for (const r of rows) summary[r.doc_type] = r.cnt;
  return summary;
}

/** Employees whose birthday is today (for celebration notifications). */
async function todaysBirthdays(companyId) {
  return db.query(
    `SELECT id, employee_code, first_name, last_name, work_email
       FROM employees
      WHERE company_id = :c
        AND employment_status NOT IN ('inactive','terminated')
        AND date_of_birth IS NOT NULL
        AND DATE_FORMAT(date_of_birth, '%m-%d') = DATE_FORMAT(CURDATE(), '%m-%d')`,
    { c: companyId }
  );
}

module.exports = { upcomingExpiries, expirySummary, todaysBirthdays };
