'use strict';

/**
 * Enterprise Notification System (Module 12).
 * -------------------------------------------------------------
 * Persists in-app notifications and dispatches email via nodemailer.
 * Email transport degrades gracefully: if SMTP is not configured (or
 * nodemailer is unavailable) notifications are still recorded in-app
 * and the email is logged rather than sent, so flows never break in dev.
 *
 * High-level helpers fan out for: leave decisions, payroll completion,
 * employee birthdays, and document-expiry warnings.
 */

const db = require('../config/db');
const env = require('../config/env');
const logger = require('../utils/logger');

let transporter = null;

/** Lazily build (or reuse) the SMTP transporter. */
function getTransport() {
  if (transporter !== null) return transporter;
  try {
    if (!env.mail.host) {
      transporter = false; // explicitly disabled
      return transporter;
    }
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.password } : undefined,
    });
  } catch (_e) {
    transporter = false;
  }
  return transporter;
}

/** Send an email (best-effort). Returns 'sent' | 'logged' | 'failed'. */
async function sendEmail({ to, subject, html, text }) {
  const tx = getTransport();
  if (!tx) {
    logger.info(`[mail:logged] to=${to} subject="${subject}"`);
    return 'logged';
  }
  try {
    await tx.sendMail({ from: env.mail.from, to, subject, html, text: text || subject });
    return 'sent';
  } catch (err) {
    logger.error('Email send failed', err.message);
    return 'failed';
  }
}

/** Persist an in-app notification (and optionally email it). */
async function create({ userId = null, type, title, message, payload = null, email = null }) {
  let sentStatus = 'queued';
  if (email && email.to) {
    sentStatus = await sendEmail(email);
  }
  await db.query(
    `INSERT INTO notifications (user_id, channel, type, title, message, payload, sent_status)
     VALUES (:userId, :channel, :type, :title, :message, :payload, :status)`,
    {
      userId,
      channel: email ? 'email' : 'in_app',
      type,
      title,
      message,
      payload: payload ? JSON.stringify(payload) : null,
      status: sentStatus,
    }
  );
  return sentStatus;
}

/** Resolve the login user-id and email for an employee (if any). */
async function userForEmployee(employeeId) {
  return db.queryOne(
    `SELECT u.id AS user_id, u.email, e.first_name, e.last_name, e.work_email
       FROM employees e LEFT JOIN users u ON u.employee_id = e.id
      WHERE e.id = :id`,
    { id: employeeId }
  );
}

/* --------------------------- High-level helpers --------------------------- */

async function notifyLeaveDecision(employeeId, status, applicationId) {
  const u = await userForEmployee(employeeId);
  const title = `Leave ${status.replace('_', ' ')}`;
  const to = u && (u.email || u.work_email);
  return create({
    userId: u ? u.user_id : null,
    type: status === 'rejected' ? 'leave_rejected' : 'leave_approved',
    title,
    message: `Your leave application #${applicationId} is now "${status}".`,
    payload: { applicationId, status },
    email: to ? { to, subject: `[Euro-Trousers HRMS] ${title}`, html: `<p>Your leave application <b>#${applicationId}</b> status: <b>${status}</b>.</p>` } : null,
  });
}

async function notifyPayrollCompleted(runId, year, month) {
  return create({
    userId: null,
    type: 'payroll_completed',
    title: 'Payroll processed',
    message: `Payroll run #${runId} for ${year}-${String(month).padStart(2, '0')} has been processed.`,
    payload: { runId, year, month },
  });
}

async function notifyBirthday(employee) {
  const u = await userForEmployee(employee.id);
  const to = u && (u.email || u.work_email);
  return create({
    userId: u ? u.user_id : null,
    type: 'birthday',
    title: 'Happy Birthday!',
    message: `Wishing ${employee.first_name} a wonderful birthday from all of us at Euro-Trousers!`,
    email: to ? { to, subject: 'Happy Birthday from Euro-Trousers!', html: `<p>Happy Birthday, ${employee.first_name}! 🎉</p>` } : null,
  });
}

async function notifyDocumentExpiry(item) {
  return create({
    userId: null,
    type: 'document_expiry',
    title: `${item.doc_type} expiring soon`,
    message: `${item.first_name} ${item.last_name} (${item.employee_code}) — ${item.doc_type} expires on ${item.expiry_date} (${item.days_left} days).`,
    payload: item,
  });
}

/** GET helper: list notifications for a user. */
async function listForUser(userId, limit = 50) {
  return db.query(
    `SELECT * FROM notifications WHERE user_id = :u OR user_id IS NULL ORDER BY created_at DESC LIMIT :lim`,
    { u: userId, lim: limit }
  );
}

async function markRead(notificationId, userId) {
  await db.query('UPDATE notifications SET is_read = 1 WHERE id = :id AND (user_id = :u OR user_id IS NULL)', { id: notificationId, u: userId });
}

module.exports = {
  sendEmail,
  create,
  listForUser,
  markRead,
  notifyLeaveDecision,
  notifyPayrollCompleted,
  notifyBirthday,
  notifyDocumentExpiry,
};
