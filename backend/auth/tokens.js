/**
 * auth/tokens.js
 * Mints and validates the two credentials the app uses after OTP verification.
 *
 * ── Why two tokens ──────────────────────────────────────────────────────────
 * Access token   Stateless HS256 JWT, short TTL (15 min default). Sent on every
 *                request. Verified with signature + expiry alone, so the hot
 *                path costs no database round trip.
 *
 * Refresh token  Opaque 32 random bytes, long TTL (30 days default), stored in
 *                `auth_sessions` as a sha256 hash. Exchanged for a new access
 *                token when the old one expires.
 *
 * The split is what makes "expire if the token is invalid" workable without
 * logging users out every 15 minutes: the access token is the thing that
 * expires quickly, and the refresh token is the thing that can be revoked
 * server-side on logout.
 *
 * The access JWT carries the session id as `sid`. That is the link back to the
 * revocable half — see middleware/requireAuth.js, which rejects access tokens
 * whose session has been revoked.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

const ISSUER = 'smallbusinessapp';
const ALGORITHM = 'HS256';

// A short secret is a forgeable secret. 32 bytes of hex is the documented
// minimum in .env.example.
const MIN_SECRET_LENGTH = 32;

/**
 * Fail loudly and early rather than signing tokens with `undefined`, which
 * jsonwebtoken would happily accept for HS256 and which would make every token
 * in the system trivially forgeable.
 */
function assertSecret() {
  if (!JWT_SECRET || JWT_SECRET.length < MIN_SECRET_LENGTH) {
    const suggestion = crypto.randomBytes(32).toString('hex');
    throw new Error(
      'JWT_SECRET is missing or shorter than 32 characters. ' +
        'Add this line to backend/.env and restart:\n' +
        `  JWT_SECRET=${suggestion}`
    );
  }
}

/** Thrown by verifyAccessToken so callers can map a reason to an HTTP response. */
class AuthTokenError extends Error {
  /**
   * @param {'TOKEN_EXPIRED'|'TOKEN_INVALID'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'AuthTokenError';
    this.code = code;
  }
}

/**
 * Signs a short-lived access token.
 *
 * Claims are kept minimal and non-sensitive: they travel in a base64 payload
 * that anyone holding the token can read. `role` is included so route guards
 * can authorise without a lookup; it is re-read from the database on every
 * refresh so a demotion takes effect within one access-token lifetime.
 *
 * @param {{ employeeId: string, role: string, sessionId: string }} params
 * @returns {string} signed JWT
 */
function signAccessToken({ employeeId, role, sessionId }) {
  assertSecret();

  return jwt.sign(
    { role, sid: sessionId, typ: 'access' },
    JWT_SECRET,
    {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      subject: employeeId,
      expiresIn: ACCESS_TOKEN_TTL,
    }
  );
}

/**
 * Verifies an access token's signature, issuer, algorithm and expiry.
 *
 * `algorithms` is pinned explicitly. Without it, a token could name its own
 * algorithm and downgrade verification.
 *
 * @param {string} token
 * @returns {{ employeeId: string, role: string, sessionId: string, expiresAt: Date }}
 * @throws {AuthTokenError}
 */
function verifyAccessToken(token) {
  assertSecret();

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthTokenError('TOKEN_EXPIRED', 'Access token has expired.');
    }
    throw new AuthTokenError('TOKEN_INVALID', 'Access token is invalid.');
  }

  // A refresh token must never be accepted as an access token.
  if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
    throw new AuthTokenError('TOKEN_INVALID', 'Access token is malformed.');
  }

  return {
    employeeId: payload.sub,
    role: payload.role,
    sessionId: payload.sid,
    expiresAt: new Date(payload.exp * 1000),
  };
}

/**
 * Creates a refresh token.
 *
 * Returns the plaintext (handed to the client exactly once) alongside the hash
 * (all the server ever persists). 256 bits of CSPRNG output needs no extra
 * stretching, so a single sha256 pass is enough — unlike a password, this value
 * is not guessable and not reused anywhere else.
 *
 * @returns {{ token: string, hash: string }}
 */
function generateRefreshToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

/**
 * @param {string} token
 * @returns {string} lowercase hex sha256
 */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** @returns {string} a new session primary key, e.g. 'ses_a1b2c3…' */
function newSessionId() {
  return `ses_${crypto.randomBytes(12).toString('hex')}`;
}

/** @returns {Date} absolute expiry for a freshly issued refresh token */
function refreshTokenExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Access-token lifetime in seconds, so the client can schedule a proactive
 * refresh instead of waiting for a 401.
 * @returns {number}
 */
function accessTokenTTLSeconds() {
  const match = /^(\d+)\s*([smhd])?$/.exec(String(ACCESS_TOKEN_TTL).trim());
  if (!match) return 900;

  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return amount * multiplier;
}

module.exports = {
  AuthTokenError,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  newSessionId,
  refreshTokenExpiry,
  accessTokenTTLSeconds,
  assertSecret,
  REFRESH_TOKEN_TTL_DAYS,
  ACCESS_TOKEN_TTL,
};
