'use strict';

/** Notification routes (Module 12). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const ctrl = require('../controllers/notificationController');

const router = express.Router();
router.use(authenticate);

router.get('/', asyncHandler(ctrl.list));
router.post('/:id/read', csrfProtection, asyncHandler(ctrl.markRead));

module.exports = router;
