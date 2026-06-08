'use strict';

/** Salary Slip routes (Module 7). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/salarySlipController');

const router = express.Router();

// Public verification endpoint (no auth) — used by the QR code link.
router.get('/verify', asyncHandler(ctrl.verify));

// Everything else requires authentication.
router.use(authenticate);
const READ = authorize('payslip.read');

router.get('/', READ, asyncHandler(ctrl.list));
router.post('/:id/generate', READ, csrfProtection, asyncHandler(ctrl.generate));
router.get('/:id/download', READ, asyncHandler(ctrl.download));
router.post('/:id/email', READ, csrfProtection, asyncHandler(ctrl.emailSlip));
router.post('/:id/acknowledge', READ, csrfProtection, asyncHandler(ctrl.acknowledge));
router.post('/:id/authorize', authorize('payroll.process'), csrfProtection, asyncHandler(ctrl.authorizeSlip));

module.exports = router;
