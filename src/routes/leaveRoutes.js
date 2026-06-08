'use strict';

/** Leave Management routes (Module 4). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/leaveController');

const router = express.Router();
router.use(authenticate);

router.get('/types', authorize('leave.read', 'leave.apply'), asyncHandler(ctrl.listTypes));
router.get('/balances/:employeeId', authorize('leave.read', 'leave.apply'), asyncHandler(ctrl.balances));
router.get('/applications', authorize('leave.read', 'leave.approve'), asyncHandler(ctrl.listApplications));
router.get('/calendar', authorize('leave.read', 'leave.approve'), asyncHandler(ctrl.calendar));
router.post('/applications', authorize('leave.apply', 'leave.approve'), csrfProtection, asyncHandler(ctrl.apply));
router.post('/applications/:id/transition', authorize('leave.approve'), csrfProtection, asyncHandler(ctrl.transition));

module.exports = router;
