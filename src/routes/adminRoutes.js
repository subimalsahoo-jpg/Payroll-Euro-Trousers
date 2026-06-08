'use strict';

/** Super Admin routes (Module 1). All require authentication + admin perms. */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/adminController');

const router = express.Router();
router.use(authenticate);

const ADMIN = authorize('admin.manage');
const USERS = authorize('user.manage');
const AUDIT = authorize('audit.read');

// Companies / branches / departments / designations
router.get('/companies', ADMIN, asyncHandler(ctrl.listCompanies));
router.post('/companies', ADMIN, csrfProtection, asyncHandler(ctrl.createCompany));
router.put('/companies/:id', ADMIN, csrfProtection, asyncHandler(ctrl.updateCompany));

router.get('/branches', authorize('admin.manage', 'employee.read'), asyncHandler(ctrl.listBranches));
router.post('/branches', ADMIN, csrfProtection, asyncHandler(ctrl.createBranch));

router.get('/departments', authorize('admin.manage', 'employee.read'), asyncHandler(ctrl.listDepartments));
router.post('/departments', ADMIN, csrfProtection, asyncHandler(ctrl.createDepartment));
router.get('/designations', authorize('admin.manage', 'employee.read'), asyncHandler(ctrl.listDesignations));

// RBAC
router.get('/roles', USERS, asyncHandler(ctrl.listRoles));
router.post('/roles', USERS, csrfProtection, asyncHandler(ctrl.createRole));
router.get('/roles/:id/permissions', USERS, asyncHandler(ctrl.getRolePermissions));
router.put('/roles/:id/permissions', USERS, csrfProtection, asyncHandler(ctrl.setRolePermissions));
router.get('/permissions', USERS, asyncHandler(ctrl.listPermissions));

// Users
router.get('/users', USERS, asyncHandler(ctrl.listUsers));
router.post('/users', USERS, csrfProtection, asyncHandler(ctrl.createUser));
router.put('/users/:id', USERS, csrfProtection, asyncHandler(ctrl.updateUser));

// Settings
router.get('/settings', ADMIN, asyncHandler(ctrl.listSettings));
router.put('/settings', ADMIN, csrfProtection, asyncHandler(ctrl.upsertSetting));

// Logs
router.get('/logs/audit', AUDIT, asyncHandler(ctrl.auditLogs));
router.get('/logs/security', AUDIT, asyncHandler(ctrl.securityLogs));
router.get('/logs/login-history', AUDIT, asyncHandler(ctrl.loginHistory));

// Globalization (Module 15): currencies + system backups
router.get('/currencies', authorize('admin.manage', 'employee.read'), asyncHandler(ctrl.listCurrencies));
router.post('/backup', ADMIN, csrfProtection, asyncHandler(ctrl.createBackup));
router.get('/backups', ADMIN, asyncHandler(ctrl.listBackups));

module.exports = router;
