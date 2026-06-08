'use strict';

/**
 * Authentication + RBAC authorization middleware (Modules 1 & 13).
 * -------------------------------------------------------------
 * Authentication accepts either:
 *   - a Bearer JWT in the Authorization header, or
 *   - an httpOnly auth cookie ("dm.token") set at login.
 *
 * The decoded token carries the user id, role and a flat list of
 * permission keys, enabling granular Role-Based Access Control without
 * a DB round-trip on every request. SUPER_ADMIN bypasses checks.
 */

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('../utils/response');
const audit = require('../services/auditService');

const SUPER_ADMIN = 'SUPER_ADMIN';

/** Sign a JWT for an authenticated user. */
function signToken(payload) {
  return jwt.sign(payload, env.security.jwtSecret, {
    expiresIn: env.security.jwtExpiresIn,
    issuer: 'divya-moolya-hrms',
  });
}

/** Extract a token from header or cookie. */
function extractToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies && req.cookies['dm.token']) return req.cookies['dm.token'];
  return null;
}

/** Require a valid authenticated user; attaches req.user. */
function authenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    return next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
  }
  try {
    const decoded = jwt.verify(token, env.security.jwtSecret);
    req.user = {
      id: decoded.sub,
      username: decoded.username,
      role: decoded.role,
      roleId: decoded.roleId,
      companyId: decoded.companyId,
      branchId: decoded.branchId,
      employeeId: decoded.employeeId || null,
      permissions: decoded.permissions || [],
      locale: decoded.locale || env.i18n.defaultLocale,
    };
    return next();
  } catch (_e) {
    return next(new AppError('Invalid or expired session', 401, 'UNAUTHENTICATED'));
  }
}

/** True if the user holds a permission (SUPER_ADMIN holds everything). */
function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === SUPER_ADMIN) return true;
  if (!permission) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

/**
 * Guard a route by one or more required permissions (any-of semantics).
 * Records a security log entry on denial.
 */
function authorize(...permissions) {
  return async function guard(req, _res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
    }
    const allowed =
      permissions.length === 0 ||
      req.user.role === SUPER_ADMIN ||
      permissions.some((p) => hasPermission(req.user, p));

    if (!allowed) {
      await audit.recordSecurity({
        userId: req.user.id,
        eventType: 'ACCESS_DENIED',
        severity: 'warning',
        description: `Missing permission(s): ${permissions.join(', ')} for ${req.method} ${req.originalUrl}`,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return next(new AppError('You do not have permission to perform this action', 403, 'FORBIDDEN'));
    }
    return next();
  };
}

/** Guard a route by role membership (any-of). */
function requireRole(...roles) {
  return function guard(req, _res, next) {
    if (!req.user) return next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
    if (req.user.role === SUPER_ADMIN || roles.includes(req.user.role)) return next();
    return next(new AppError('Insufficient role', 403, 'FORBIDDEN'));
  };
}

/**
 * Ensure an Employee-Self-Service caller only touches their own records.
 * Compares the :employeeId route param against the token's employeeId.
 * SUPER_ADMIN / HR roles (via permission) may access any record.
 */
function selfOrPermission(permission) {
  return function guard(req, _res, next) {
    if (!req.user) return next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
    const target = parseInt(req.params.employeeId, 10);
    if (req.user.employeeId && target === req.user.employeeId) return next();
    if (hasPermission(req.user, permission)) return next();
    return next(new AppError('You can only access your own records', 403, 'FORBIDDEN'));
  };
}

module.exports = {
  signToken,
  authenticate,
  authorize,
  requireRole,
  selfOrPermission,
  hasPermission,
  SUPER_ADMIN,
};
