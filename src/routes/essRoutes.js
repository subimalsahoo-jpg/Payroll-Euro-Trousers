'use strict';

/** Employee Self Service routes (Module 8). Any authenticated user with a linked employee profile. */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/essController');

const router = express.Router();
router.use(authenticate);

router.get('/dashboard', asyncHandler(ctrl.dashboard));
router.get('/attendance', asyncHandler(ctrl.attendanceHistory));
router.get('/payslips', asyncHandler(ctrl.payslips));
router.get('/announcements', asyncHandler(ctrl.announcements));
router.post('/leave', csrfProtection, asyncHandler(ctrl.applyLeave));
router.put('/profile', csrfProtection, asyncHandler(ctrl.updateProfile));

module.exports = router;
