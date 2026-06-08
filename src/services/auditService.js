'use strict';

/**
 * Audit & security logging service (Module 1 + Module 13).
 * -------------------------------------------------------------
 * Centralised, non-blocking writers for:
 *   - audit_logs      : administrative state changes (who/what/before/after)
 *   - security_logs   : security-relevant events (login, csrf, denied access)
 *   - login_history   : authentication attempts and sessions
 *
 * Writes are best-effort: an audit failure should never break the
 * primary business transaction, so failures are logged and swallowed.
 * When a transaction handle (`tx`) is supplied, the write joins the
 * caller's ACID transaction instead.
 */

const db = require('../config/db');
const logger = require('../utils/logger');

/** Safely JSON-stringify a value for storage in a JSON/TEXT column. */
function asJson(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch (_e) {
    return null;
  }
}

/**
 * Record an administrative audit-trail entry.
 * @param {object} entry
 * @param {number} [entry.actorUserId]
 * @param {string} entry.action     e.g. 'CREATE','UPDATE','DELETE','APPROVE'
 * @param {string} entry.entityType e.g. 'employee','payroll_run'
 * @param {string|number} [entry.entityId]
 * @param {object} [entry.before]
 * @param {object} [entry.after]
 * @param {string} [entry.ip]
 * @param {object} [tx] optional transaction handle
 */
async function recordAudit(entry, tx = null) {
  const runner = tx || db;
  const sql = `
    INSERT INTO audit_logs
      (actor_user_id, action, entity_type, entity_id, before_state, after_state, ip_address, created_at)
    VALUES
      (:actorUserId, :action, :entityType, :entityId, :before, :after, :ip, NOW())`;
  try {
    await runner.query(sql, {
      actorUserId: entry.actorUserId || null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      before: asJson(entry.before),
      after: asJson(entry.after),
      ip: entry.ip || null,
    });
  } catch (err) {
    logger.error('Audit write failed', err.message);
  }
}

/** Record a security event (denied access, CSRF failure, 2FA, etc.). */
async function recordSecurity(event) {
  const sql = `
    INSERT INTO security_logs
      (user_id, event_type, severity, description, ip_address, user_agent, created_at)
    VALUES
      (:userId, :eventType, :severity, :description, :ip, :userAgent, NOW())`;
  try {
    await db.query(sql, {
      userId: event.userId || null,
      eventType: event.eventType,
      severity: event.severity || 'info',
      description: event.description || null,
      ip: event.ip || null,
      userAgent: event.userAgent || null,
    });
  } catch (err) {
    logger.error('Security log write failed', err.message);
  }
}

/** Record an authentication attempt / login-history entry. */
async function recordLogin(entry) {
  const sql = `
    INSERT INTO login_history
      (user_id, username_attempt, success, failure_reason, ip_address, user_agent, created_at)
    VALUES
      (:userId, :username, :success, :reason, :ip, :userAgent, NOW())`;
  try {
    await db.query(sql, {
      userId: entry.userId || null,
      username: entry.username || null,
      success: entry.success ? 1 : 0,
      reason: entry.reason || null,
      ip: entry.ip || null,
      userAgent: entry.userAgent || null,
    });
  } catch (err) {
    logger.error('Login history write failed', err.message);
  }
}

module.exports = { recordAudit, recordSecurity, recordLogin };
