/**
 * auth/sessions.js
 * Lifecycle of the revocable half of authentication: rows in `auth_sessions`.
 *
 * One row per signed-in device. It holds the sha256 of that device's current
 * refresh token, and its primary key is the `sid` claim inside every access
 * token minted from it. Revoking the row therefore kills both credentials.
 *
 * ── Rotation and reuse detection ────────────────────────────────────────────
 * Every refresh swaps the stored hash for a new one, so a refresh token is
 * single-use. If a token that has already been rotated away is presented again,
 * the only two explanations are a stolen token or a badly broken client — and
 * they are indistinguishable from here. The safe response to either is to revoke
 * the entire family (all of that employee's sessions) and force a fresh login.
 *
 * That is why `previous_token_hash` is kept for one generation: without it, a
 * replayed token would simply look unknown and the theft would go unnoticed.
 */

const { query, transaction } = require('../db');
const {
  generateRefreshToken,
  hashRefreshToken,
  newSessionId,
  refreshTokenExpiry,
} = require('./tokens');

/** Thrown for refresh failures the client should translate into a re-login. */
class SessionError extends Error {
  /**
   * @param {number} status
   * @param {'REFRESH_INVALID'|'REFRESH_EXPIRED'|'REFRESH_REVOKED'|'SESSION_REUSED'} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'SessionError';
    this.status = status;
    this.code = code;
  }
}

/** Columns joined onto employees, kept in one place so every read agrees. */
const EMPLOYEE_COLS = `e.id, e.name, e.role, e.department, e.position,
                       e.email, e.phone, e.status`;

/**
 * Opens a new session for an employee and returns its refresh token in
 * plaintext exactly once.
 *
 * @param {{ employeeId: string, userAgent?: string }} params
 * @returns {Promise<{ sessionId: string, refreshToken: string, expiresAt: Date }>}
 */
async function createSession({ employeeId, userAgent = '' }) {
  const sessionId = newSessionId();
  const { token, hash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();

  await query(
    `INSERT INTO auth_sessions
       (id, employee_id, refresh_token_hash, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, employeeId, hash, expiresAt, String(userAgent).slice(0, 300)]
  );

  return { sessionId, refreshToken: token, expiresAt };
}

/**
 * Exchanges a refresh token for a fresh one, returning the employee it belongs
 * to so the caller can mint a matching access token.
 *
 * Runs in a transaction: the lookup takes a row lock (FOR UPDATE) so two
 * simultaneous refreshes from the same device cannot both rotate and leave one
 * holding a dead token.
 *
 * The transaction callback RETURNS an outcome rather than throwing, and the
 * error is raised afterwards. This is load-bearing: two of the failure paths
 * (reuse detection and an archived account) revoke sessions, and throwing from
 * inside the callback would trigger the helper's ROLLBACK and silently undo
 * exactly the revocation those paths exist to perform.
 *
 * @param {{ refreshToken: string, userAgent?: string }} params
 * @returns {Promise<{
 *   sessionId: string,
 *   refreshToken: string,
 *   expiresAt: Date,
 *   employee: object
 * }>}
 * @throws {SessionError}
 */
async function rotateSession({ refreshToken, userAgent = '' }) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new SessionError(401, 'REFRESH_INVALID', 'No refresh token supplied.');
  }

  const presentedHash = hashRefreshToken(refreshToken);

  const outcome = await transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT s.id, s.employee_id, s.refresh_token_hash, s.previous_token_hash,
              s.expires_at, s.revoked_at
         FROM auth_sessions s
        WHERE s.refresh_token_hash = $1 OR s.previous_token_hash = $1
        FOR UPDATE`,
      [presentedHash]
    );

    const session = rows[0];

    if (!session) return { kind: 'invalid' };

    // Matched the superseded hash → this token was already spent. Treat the
    // whole family as compromised. This write must commit, which is why the
    // callback returns instead of throwing.
    if (session.previous_token_hash === presentedHash) {
      await client.query(
        `UPDATE auth_sessions
            SET revoked_at = NOW()
          WHERE employee_id = $1 AND revoked_at IS NULL`,
        [session.employee_id]
      );
      return { kind: 'reused', employeeId: session.employee_id };
    }

    if (session.revoked_at) return { kind: 'revoked' };

    if (new Date(session.expires_at) <= new Date()) return { kind: 'expired' };

    const { rows: employeeRows } = await client.query(
      `SELECT ${EMPLOYEE_COLS} FROM employees e WHERE e.id = $1`,
      [session.employee_id]
    );
    const employee = employeeRows[0];

    // An employee archived since sign-in must not be able to keep a session
    // alive by refreshing.
    if (!employee || employee.status !== 'active') {
      await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1', [
        session.id,
      ]);
      return { kind: 'inactive' };
    }

    const next = generateRefreshToken();
    const expiresAt = refreshTokenExpiry();

    await client.query(
      `UPDATE auth_sessions
          SET refresh_token_hash  = $2,
              previous_token_hash = $3,
              expires_at          = $4,
              last_used_at        = NOW(),
              user_agent          = COALESCE(NULLIF($5, ''), user_agent)
        WHERE id = $1`,
      [
        session.id,
        next.hash,
        session.refresh_token_hash,
        expiresAt,
        String(userAgent).slice(0, 300),
      ]
    );

    return {
      kind: 'ok',
      sessionId: session.id,
      refreshToken: next.token,
      expiresAt,
      employee,
    };
  });

  // Raised after COMMIT so the revocations above survive.
  switch (outcome.kind) {
    case 'ok':
      return {
        sessionId: outcome.sessionId,
        refreshToken: outcome.refreshToken,
        expiresAt: outcome.expiresAt,
        employee: outcome.employee,
      };

    case 'reused':
      console.warn(
        `[auth] Refresh token reuse detected for employee ${outcome.employeeId}; ` +
          'all sessions revoked.'
      );
      throw new SessionError(
        401,
        'SESSION_REUSED',
        'This session was already refreshed elsewhere. Please sign in again.'
      );

    case 'revoked':
      throw new SessionError(
        401,
        'REFRESH_REVOKED',
        'Session has been signed out. Please sign in again.'
      );

    case 'expired':
      throw new SessionError(
        401,
        'REFRESH_EXPIRED',
        'Session has expired. Please sign in again.'
      );

    case 'inactive':
      throw new SessionError(401, 'REFRESH_REVOKED', 'This account is no longer active.');

    case 'invalid':
    default:
      throw new SessionError(
        401,
        'REFRESH_INVALID',
        'Session not recognised. Please sign in again.'
      );
  }
}

/**
 * Revokes one session. Used by logout.
 *
 * Accepts either identifier because logout can be reached with a valid access
 * token, an expired one plus a refresh token, or both.
 *
 * @param {{ sessionId?: string, refreshToken?: string }} params
 * @returns {Promise<number>} sessions revoked (0 if already gone)
 */
async function revokeSession({ sessionId, refreshToken }) {
  if (!sessionId && !refreshToken) return 0;

  const hash = refreshToken ? hashRefreshToken(refreshToken) : null;

  const { rowCount } = await query(
    `UPDATE auth_sessions
        SET revoked_at = NOW()
      WHERE revoked_at IS NULL
        AND ( ($1::text IS NOT NULL AND id = $1)
           OR ($2::text IS NOT NULL AND (refresh_token_hash = $2
                                      OR previous_token_hash = $2)) )`,
    [sessionId || null, hash]
  );

  return rowCount;
}

/**
 * Revokes every live session for an employee — "sign out of all devices".
 *
 * @param {string} employeeId
 * @returns {Promise<number>} sessions revoked
 */
async function revokeAllSessions(employeeId) {
  const { rowCount } = await query(
    `UPDATE auth_sessions
        SET revoked_at = NOW()
      WHERE employee_id = $1 AND revoked_at IS NULL`,
    [employeeId]
  );
  return rowCount;
}

/**
 * Loads the session and its employee in a single round trip. This is what
 * requireAuth calls on every request, which is why it is one query and not two.
 *
 * @param {string} sessionId
 * @returns {Promise<null | {
 *   sessionId: string,
 *   revokedAt: Date|null,
 *   expiresAt: Date,
 *   employee: object
 * }>}
 */
async function loadSession(sessionId) {
  const { rows } = await query(
    `SELECT s.id AS session_id, s.revoked_at, s.expires_at, ${EMPLOYEE_COLS}
       FROM auth_sessions s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.id = $1`,
    [sessionId]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    sessionId: row.session_id,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    employee: {
      id: row.id,
      name: row.name,
      role: row.role,
      department: row.department,
      position: row.position,
      email: row.email,
      phone: row.phone,
      status: row.status,
    },
  };
}

/**
 * Lists a user's active sessions, newest first. Powers a "signed-in devices"
 * view and makes the effect of logout inspectable.
 *
 * @param {string} employeeId
 * @returns {Promise<Array<object>>}
 */
async function listActiveSessions(employeeId) {
  const { rows } = await query(
    `SELECT id, user_agent, created_at, last_used_at, expires_at
       FROM auth_sessions
      WHERE employee_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_used_at DESC`,
    [employeeId]
  );

  return rows.map((row) => ({
    id: row.id,
    userAgent: row.user_agent,
    createdAt: row.created_at?.toISOString?.() ?? null,
    lastUsedAt: row.last_used_at?.toISOString?.() ?? null,
    expiresAt: row.expires_at?.toISOString?.() ?? null,
  }));
}

/**
 * Removes sessions that have been dead long enough to be beyond forensic use.
 *
 * @returns {Promise<number>} rows removed
 */
async function pruneExpiredSessions() {
  const { rowCount } = await query(
    `DELETE FROM auth_sessions
      WHERE expires_at < NOW() - INTERVAL '7 days'
         OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')`
  );
  return rowCount;
}

module.exports = {
  SessionError,
  createSession,
  rotateSession,
  revokeSession,
  revokeAllSessions,
  loadSession,
  listActiveSessions,
  pruneExpiredSessions,
};
