-- ============================================================================
-- SmallBusinessApp — PostgreSQL schema
--
-- Design notes:
--
-- 1. IDs stay TEXT ('emp_...', 'exp_...') rather than switching to UUID or
--    BIGSERIAL. The existing JSON data and the Expo client already carry these
--    identifiers, so preserving them keeps the migration lossless and requires
--    no frontend change.
--
-- 2. Attendance is stored as ONE ROW PER (employee, date) instead of the old
--    nested `{ date, logs: [...] }` document. This is what makes a real foreign
--    key possible, and it turns "mark one employee" into a single-row upsert
--    instead of rewriting an entire day. The API layer re-nests rows into the
--    original response shape.
--
-- 3. Money is NUMERIC(12,2), never float. This removes the parseFloat/toFixed
--    rounding dance the old JSON code needed.
--
-- 4. Authentication is SMS-OTP based. `employees.phone` is the login identity
--    (E.164, partial-unique), `otp_codes` holds hashed one-time codes, and
--    `auth_sessions` holds hashed refresh tokens so logout and revocation are
--    real server-side operations rather than a client-side state reset.
--
-- 5. This file is idempotent — safe to run repeatedly.
-- ============================================================================

-- ─── Employees ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id           TEXT PRIMARY KEY,
  name         TEXT           NOT NULL CHECK (length(trim(name)) > 0),
  role         TEXT           NOT NULL CHECK (role IN ('ADMIN', 'HR', 'EMPLOYEE')),
  department   TEXT           NOT NULL DEFAULT '',
  position     TEXT           NOT NULL DEFAULT '',
  email        TEXT           NOT NULL,
  phone        TEXT           NOT NULL DEFAULT '',
  base_salary  NUMERIC(12, 2) NOT NULL CHECK (base_salary > 0),
  join_date    DATE           NOT NULL DEFAULT CURRENT_DATE,
  status       TEXT           NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'inactive')),
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness on email. The old code compared lowercased
-- strings in JS, which could not stop two concurrent inserts from racing.
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_lower_key
  ON employees (lower(email));

CREATE INDEX IF NOT EXISTS employees_status_idx ON employees (status);


-- ─── Attendance ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  -- Surrogate key. The old JSON stored a day-level id ('att_20260801') but
  -- individual log entries had none; the day id is now derived in the API layer
  -- from the date, so nothing is lost.
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id  TEXT NOT NULL
               REFERENCES employees (id)
               ON UPDATE CASCADE
               -- RESTRICT, not CASCADE: attendance rows are payroll evidence.
               -- Deleting an employee must never silently erase salary history.
               ON DELETE RESTRICT,
  date         DATE NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('Present', 'Half-Day', 'Absent')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One record per employee per day. This is the constraint that makes the
  -- attendance POST idempotent and safe under concurrent submissions.
  CONSTRAINT attendance_employee_date_key UNIQUE (employee_id, date)
);

-- Analytics filters and groups by date constantly (monthly rollups,
-- last-7-logged-days chart), so this index carries most of the query load.
CREATE INDEX IF NOT EXISTS attendance_date_idx        ON attendance (date DESC);
CREATE INDEX IF NOT EXISTS attendance_employee_idx    ON attendance (employee_id);


-- ─── Expenses ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  date          DATE           NOT NULL,
  amount        NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category      TEXT           NOT NULL CHECK (length(trim(category)) > 0),
  description   TEXT           NOT NULL DEFAULT '',
  -- Optional attribution. SET NULL rather than RESTRICT because an expense
  -- record stays valid even if the submitter is later removed.
  submitted_by  TEXT           REFERENCES employees (id)
                               ON UPDATE CASCADE
                               ON DELETE SET NULL,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_date_idx     ON expenses (date DESC);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses (category);


-- ─── Auth: phone as a login identity ────────────────────────────────────────
-- Sign-in is an SMS OTP sent to the employee's phone, so `phone` is now an
-- identity column, not just contact metadata. Two rules follow from that:
--
--  1. It is stored in E.164 ('+919876543210'). utils/phone.js normalises every
--     value on the way in, so lookups are a plain equality match and there is
--     no ambiguity between '9876543210', '+91 98765 43210' and '098765-43210'.
--
--  2. The uniqueness index is PARTIAL. Legacy rows carry phone = '' (the column
--     default), and a plain UNIQUE index would reject the second such row.
--     Excluding '' keeps those employees importable — they simply cannot log in
--     until someone gives them a number.
CREATE UNIQUE INDEX IF NOT EXISTS employees_phone_key
  ON employees (phone)
  WHERE phone <> '';


-- ─── Auth: one-time passcodes ───────────────────────────────────────────────
-- Codes are never stored in plaintext. `code_hash` is sha256(phone:code:pepper)
-- so a database leak does not hand out live login codes, and the phone binding
-- stops a code issued for one number being replayed against another.
--
-- Rows are kept after use rather than deleted: `created_at` history is what the
-- per-phone request rate limit and the resend cooldown are computed from.
CREATE TABLE IF NOT EXISTS otp_codes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone        TEXT        NOT NULL CHECK (length(trim(phone)) > 0),
  code_hash    TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  -- Set the moment a code is exchanged for tokens. A non-NULL value makes the
  -- code unusable, which is what makes verification single-use.
  consumed_at  TIMESTAMPTZ,
  -- Failed verify count. Capped in the API so a 6-digit code cannot be brute
  -- forced within its 5-minute window.
  attempts     INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  request_ip   TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves both "newest live code for this phone" (verify) and the rate-limit /
-- cooldown counts, which all filter on phone and order by created_at.
CREATE INDEX IF NOT EXISTS otp_codes_phone_created_idx
  ON otp_codes (phone, created_at DESC);

-- Supports the housekeeping delete of long-expired rows.
CREATE INDEX IF NOT EXISTS otp_codes_expires_idx ON otp_codes (expires_at);


-- ─── Auth: refresh-token sessions ───────────────────────────────────────────
-- Access tokens are stateless JWTs and are deliberately short-lived; this table
-- is the stateful half that makes logout and revocation actually mean something.
--
-- Only the sha256 of the refresh token is stored, for the same reason as OTP
-- codes. The token itself exists solely on the device.
--
-- The access JWT carries this row's `id` as its `sid` claim, so revoking a
-- session also invalidates any access token minted from it.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                 TEXT PRIMARY KEY,
  employee_id        TEXT NOT NULL
                     REFERENCES employees (id)
                     ON UPDATE CASCADE
                     -- CASCADE is right here, unlike attendance: a session is
                     -- worthless without its employee and carries no history.
                     ON DELETE CASCADE,
  refresh_token_hash TEXT        NOT NULL UNIQUE,
  -- The hash this row held before the most recent rotation. Refresh tokens are
  -- single-use, so a token matching THIS column is one that was already spent —
  -- i.e. either a replay by a thief or a broken client. Keeping one generation
  -- is what lets rotateSession() detect that instead of reporting "unknown
  -- token" and letting the theft pass unnoticed.
  previous_token_hash TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  -- Set on logout, on refresh-token reuse detection, or when an admin kicks a
  -- device. Checked on every refresh and by the access-token guard.
  revoked_at         TIMESTAMPTZ,
  last_used_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent         TEXT        NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Log me out everywhere" and the session-list query both filter by employee.
CREATE INDEX IF NOT EXISTS auth_sessions_employee_idx
  ON auth_sessions (employee_id);

-- Supports pruning expired sessions.
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx
  ON auth_sessions (expires_at);

-- Idempotency guard: brings a table created by an earlier revision of this file
-- up to date, since CREATE TABLE IF NOT EXISTS above would skip it silently.
-- Must run before the index below, which depends on the column existing.
ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS previous_token_hash TEXT;

-- Refresh lookup is `WHERE refresh_token_hash = $1 OR previous_token_hash = $1`.
-- The first side is covered by the UNIQUE constraint; this covers the second,
-- which would otherwise force a sequential scan on every token refresh.
CREATE INDEX IF NOT EXISTS auth_sessions_previous_token_idx
  ON auth_sessions (previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;


-- ─── Scheduled report deliveries ────────────────────────────────────────────
-- Audit log for the daily/monthly reports pushed to admins, and the mechanism
-- that stops duplicates.
--
-- The scheduler is in-process, so a restart, a deploy, or a host that spins down
-- and wakes up can all cause the same period's job to fire twice. Rather than
-- trusting the timer, the sender asks this table whether (report, period,
-- channel, recipient) has already been delivered.
--
-- The unique index is PARTIAL on status = 'sent' deliberately: a failed send
-- must be retryable, so only successes are treated as final.
CREATE TABLE IF NOT EXISTS report_deliveries (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_type         TEXT NOT NULL CHECK (report_type IN ('daily', 'monthly')),
  -- '2026-08-29' for daily, '2026-08' for monthly. Together with report_type
  -- this is the idempotency key.
  period_key          TEXT NOT NULL CHECK (length(trim(period_key)) > 0),
  channel             TEXT NOT NULL DEFAULT 'whatsapp',
  recipient           TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider            TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  error               TEXT NOT NULL DEFAULT '',
  -- The report figures as sent, so a disputed number can be traced back to what
  -- the data looked like at delivery time rather than recomputed from data that
  -- has since been edited.
  payload             JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS report_deliveries_sent_key
  ON report_deliveries (report_type, period_key, channel, recipient)
  WHERE status = 'sent';

-- Supports the "was this period already delivered?" probe and the audit view.
CREATE INDEX IF NOT EXISTS report_deliveries_period_idx
  ON report_deliveries (report_type, period_key, created_at DESC);


-- ─── updated_at maintenance ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employees_set_updated_at ON employees;
CREATE TRIGGER employees_set_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS attendance_set_updated_at ON attendance;
CREATE TRIGGER attendance_set_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS expenses_set_updated_at ON expenses;
CREATE TRIGGER expenses_set_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS auth_sessions_set_updated_at ON auth_sessions;
CREATE TRIGGER auth_sessions_set_updated_at
  BEFORE UPDATE ON auth_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
