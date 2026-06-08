'use strict';

/** Authentication routes (Modules 1 & 13). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/authController');

const router = express.Router();

router.get('/csrf', asyncHandler(ctrl.csrf));
router.post('/login', authLimiter, asyncHandler(ctrl.login));
router.post('/logout', asyncHandler(ctrl.logout));
router.get('/me', authenticate, asyncHandler(ctrl.me));
router.post('/change-password', authenticate, csrfProtection, asyncHandler(ctrl.changePassword));

module.exports = router;
