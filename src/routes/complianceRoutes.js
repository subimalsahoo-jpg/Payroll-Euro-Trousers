'use strict';

/** UAE Compliance routes (Module 11). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/complianceController');

const router = express.Router();
router.use(authenticate);

const READ = authorize('compliance.read');

router.get('/wps/:runId.sif', authorize('finance.export', 'compliance.read'), asyncHandler(ctrl.generateWps));
router.get('/mol-validation', READ, asyncHandler(ctrl.molValidation));
router.get('/expiries', READ, asyncHandler(ctrl.expiries));
router.post('/expiries/notify', READ, csrfProtection, asyncHandler(ctrl.notifyExpiries));

module.exports = router;
