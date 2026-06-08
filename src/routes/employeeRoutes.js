'use strict';

/** Employee Management routes (Module 2). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/employeeController');

const router = express.Router();
router.use(authenticate);

const READ = authorize('employee.read');
const WRITE = authorize('employee.write');

router.get('/', READ, asyncHandler(ctrl.list));
router.get('/:id', READ, asyncHandler(ctrl.getProfile));
router.post('/', WRITE, csrfProtection, asyncHandler(ctrl.create));
router.put('/:id', WRITE, csrfProtection, asyncHandler(ctrl.update));
router.post('/:id/status', WRITE, csrfProtection, asyncHandler(ctrl.changeStatus));
router.post('/:id/emergency-contact', WRITE, csrfProtection, asyncHandler(ctrl.addEmergencyContact));
router.put('/:id/identity-document', WRITE, csrfProtection, asyncHandler(ctrl.upsertIdentityDocument));

module.exports = router;
