'use strict';

/** Secure Document Management routes (Module 14). */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');
const { upload } = require('../middleware/upload');
const ctrl = require('../controllers/documentController');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('document.read'), asyncHandler(ctrl.list));
router.get('/:uuid/download', authorize('document.read'), asyncHandler(ctrl.download));
router.post('/', authorize('document.write'), upload.single('file'), csrfProtection, asyncHandler(ctrl.upload));
router.delete('/:uuid', authorize('document.write'), csrfProtection, asyncHandler(ctrl.remove));

module.exports = router;
