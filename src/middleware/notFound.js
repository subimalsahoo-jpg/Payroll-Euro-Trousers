'use strict';

/** 404 handler for unmatched API routes. */
module.exports = function notFound(req, res) {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};
