'use strict';

/** Finance Reports routes (Module 9). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/financeController');

const router = express.Router();
router.use(authenticate);

const READ = authorize('finance.read');
const EXPORT = authorize('finance.export');

router.get('/payroll-summary', READ, asyncHandler(ctrl.payrollSummary));
router.get('/department-cost', READ, asyncHandler(ctrl.departmentCost));
router.get('/overtime-cost', READ, asyncHandler(ctrl.overtimeCost));
router.get('/outstanding-advances', READ, asyncHandler(ctrl.outstandingAdvances));
router.get('/bank-transfer/:runId.csv', EXPORT, asyncHandler(ctrl.bankTransferExport));

module.exports = router;
