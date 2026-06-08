'use strict';

/**
 * API route aggregator. Mounted at /api by src/app.js.
 * Each module router applies its own authentication + RBAC guards.
 */

const express = require('express');
const i18n = require('../config/i18n');
const { ok } = require('../utils/response');

const router = express.Router();

// --- Health & metadata (public) ---
router.get('/health', (_req, res) => ok(res, { status: 'up', time: new Date().toISOString() }));
router.get('/i18n/:locale', (req, res) => ok(res, i18n.getDictionary(req.params.locale)));

// --- Module routers ---
router.use('/auth', require('./authRoutes'));
router.use('/admin', require('./adminRoutes'));
router.use('/employees', require('./employeeRoutes'));
router.use('/attendance', require('./attendanceRoutes'));
router.use('/leave', require('./leaveRoutes'));
router.use('/payroll', require('./payrollRoutes'));
router.use('/salary', require('./salaryRoutes'));
router.use('/payslips', require('./payslipRoutes'));
router.use('/ess', require('./essRoutes'));
router.use('/finance', require('./financeRoutes'));
router.use('/dashboard', require('./dashboardRoutes'));
router.use('/compliance', require('./complianceRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/documents', require('./documentRoutes'));

module.exports = router;
