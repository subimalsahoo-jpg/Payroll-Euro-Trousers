'use strict';

/**
 * Authentication controller (Modules 1 & 13).
 * -------------------------------------------------------------
 * Handles login (bcrypt verify + optional 2FA hook + lockout),
 * logout, current-user, CSRF token issuance, and password change.
 * Every attempt is written to login_history; denials to security_logs.
 */

const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { ok, created, AppError } = require('../utils/response');
const { validate } = require('../utils/validators');
const { signToken } = require('../middleware/auth');
const { issueCsrfToken } = require('../middleware/security');
const userModel = require('../models/userModel');
const audit = require('../services/auditService');

const COOKIE_NAME = 'dm.token';

/** Build a safe public view of a user (no secrets). */
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    role: u.role_name,
    roleId: u.role_id,
    companyId: u.company_id,
    branchId: u.branch_id,
    employeeId: u.employee_id,
    permissions: u.permissions,
    locale: u.preferred_locale,
    twofaEnabled: !!u.twofa_enabled,
  };
}

/** POST /api/auth/login */
async function login(req, res) {
  const body = validate(req.body, {
    username: { required: true, type: 'string' },
    password: { required: true, type: 'string' },
    otp: { required: false, type: 'string' },
  });

  const meta = { ip: req.ip, userAgent: req.get('user-agent'), username: body.username };
  const user = await userModel.findByUsername(body.username);

  if (!user || !user.is_active) {
    await audit.recordLogin({ ...meta, success: false, reason: 'unknown_or_inactive' });
    throw new AppError('Invalid credentials', 401, 'AUTH_FAILED');
  }

  // Account lockout check (Module 13 brute-force defence).
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await audit.recordSecurity({
      userId: user.id,
      eventType: 'LOGIN_LOCKED',
      severity: 'warning',
      description: 'Login attempt on locked account',
      ip: req.ip,
      userAgent: meta.userAgent,
    });
    throw new AppError('Account temporarily locked. Try again later.', 423, 'LOCKED');
  }

  const valid = await bcrypt.compare(body.password, user.password_hash);
  if (!valid) {
    await userModel.markLoginFailure(user.id);
    await audit.recordLogin({ ...meta, userId: user.id, success: false, reason: 'bad_password' });
    throw new AppError('Invalid credentials', 401, 'AUTH_FAILED');
  }

  // Optional 2FA verification hook (enabled via ENABLE_2FA + per-user flag).
  if (env.security.enable2FA && user.twofa_enabled) {
    if (!body.otp) {
      // Signal the client that a second factor is required.
      return ok(res, { twofaRequired: true }, '2FA verification required', 200);
    }
    // Placeholder verification hook: integrate TOTP (e.g. speakeasy) here.
    const otpValid = verifyOtpPlaceholder(user, body.otp);
    if (!otpValid) {
      await audit.recordSecurity({
        userId: user.id,
        eventType: '2FA_FAILED',
        severity: 'warning',
        description: 'Invalid 2FA code',
        ip: req.ip,
      });
      throw new AppError('Invalid 2FA code', 401, 'TWOFA_FAILED');
    }
  }

  await userModel.markLoginSuccess(user.id);
  await audit.recordLogin({ ...meta, userId: user.id, success: true });

  const token = signToken({
    sub: user.id,
    username: user.username,
    role: user.role_name,
    roleId: user.role_id,
    companyId: user.company_id,
    branchId: user.branch_id,
    employeeId: user.employee_id,
    permissions: user.permissions,
    locale: user.preferred_locale,
  });

  // httpOnly cookie for browser SPA; token also returned for API clients.
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.security.cookieSecure,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });

  const csrfToken = issueCsrfToken(req);
  return ok(res, { token, csrfToken, user: publicUser(user) }, 'Authenticated');
}

/**
 * Placeholder TOTP verification. In production wire a real TOTP library
 * (e.g. speakeasy.totp.verify) against user.twofa_secret. Kept structural
 * here so no real secret material is required to exercise the flow.
 */
function verifyOtpPlaceholder(_user, otp) {
  return typeof otp === 'string' && /^\d{6}$/.test(otp);
}

/** POST /api/auth/logout */
async function logout(req, res) {
  res.clearCookie(COOKIE_NAME);
  if (req.session) req.session.destroy(() => {});
  return ok(res, null, 'Logged out');
}

/** GET /api/auth/me */
async function me(req, res) {
  const user = await userModel.findById(req.user.id);
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  return ok(res, publicUser(user));
}

/** GET /api/auth/csrf — hands the SPA a CSRF token to echo back. */
async function csrf(req, res) {
  const token = issueCsrfToken(req);
  return ok(res, { csrfToken: token });
}

/** POST /api/auth/change-password */
async function changePassword(req, res) {
  const body = validate(req.body, {
    currentPassword: { required: true, type: 'string' },
    newPassword: { required: true, type: 'string' },
  });
  if (body.newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters', 422, 'WEAK_PASSWORD');
  }
  const user = await userModel.findById(req.user.id);
  const valid = await bcrypt.compare(body.currentPassword, user.password_hash);
  if (!valid) throw new AppError('Current password is incorrect', 401, 'AUTH_FAILED');

  const hash = await bcrypt.hash(body.newPassword, env.security.bcryptRounds);
  await userModel.updatePassword(user.id, hash);
  await audit.recordAudit({
    actorUserId: user.id,
    action: 'UPDATE',
    entityType: 'user_password',
    entityId: user.id,
    ip: req.ip,
  });
  return created(res, null, 'Password updated');
}

module.exports = { login, logout, me, csrf, changePassword };
