'use strict';

/** Attendance routes (Module 3). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/attendanceController');

const router = express.Router();
router.use(authenticate);

const READ = authorize('attendance.read');
const WRITE = authorize('attendance.write');

router.get('/', READ, asyncHandler(ctrl.dailyGrid));
router.get('/alerts', READ, asyncHandler(ctrl.missingAlerts));
router.get('/report', READ, asyncHandler(ctrl.report));
router.post('/', WRITE, csrfProtection, asyncHandler(ctrl.record));
router.post('/correct/:id', WRITE, csrfProtection, asyncHandler(ctrl.correct));
// External ingestion wrappers (biometric / Anviz CrossChex). CSRF-exempt to
// allow device/server-to-server posting; protect with API auth in production.
router.post('/ingest/:provider', WRITE, asyncHandler(ctrl.ingest));

module.exports = router;
