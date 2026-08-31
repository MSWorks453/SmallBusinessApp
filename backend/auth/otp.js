/**
 * auth/otp.js
 * Issuing and verification of one-time SMS passcodes.
 *
 * A 6-digit code is only 1,000,000 possibilities, so the code itself is not the
 * security boundary — the limits around it are. Four of them are enforced here:
 *
 *   TTL              5 minutes. Shrinks the window an intercepted code is useful.
 *   Verify attempts  5 per code, then the code is burned. Caps online guessing
 *                    at 5/1,000,000 per issued code.
 *   Resend cooldown  60 seconds. Stops an attacker (or an impatient user) from
 *                    minting fresh codes to widen the guessing surface.
 *   Request quota    5 per phone per hour. Bounds SMS cost and stops using the
 *                    endpoint to spam someone's handset.
 *
 * Codes are stored only as sha256(phone:code:pepper). The phone is inside the
 * hash so a code issued for one number cannot be replayed against another, and
 * the pepper means a leaked database alone yields no usable codes.
 *
 * Counters live in Postgres, not in process memory, so the limits survive a
 * restart and hold across multiple API instances.
 */

const crypto = require('crypto');
const { query } = require('../db');

const CODE_LENGTH = 6;
const TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
const MAX_REQUESTS_PER_HOUR = Number(process.env.OTP_MAX_REQUESTS_PER_HOUR || 5);

// Falls back to JWT_SECRET so there is one fewer required env var; a dedicated
// OTP_PEPPER is still preferable so the two secrets can be rotated separately.
const PEPPER = process.env.OTP_PEPPER || process.env.JWT_SECRET || '';

/**
 * Thrown for every user-visible OTP failure. `status` and `code` let the route
 * translate it into a response without a chain of instanceof checks.
 */
class OtpError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code machine-readable reason
   * @param {string} message human-readable message
   * @param {object} [meta] extra fields merged into the response
   */
  constructor(status, code, message, meta = {}) {
    super(message);
    this.name = 'OtpError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

/**
 * Cryptographically uniform 6-digit code.
 *
 * crypto.randomInt, not Math.random: a predictable PRNG here would let an
 * attacker who has seen one code compute the next.
 *
 * @returns {string} zero-padded, e.g. '004271'
 */
function generateCode() {
  const max = 10 ** CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(CODE_LENGTH, '0');
}

/**
 * @param {string} phone E.164
 * @param {string} code
 * @returns {string} lowercase hex sha256
 */
function hashCode(phone, code) {
  return crypto.createHash('sha256').update(`${phone}:${code}:${PEPPER}`).digest('hex');
}

/**
 * Constant-time hash comparison.
 *
 * A plain `===` on hex strings returns as soon as it finds a differing byte, and
 * that timing difference is measurable over enough requests. Both inputs are
 * fixed-length sha256 hex here, so lengths always match.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function hashesEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Enforces the resend cooldown and the hourly quota for a phone number.
 *
 * @param {string} phone E.164
 * @throws {OtpError} 429 when either limit is hit
 */
async function assertWithinRateLimits(phone) {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')  AS last_hour,
       MAX(created_at)                                                 AS last_sent_at
     FROM otp_codes
     WHERE phone = $1`,
    [phone]
  );

  const lastHour = Number(rows[0].last_hour || 0);
  const lastSentAt = rows[0].last_sent_at ? new Date(rows[0].last_sent_at) : null;

  if (lastSentAt) {
    const elapsed = (Date.now() - lastSentAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      const retryAfter = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
      throw new OtpError(
        429,
        'OTP_COOLDOWN',
        `Please wait ${retryAfter} second(s) before requesting another code.`,
        { retryAfterSeconds: retryAfter }
      );
    }
  }

  if (lastHour >= MAX_REQUESTS_PER_HOUR) {
    throw new OtpError(
      429,
      'OTP_RATE_LIMITED',
      'Too many codes requested for this number. Please try again later.',
      { retryAfterSeconds: 3600 }
    );
  }
}

/**
 * Issues a code for a phone number and returns it in plaintext exactly once, so
 * the caller can hand it to the SMS provider. Nothing persists the plaintext.
 *
 * Any still-live code for the same phone is consumed first. Without that, an
 * older code would remain valid alongside the new one and every resend would
 * widen the set of accepted codes.
 *
 * @param {{ phone: string, ip?: string }} params
 * @returns {Promise<{ code: string, expiresAt: Date, ttlMinutes: number }>}
 */
async function issueCode({ phone, ip = '' }) {
  await assertWithinRateLimits(phone);

  const code = generateCode();
  const codeHash = hashCode(phone, code);
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  await query(
    `UPDATE otp_codes
        SET consumed_at = NOW()
      WHERE phone = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
    [phone]
  );

  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, request_ip)
     VALUES ($1, $2, $3, $4)`,
    [phone, codeHash, expiresAt, String(ip).slice(0, 100)]
  );

  return { code, expiresAt, ttlMinutes: TTL_MINUTES };
}

/**
 * Checks a submitted code and consumes it on success.
 *
 * The `attempts` increment is committed even on failure — that is the whole
 * point of the counter, so a wrong guess must cost something.
 *
 * Failure messages are deliberately uniform ('invalid or expired'). Telling the
 * caller whether the code was wrong, stale, or already used would help them
 * work out what to try next.
 *
 * @param {{ phone: string, code: string }} params
 * @returns {Promise<{ otpId: string }>}
 * @throws {OtpError}
 */
async function verifyCode({ phone, code }) {
  const { rows } = await query(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM otp_codes
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone]
  );

  const record = rows[0];

  if (!record || record.consumed_at || new Date(record.expires_at) <= new Date()) {
    throw new OtpError(
      400,
      'OTP_INVALID',
      'That code is invalid or has expired. Request a new one.'
    );
  }

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    // Burn it so the cap cannot be sidestepped by simply continuing to guess.
    await query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1', [record.id]);
    throw new OtpError(
      429,
      'OTP_TOO_MANY_ATTEMPTS',
      'Too many incorrect attempts. Request a new code.'
    );
  }

  if (!hashesEqual(record.code_hash, hashCode(phone, code))) {
    const { rows: bumped } = await query(
      'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
      [record.id]
    );
    const attemptsUsed = Number(bumped[0]?.attempts || record.attempts + 1);

    throw new OtpError(
      400,
      'OTP_INVALID',
      'That code is invalid or has expired. Request a new one.',
      { attemptsRemaining: Math.max(0, MAX_VERIFY_ATTEMPTS - attemptsUsed) }
    );
  }

  // Single-use: the conditional UPDATE is what makes two concurrent verifies of
  // the same code resolve to one winner.
  const { rowCount } = await query(
    'UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL',
    [record.id]
  );

  if (rowCount === 0) {
    throw new OtpError(
      400,
      'OTP_INVALID',
      'That code is invalid or has expired. Request a new one.'
    );
  }

  return { otpId: String(record.id) };
}

/**
 * Deletes OTP rows that are past the window the rate limiter looks at, so the
 * table does not grow without bound. Safe to call on a timer.
 *
 * @returns {Promise<number>} rows removed
 */
async function pruneExpiredCodes() {
  const { rowCount } = await query(
    `DELETE FROM otp_codes WHERE created_at < NOW() - INTERVAL '24 hours'`
  );
  return rowCount;
}

module.exports = {
  OtpError,
  issueCode,
  verifyCode,
  pruneExpiredCodes,
  TTL_MINUTES,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_REQUESTS_PER_HOUR,
};
