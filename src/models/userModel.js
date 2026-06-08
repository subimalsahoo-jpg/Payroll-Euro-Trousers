'use strict';

/**
 * User & RBAC data-access (Modules 1 & 13).
 * All queries are parameterised. Permission keys are aggregated from
 * the user's role so they can be embedded in the JWT for fast RBAC.
 */

const db = require('../config/db');

/** Fetch a user by username with role name + flat permission list. */
async function findByUsername(username) {
  const user = await db.queryOne(
    `SELECT u.*, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.username = :username
      LIMIT 1`,
    { username }
  );
  if (!user) return null;
  user.permissions = await permissionsForRole(user.role_id);
  return user;
}

/** Fetch a user by id with role + permissions. */
async function findById(id) {
  const user = await db.queryOne(
    `SELECT u.*, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = :id
      LIMIT 1`,
    { id }
  );
  if (!user) return null;
  user.permissions = await permissionsForRole(user.role_id);
  return user;
}

/** Return the flat list of permission keys granted to a role. */
async function permissionsForRole(roleId) {
  const rows = await db.query(
    `SELECT p.perm_key
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = :roleId`,
    { roleId }
  );
  return rows.map((r) => r.perm_key);
}

/** Record a successful login: reset counters, set last_login_at. */
async function markLoginSuccess(userId) {
  await db.query(
    `UPDATE users
        SET last_login_at = NOW(), failed_attempts = 0, locked_until = NULL
      WHERE id = :id`,
    { id: userId }
  );
}

/** Increment failed attempts and lock the account after 5 strikes. */
async function markLoginFailure(userId) {
  await db.query(
    `UPDATE users
        SET failed_attempts = failed_attempts + 1,
            locked_until = IF(failed_attempts + 1 >= 5, DATE_ADD(NOW(), INTERVAL 15 MINUTE), locked_until)
      WHERE id = :id`,
    { id: userId }
  );
}

/** Update the bcrypt password hash for a user. */
async function updatePassword(userId, passwordHash) {
  await db.query('UPDATE users SET password_hash = :h WHERE id = :id', {
    h: passwordHash,
    id: userId,
  });
}

module.exports = {
  findByUsername,
  findById,
  permissionsForRole,
  markLoginSuccess,
  markLoginFailure,
  updatePassword,
};
