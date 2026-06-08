'use strict';

/** Salary Processing routes (Module 6). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/salaryProcessingController');

const router = express.Router();
router.use(authenticate);

router.get('/runs', authorize('payroll.read'), asyncHandler(ctrl.listRuns));
router.get('/runs/:id/register', authorize('payroll.read'), asyncHandler(ctrl.salaryRegister));
router.post('/process', authorize('payroll.process'), csrfProtection, asyncHandler(ctrl.processRun));
router.post('/runs/:id/approve', authorize('payroll.process'), csrfProtection, asyncHandler(ctrl.approveRun));
router.post('/runs/:id/lock', authorize('payroll.lock'), csrfProtection, asyncHandler(ctrl.lockRun));

module.exports = router;
