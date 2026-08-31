/**
 * routes/auth.js
 * POST   /api/auth/otp/request  – send a login code by SMS
 * POST   /api/auth/otp/verify   – exchange a code for an access + refresh token
 * POST   /api/auth/refresh      – exchange a refresh token for a new pair
 * POST   /api/auth/logout       – revoke the current session
 * POST   /api/auth/logout-all   – revoke every session for the account
 * GET    /api/auth/me           – the signed-in employee
 * GET    /api/auth/sessions     – signed-in devices for this account
 *
 * ── Flow ────────────────────────────────────────────────────────────────────
 *   1. Client posts a phone number. If it belongs to an active employee, a
 *      6-digit code is hashed into `otp_codes` and texted to that number.
 *   2. Client posts phone + code. On a match the code is consumed, a session row
 *      is created, and the client receives a short-lived access JWT plus a
 *      long-lived refresh token.
 *   3. When the access token expires the client posts its refresh token and gets
 *      a fresh pair; the old refresh token stops working (rotation).
 *   4. Logout revokes the session row, which invalidates both tokens at once.
 *
 * There is no password anywhere in this flow — possession of the phone is the
 * proof. That is why the OTP limits in auth/otp.js are load-bearing.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { normalizePhone, maskPhone } = require('../utils/phone');
const {
  OtpError,
  issueCode,
  verifyCode,
  TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
} = require('../auth/otp');
const { sendOtpSms, SmsError, isDevProvider, providerName } = require('../auth/sms');
const {
  SessionError,
  createSession,
  rotateSession,
  revokeSession,
  revokeAllSessions,
  listActiveSessions,
} = require('../auth/sessions');
const { signAccessToken, accessTokenTTLSeconds } = require('../auth/tokens');
const { requireAuth, optionalAuth } = require('../middleware/requireAuth');

/**
 * When false (the default), requesting a code for an unknown number returns the
 * same success response as a known one. That prevents using this endpoint to
 * enumerate which numbers belong to staff.
 *
 * Set AUTH_REVEAL_UNKNOWN_PHONE=true for a small trusted deployment where
 * "this number isn't registered" is more helpful than the privacy it costs.
 */
const REVEAL_UNKNOWN_PHONE = process.env.AUTH_REVEAL_UNKNOWN_PHONE === 'true';

/**
 * Shapes an employee row into the session user the client stores.
 *
 * `employeeId` duplicates `id` on purpose: the app's screens already look up
 * their own attendance and payslip rows by `currentUser.employeeId`, and keeping
 * that key means the new auth payload drops into the existing screens unchanged.
 *
 * @param {object} employee camelCase employee (from auth/sessions.js)
 * @returns {object}
 */
function toAuthUser(employee) {
  const initials = String(employee.name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return {
    id: employee.id,
    employeeId: employee.id,
    name: employee.name,
    role: employee.role,
    department: employee.department,
    position: employee.position,
    email: employee.email,
    phone: employee.phone,
    avatar: initials || '??',
    status: employee.status,
  };
}

/**
 * Builds the payload returned by every endpoint that hands out credentials, so
 * verify and refresh stay byte-identical from the client's point of view.
 *
 * @param {{ employee: object, sessionId: string, refreshToken: string, refreshExpiresAt: Date }} params
 * @returns {object}
 */
function credentialsPayload({ employee, sessionId, refreshToken, refreshExpiresAt }) {
  return {
    accessToken: signAccessToken({
      employeeId: employee.id,
      role: employee.role,
      sessionId,
    }),
    refreshToken,
    tokenType: 'Bearer',
    // Seconds, so the client can refresh proactively instead of waiting for 401.
    expiresIn: accessTokenTTLSeconds(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    user: toAuthUser(employee),
  };
}

/** Client IP for the OTP audit trail, honouring a proxy header when present. */
function clientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

// ─── POST /api/auth/otp/request ───────────────────────────────────────────────
router.post('/otp/request', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);

    if (!phone) {
      return res.status(400).json({
        success: false,
        code: 'PHONE_INVALID',
        message: 'Enter a valid mobile number.',
      });
    }

    const { rows } = await query(
      `SELECT id, name, status FROM employees WHERE phone = $1`,
      [phone]
    );
    const employee = rows[0];
    const eligible = Boolean(employee) && employee.status === 'active';

    // The response shape below is identical whether or not the number is known.
    const genericResponse = {
      success: true,
      data: {
        phone: maskPhone(phone),
        expiresInSeconds: TTL_MINUTES * 60,
        resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      },
    };

    if (!eligible) {
      if (REVEAL_UNKNOWN_PHONE) {
        return res.status(404).json({
          success: false,
          code: 'PHONE_NOT_REGISTERED',
          message: 'No active employee is registered with this number.',
        });
      }
      // Deliberately no SMS, no otp_codes row, and no hint in the response.
      console.log(`[auth] OTP requested for unregistered number ${maskPhone(phone)}; ignoring.`);
      return res.json(genericResponse);
    }

    const { code, ttlMinutes } = await issueCode({ phone, ip: clientIp(req) });

    await sendOtpSms({ phone, code, ttlMinutes });

    // With the console provider nothing is actually delivered, so the code is
    // returned to keep local development and simulator testing usable. This is
    // gated on the provider, never on NODE_ENV, so a real provider can never
    // leak it.
    if (isDevProvider) {
      genericResponse.data.devCode = code;
      genericResponse.data.devNotice =
        `SMS_PROVIDER=${providerName} — no message was sent; use this code.`;
    }

    return res.json(genericResponse);
  } catch (err) {
    if (err instanceof OtpError) {
      return res
        .status(err.status)
        .json({ success: false, code: err.code, message: err.message, ...err.meta });
    }
    if (err instanceof SmsError) {
      console.error('[auth] SMS delivery failed:', err.message);
      return res.status(502).json({
        success: false,
        code: 'SMS_FAILED',
        message: 'Could not send the verification code. Please try again.',
      });
    }
    console.error('[auth] POST /otp/request error:', err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to send verification code.' });
  }
});

// ─── POST /api/auth/otp/verify ────────────────────────────────────────────────
router.post('/otp/verify', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code ?? '').replace(/\D/g, '');

    if (!phone) {
      return res.status(400).json({
        success: false,
        code: 'PHONE_INVALID',
        message: 'Enter a valid mobile number.',
      });
    }
    if (!code) {
      return res.status(400).json({
        success: false,
        code: 'OTP_REQUIRED',
        message: 'Enter the verification code.',
      });
    }

    // Consumes the code on success and throws OtpError on every failure path.
    await verifyCode({ phone, code });

    const { rows } = await query(
      `SELECT id, name, role, department, position, email, phone, status
         FROM employees
        WHERE phone = $1`,
      [phone]
    );
    const employee = rows[0];

    // Only reachable if the employee was archived or deleted between request and
    // verify. The code is already spent either way.
    if (!employee || employee.status !== 'active') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'This account is no longer active.',
      });
    }

    const { sessionId, refreshToken, expiresAt } = await createSession({
      employeeId: employee.id,
      userAgent: req.get('user-agent') || '',
    });

    console.log(`[auth] ${employee.id} (${employee.role}) signed in — session ${sessionId}`);

    return res.json({
      success: true,
      data: credentialsPayload({
        employee,
        sessionId,
        refreshToken,
        refreshExpiresAt: expiresAt,
      }),
    });
  } catch (err) {
    if (err instanceof OtpError) {
      return res
        .status(err.status)
        .json({ success: false, code: err.code, message: err.message, ...err.meta });
    }
    console.error('[auth] POST /otp/verify error:', err.message);
    return res.status(500).json({ success: false, message: 'Sign in failed.' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
/**
 * Intentionally unauthenticated: it is called precisely when the access token is
 * no longer usable. The refresh token in the body is the credential.
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken, expiresAt, sessionId, employee } = await rotateSession({
      refreshToken: req.body?.refreshToken,
      userAgent: req.get('user-agent') || '',
    });

    return res.json({
      success: true,
      data: credentialsPayload({
        employee,
        sessionId,
        refreshToken,
        refreshExpiresAt: expiresAt,
      }),
    });
  } catch (err) {
    if (err instanceof SessionError) {
      return res
        .status(err.status)
        .json({ success: false, code: err.code, message: err.message });
    }
    console.error('[auth] POST /refresh error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not refresh session.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
/**
 * optionalAuth, not requireAuth: a client whose access token has already expired
 * must still be able to log out. It sends its refresh token, which is enough to
 * identify the session.
 *
 * Always answers 200. A logout that reports failure leaves the client unsure
 * whether to clear local state, and the safe action is always to clear it.
 */
router.post('/logout', optionalAuth, async (req, res) => {
  try {
    const revoked = await revokeSession({
      sessionId: req.auth?.sessionId,
      refreshToken: req.body?.refreshToken,
    });

    if (revoked > 0) {
      console.log(`[auth] Session revoked (${revoked}) for ${req.auth?.employeeId || 'unknown'}`);
    }

    return res.json({ success: true, message: 'Signed out.' });
  } catch (err) {
    console.error('[auth] POST /logout error:', err.message);
    // Still a success from the client's perspective — it should clear its tokens.
    return res.json({ success: true, message: 'Signed out.' });
  }
});

// ─── POST /api/auth/logout-all ────────────────────────────────────────────────
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    const revoked = await revokeAllSessions(req.auth.employeeId);
    return res.json({
      success: true,
      message: `Signed out of ${revoked} device(s).`,
      data: { revoked },
    });
  } catch (err) {
    console.error('[auth] POST /logout-all error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not sign out all devices.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
/**
 * Doubles as the client's session probe on cold start: a 200 means the stored
 * tokens are still good, and any 401 code tells the client whether to refresh
 * or to clear them.
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      user: toAuthUser(req.user),
      session: {
        id: req.auth.sessionId,
        accessTokenExpiresAt: req.auth.accessTokenExpiresAt.toISOString(),
      },
    },
  });
});

// ─── GET /api/auth/sessions ───────────────────────────────────────────────────
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await listActiveSessions(req.auth.employeeId);
    return res.json({
      success: true,
      data: sessions.map((session) => ({
        ...session,
        current: session.id === req.auth.sessionId,
      })),
    });
  } catch (err) {
    console.error('[auth] GET /sessions error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch sessions.' });
  }
});

module.exports = router;
