'use strict';

/** Payroll routes (Module 5). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/payrollController');

const router = express.Router();
router.use(authenticate);

const READ = authorize('payroll.read');
const WRITE = authorize('payroll.process');

router.get('/structure/:employeeId', READ, asyncHandler(ctrl.getStructure));
router.put('/structure/:employeeId', WRITE, csrfProtection, asyncHandler(ctrl.setStructure));

router.get('/advances', READ, asyncHandler(ctrl.listAdvances));
router.post('/advances', WRITE, csrfProtection, asyncHandler(ctrl.createAdvance));

router.get('/loans', READ, asyncHandler(ctrl.listLoans));
router.post('/loans', WRITE, csrfProtection, asyncHandler(ctrl.createLoan));

router.get('/adjustments', READ, asyncHandler(ctrl.listAdjustments));
router.post('/adjustments', WRITE, csrfProtection, asyncHandler(ctrl.createAdjustment));

router.get('/overtime-preview', READ, asyncHandler(ctrl.overtimePreview));

module.exports = router;
