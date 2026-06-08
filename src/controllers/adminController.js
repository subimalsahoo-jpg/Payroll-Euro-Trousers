'use strict';

/**
 * Super Admin controller (Module 1).
 * -------------------------------------------------------------
 * Multi-tenant management: companies, branches, departments,
 * designations; RBAC: roles/permissions/users; global system
 * settings; and read access to audit, security and login logs.
 * Every mutating action is recorded to the audit trail.
 */

const bcrypt = require('bcryptjs');
const db = require('../config/db');
const env = require('../config/env');
const { ok, created, AppError } = require('../utils/response');
const { validate } = require('../utils/validators');
const audit = require('../services/auditService');
const backupService = require('../services/backupService');

/* ----------------------------- Companies ----------------------------- */
async function listCompanies(_req, res) {
  const rows = await db.query('SELECT * FROM companies ORDER BY name');
  return ok(res, rows);
}

async function createCompany(req, res) {
  const b = validate(req.body, {
    name: { required: true, type: 'string' },
    legal_name: { type: 'string' },
    trade_license: { type: 'string' },
    base_currency: { type: 'string', default: 'AED' },
    default_locale: { type: 'string', default: 'en' },
    address: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO companies (name, legal_name, trade_license, base_currency, default_locale, address)
     VALUES (:name, :legal_name, :trade_license, :base_currency, :default_locale, :address)`,
    b
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'company', entityId: r.insertId, after: b, ip: req.ip });
  return created(res, { id: r.insertId });
}

async function updateCompany(req, res) {
  const id = parseInt(req.params.id, 10);
  const before = await db.queryOne('SELECT * FROM companies WHERE id = :id', { id });
  if (!before) throw new AppError('Company not found', 404, 'NOT_FOUND');
  const b = validate(req.body, {
    name: { required: true, type: 'string' },
    legal_name: { type: 'string' },
    base_currency: { type: 'string', default: before.base_currency },
    default_locale: { type: 'string', default: before.default_locale },
    address: { type: 'string' },
    is_active: { type: 'int', default: before.is_active },
  });
  await db.query(
    `UPDATE companies SET name=:name, legal_name=:legal_name, base_currency=:base_currency,
        default_locale=:default_locale, address=:address, is_active=:is_active WHERE id=:id`,
    { ...b, id }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPDATE', entityType: 'company', entityId: id, before, after: b, ip: req.ip });
  return ok(res, null, 'Company updated');
}

/* ------------------------------ Branches ------------------------------ */
async function listBranches(req, res) {
  const companyId = req.user.companyId;
  const rows = await db.query('SELECT * FROM branches WHERE company_id = :c ORDER BY name', { c: companyId });
  return ok(res, rows);
}

async function createBranch(req, res) {
  const b = validate(req.body, {
    name: { required: true, type: 'string' },
    code: { required: true, type: 'string' },
    emirate: { type: 'string' },
    address: { type: 'string' },
    phone: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO branches (company_id, name, code, emirate, address, phone)
     VALUES (:c, :name, :code, :emirate, :address, :phone)`,
    { ...b, c: req.user.companyId }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'branch', entityId: r.insertId, after: b, ip: req.ip });
  return created(res, { id: r.insertId });
}

/* ---------------------------- Departments ----------------------------- */
async function listDepartments(req, res) {
  const rows = await db.query(
    `SELECT d.*, b.name AS branch_name
       FROM departments d LEFT JOIN branches b ON b.id = d.branch_id
      WHERE d.company_id = :c ORDER BY d.name`,
    { c: req.user.companyId }
  );
  return ok(res, rows);
}

async function createDepartment(req, res) {
  const b = validate(req.body, {
    name: { required: true, type: 'string' },
    code: { required: true, type: 'string' },
    branch_id: { type: 'int' },
    cost_center: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO departments (company_id, branch_id, name, code, cost_center)
     VALUES (:c, :branch_id, :name, :code, :cost_center)`,
    { ...b, c: req.user.companyId }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'department', entityId: r.insertId, after: b, ip: req.ip });
  return created(res, { id: r.insertId });
}

async function listDesignations(req, res) {
  const rows = await db.query('SELECT * FROM designations WHERE company_id = :c ORDER BY title', { c: req.user.companyId });
  return ok(res, rows);
}

/* ------------------------------- RBAC --------------------------------- */
async function listRoles(req, res) {
  const rows = await db.query(
    'SELECT * FROM roles WHERE company_id = :c OR company_id IS NULL ORDER BY name',
    { c: req.user.companyId }
  );
  return ok(res, rows);
}

async function listPermissions(_req, res) {
  const rows = await db.query('SELECT * FROM permissions ORDER BY module, perm_key');
  return ok(res, rows);
}

async function getRolePermissions(req, res) {
  const roleId = parseInt(req.params.id, 10);
  const rows = await db.query(
    `SELECT p.id, p.perm_key, p.module
       FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = :r ORDER BY p.module`,
    { r: roleId }
  );
  return ok(res, rows);
}

async function createRole(req, res) {
  const b = validate(req.body, {
    name: { required: true, type: 'string' },
    description: { type: 'string' },
    permissionIds: { type: 'string' }, // accept array via raw body below
  });
  const permissionIds = Array.isArray(req.body.permissionIds) ? req.body.permissionIds : [];
  const result = await db.transaction(async (tx) => {
    const r = await tx.query(
      'INSERT INTO roles (company_id, name, description) VALUES (:c, :name, :desc)',
      { c: req.user.companyId, name: b.name, desc: b.description }
    );
    const roleId = r.insertId;
    for (const pid of permissionIds) {
      await tx.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (:r, :p)', {
        r: roleId,
        p: parseInt(pid, 10),
      });
    }
    return roleId;
  });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'role', entityId: result, after: { name: b.name, permissionIds }, ip: req.ip });
  return created(res, { id: result });
}

async function setRolePermissions(req, res) {
  const roleId = parseInt(req.params.id, 10);
  const permissionIds = Array.isArray(req.body.permissionIds) ? req.body.permissionIds : [];
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM role_permissions WHERE role_id = :r', { r: roleId });
    for (const pid of permissionIds) {
      await tx.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (:r, :p)', {
        r: roleId,
        p: parseInt(pid, 10),
      });
    }
  });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPDATE', entityType: 'role_permissions', entityId: roleId, after: { permissionIds }, ip: req.ip });
  return ok(res, null, 'Permissions updated');
}

/* ------------------------------- Users -------------------------------- */
async function listUsers(req, res) {
  const rows = await db.query(
    `SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.twofa_enabled,
            u.last_login_at, r.name AS role_name, u.role_id, u.branch_id, u.employee_id
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.company_id = :c ORDER BY u.username`,
    { c: req.user.companyId }
  );
  return ok(res, rows);
}

async function createUser(req, res) {
  const b = validate(req.body, {
    username: { required: true, type: 'string' },
    email: { required: true, type: 'email' },
    full_name: { required: true, type: 'string' },
    password: { required: true, type: 'string' },
    role_id: { required: true, type: 'int' },
    branch_id: { type: 'int' },
    employee_id: { type: 'int' },
  });
  if (b.password.length < 8) throw new AppError('Password must be at least 8 characters', 422, 'WEAK_PASSWORD');
  const hash = await bcrypt.hash(b.password, env.security.bcryptRounds);
  const r = await db.query(
    `INSERT INTO users (company_id, branch_id, role_id, employee_id, username, email, password_hash, full_name)
     VALUES (:c, :branch_id, :role_id, :employee_id, :username, :email, :hash, :full_name)`,
    { ...b, c: req.user.companyId, hash }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'user', entityId: r.insertId, after: { username: b.username, role_id: b.role_id }, ip: req.ip });
  return created(res, { id: r.insertId });
}

async function updateUser(req, res) {
  const id = parseInt(req.params.id, 10);
  const before = await db.queryOne('SELECT id, role_id, is_active, twofa_enabled FROM users WHERE id = :id AND company_id = :c', { id, c: req.user.companyId });
  if (!before) throw new AppError('User not found', 404, 'NOT_FOUND');
  const b = validate(req.body, {
    role_id: { type: 'int', default: before.role_id },
    is_active: { type: 'int', default: before.is_active },
    twofa_enabled: { type: 'int', default: before.twofa_enabled },
  });
  await db.query('UPDATE users SET role_id=:role_id, is_active=:is_active, twofa_enabled=:twofa_enabled WHERE id=:id', { ...b, id });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: id, before, after: b, ip: req.ip });
  return ok(res, null, 'User updated');
}

/* ---------------------------- System settings ------------------------- */
async function listSettings(req, res) {
  const rows = await db.query(
    'SELECT * FROM system_settings WHERE company_id = :c OR company_id IS NULL ORDER BY setting_key',
    { c: req.user.companyId }
  );
  return ok(res, rows);
}

async function upsertSetting(req, res) {
  const b = validate(req.body, {
    setting_key: { required: true, type: 'string' },
    setting_value: { type: 'string' },
    value_type: { type: 'string', default: 'string', enum: ['string', 'number', 'boolean', 'json'] },
  });
  await db.query(
    `INSERT INTO system_settings (company_id, setting_key, setting_value, value_type, updated_by)
     VALUES (:c, :setting_key, :setting_value, :value_type, :u)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), value_type = VALUES(value_type), updated_by = VALUES(updated_by)`,
    { ...b, c: req.user.companyId, u: req.user.id }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPDATE', entityType: 'system_setting', entityId: b.setting_key, after: b, ip: req.ip });
  return ok(res, null, 'Setting saved');
}

/* ------------------------------- Logs --------------------------------- */
async function auditLogs(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = await db.query(
    `SELECT a.*, u.username AS actor_username
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.created_at DESC LIMIT :lim`,
    { lim: limit }
  );
  return ok(res, rows);
}

async function securityLogs(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = await db.query('SELECT * FROM security_logs ORDER BY created_at DESC LIMIT :lim', { lim: limit });
  return ok(res, rows);
}

async function loginHistory(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = await db.query('SELECT * FROM login_history ORDER BY created_at DESC LIMIT :lim', { lim: limit });
  return ok(res, rows);
}

/* ----------------------- Globalization (Module 15) -------------------- */
/** GET /api/admin/currencies — multi-currency reference + rates. */
async function listCurrencies(_req, res) {
  const rows = await db.query('SELECT * FROM currencies WHERE is_active = 1 ORDER BY code');
  return ok(res, rows);
}

/** POST /api/admin/backup — trigger an administrative database backup. */
async function createBackup(req, res) {
  const result = await backupService.runBackup();
  await audit.recordAudit({ actorUserId: req.user.id, action: 'BACKUP', entityType: 'system', entityId: 'database', after: { bytes: result.bytes }, ip: req.ip });
  return created(res, { file: path_basename(result.file), bytes: result.bytes }, 'Backup created');
}

/** GET /api/admin/backups — list existing backup archives. */
async function listBackups(_req, res) {
  return ok(res, backupService.listBackups());
}

/** Small helper to avoid leaking absolute server paths to the client. */
function path_basename(p) {
  return String(p).split(/[\\/]/).pop();
}

module.exports = {
  listCompanies, createCompany, updateCompany,
  listBranches, createBranch,
  listDepartments, createDepartment, listDesignations,
  listRoles, listPermissions, getRolePermissions, createRole, setRolePermissions,
  listUsers, createUser, updateUser,
  listSettings, upsertSetting,
  auditLogs, securityLogs, loginHistory,
  listCurrencies, createBackup, listBackups,
};
