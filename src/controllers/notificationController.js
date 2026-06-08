'use strict';

/**
 * Notification controller (Module 12).
 * Exposes the in-app notification inbox + read receipts. Email dispatch
 * and high-level alert fan-out live in services/notificationService.js.
 */

const { ok } = require('../utils/response');
const notifier = require('../services/notificationService');

/** GET /api/notifications */
async function list(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = await notifier.listForUser(req.user.id, limit);
  const unread = rows.filter((r) => !r.is_read).length;
  return ok(res, rows, 'OK', 200, { unread });
}

/** POST /api/notifications/:id/read */
async function markRead(req, res) {
  await notifier.markRead(parseInt(req.params.id, 10), req.user.id);
  return ok(res, null, 'Marked as read');
}

module.exports = { list, markRead };
