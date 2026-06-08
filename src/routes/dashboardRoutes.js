'use strict';

/** Dashboard Analytics routes (Module 10). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/dashboardController');

const router = express.Router();
router.use(authenticate);

router.get('/metrics', asyncHandler(ctrl.metrics));
router.get('/charts', asyncHandler(ctrl.charts));

module.exports = router;
