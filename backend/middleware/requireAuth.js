/**
 * middleware/requireAuth.js
 * Bearer-token guard for every non-public route.
 *
 * ── Contract with the client ─────────────────────────────────────────────────
 * Every rejection is a 401 or 403 carrying a machine-readable `code`, because
 * the client has to react differently to each:
 *
 *   NO_TOKEN         401  No credentials at all → show the login screen.
 *   TOKEN_INVALID    401  Signature/shape is wrong → hard logout, no retry.
 *   TOKEN_EXPIRED    401  Signature fine, just old → refresh and retry once.
 *   SESSION_REVOKED  401  Logged out or revoked elsewhere → hard logout.
 *   ACCOUNT_INACTIVE 403  Archived employee → hard logout.
 *   FORBIDDEN_ROLE   403  Authenticated but not permitted → keep the session.
 *
 * Only TOKEN_EXPIRED is retryable. Collapsing these into a bare 401 would leave
 * the client unable to tell "get a new access token" from "give up", which is
 * exactly how refresh loops happen. src/services/api.js keys off these codes.
 *
 * ── Why this touches the database ───────────────────────────────────────────
 * A JWT alone cannot be un-issued, so verifying the signature is not enough:
 * a token minted seconds before logout would keep working until it expired.
 * loadSession() therefore confirms the session behind the token is still live.
 *
 * That is one primary-key lookup per request, and it also returns the current
 * employee row — so `role` is read fresh from the database rather than trusted
 * from the token, and a role change or archive takes effect immediately.
 */

const { verifyAccessToken, AuthTokenError } = require('../auth/tokens');
const { loadSession } = require('../auth/sessions');

/**
 * Pulls the token out of `Authorization: Bearer <token>`.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function deny(res, status, code, message) {
  return res.status(status).json({ success: false, code, message });
}

/**
 * Rejects the request unless it carries a valid access token backed by a live
 * session. On success attaches:
 *
 *   req.auth = { employeeId, sessionId, role }
 *   req.user = the current employees row (camelCase, no secrets)
 *
 * @type {import('express').RequestHandler}
 */
async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return deny(res, 401, 'NO_TOKEN', 'Authentication required.');
  }

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof AuthTokenError) {
      return deny(res, 401, err.code, err.message);
    }
    // assertSecret() failing is a server misconfiguration, not a bad request.
    console.error('[auth] Token verification error:', err.message);
    return deny(res, 500, 'AUTH_MISCONFIGURED', 'Authentication is not configured.');
  }

  let session;
  try {
    session = await loadSession(claims.sessionId);
  } catch (err) {
    console.error('[auth] Session lookup failed:', err.message);
    return res
      .status(503)
      .json({ success: false, code: 'AUTH_UNAVAILABLE', message: 'Could not verify session.' });
  }

  if (!session) {
    return deny(res, 401, 'SESSION_REVOKED', 'Session no longer exists. Please sign in again.');
  }

  if (session.revokedAt) {
    return deny(res, 401, 'SESSION_REVOKED', 'Session has been signed out. Please sign in again.');
  }

  if (new Date(session.expiresAt) <= new Date()) {
    return deny(res, 401, 'SESSION_REVOKED', 'Session has expired. Please sign in again.');
  }

  // The token's subject and the session's owner must agree. A mismatch means a
  // forged or mangled token, never a legitimate one.
  if (session.employee.id !== claims.employeeId) {
    return deny(res, 401, 'TOKEN_INVALID', 'Token does not match its session.');
  }

  if (session.employee.status !== 'active') {
    return deny(res, 403, 'ACCOUNT_INACTIVE', 'This account is no longer active.');
  }

  req.auth = {
    employeeId: session.employee.id,
    sessionId: session.sessionId,
    // From the database, not the token: authoritative and current.
    role: session.employee.role,
    accessTokenExpiresAt: claims.expiresAt,
  };
  req.user = session.employee;

  return next();
}

/**
 * Role gate, applied after requireAuth.
 *
 *   router.post('/', requireAuth, requireRole('ADMIN', 'HR'), handler)
 *
 * The client hides tabs by role already, but that is presentation only — this is
 * where the rule is actually enforced.
 *
 * @param {...string} allowedRoles
 * @returns {import('express').RequestHandler}
 */
function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles.map((r) => String(r).toUpperCase()));

  return function roleGuard(req, res, next) {
    if (!req.auth) {
      // Programming error: the guard was mounted without requireAuth in front.
      console.error('[auth] requireRole used without requireAuth on', req.originalUrl);
      return deny(res, 401, 'NO_TOKEN', 'Authentication required.');
    }

    if (!allowed.has(String(req.auth.role).toUpperCase())) {
      return deny(
        res,
        403,
        'FORBIDDEN_ROLE',
        'Your role does not have access to this resource.'
      );
    }

    return next();
  };
}

/**
 * Attaches `req.auth`/`req.user` when a valid token is present but never
 * rejects. For endpoints that are readable anonymously yet richer when signed
 * in. Not used yet; kept because the alternative is duplicating requireAuth.
 *
 * @type {import('express').RequestHandler}
 */
async function optionalAuth(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const claims = verifyAccessToken(token);
    const session = await loadSession(claims.sessionId);

    if (
      session &&
      !session.revokedAt &&
      new Date(session.expiresAt) > new Date() &&
      session.employee.status === 'active' &&
      session.employee.id === claims.employeeId
    ) {
      req.auth = {
        employeeId: session.employee.id,
        sessionId: session.sessionId,
        role: session.employee.role,
        accessTokenExpiresAt: claims.expiresAt,
      };
      req.user = session.employee;
    }
  } catch {
    // Anonymous is a valid outcome here.
  }

  return next();
}

module.exports = { requireAuth, requireRole, optionalAuth, extractBearerToken };
