/**
 * routes/attendance.js
 * GET  /api/attendance         – all attendance, newest day first
 * GET  /api/attendance/roster  – who the caller may mark today          [ADMIN, HR]
 * GET  /api/attendance/:date   – one day (YYYY-MM-DD)
 * POST /api/attendance         – upsert a day's logs                    [ADMIN, HR]
 *
 * The whole router sits behind requireAuth (see server.js); the bracketed roles
 * are the additional per-route restriction.
 *
 * ── Delegated marking ───────────────────────────────────────────────────────
 * Marking is one level down the hierarchy: ADMIN records HR, HR records
 * EMPLOYEE. /roster returns the permitted set and POST rejects anything outside
 * it, so the rule holds whether the request comes from the app or from curl.
 *
 * ── Which dates and which people ────────────────────────────────────────────
 * Two further rules bound what can be written, both enforced on /roster and on
 * POST so the UI and the API cannot disagree:
 *
 *   Dates    Current or past only, resolved in the business timezone. Attendance
 *            records what happened; there is nothing to record about tomorrow.
 *   People   Only employees whose join_date is on or before the date. Salary is
 *            attendance-weighted, so a pre-employment row would pay someone for
 *            time before they were hired.
 *
 * Note that nobody marks an ADMIN, which means ADMIN salaries never enter the
 * payroll totals — analytics multiplies by attendance, and no rows means zero.
 * See auth/roles.js if that needs revisiting.
 *
 * Storage is one row per (employee, date); the nested
 * `{ id, date, logs: [{ employeeId, status }] }` shape the client expects is
 * rebuilt on the way out, so responses are unchanged from the JSON-file version.
 */

const express = require('express');
const router = express.Router();
const { query, transaction } = require('../db');
const { toAttendanceDays, attendanceDayId } = require('../db/mappers');
const { requireRole } = require('../middleware/requireAuth');
const { toEmployee } = require('../db/mappers');
const {
  attendanceRolesFor,
  canMarkAttendanceFor,
  describeRoles,
} = require('../auth/roles');
const { today, isValidDate, REPORT_TIMEZONE } = require('../utils/period');

const VALID_STATUSES = ['Present', 'Half-Day', 'Absent'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Attendance drives payroll, so writing it is restricted to the roles that own
// that responsibility. Employees can read their own history through the portal
// but must not be able to mark themselves present.
//
// Which people a marker may cover is a separate, narrower question, answered by
// auth/roles.js: ADMIN marks HR, HR marks EMPLOYEE.
const CAN_MARK_ATTENDANCE = requireRole('ADMIN', 'HR');

// ─── GET /api/attendance/roster ────────────────────────────────────────────────
/**
 * The people the caller may mark attendance for today: ADMIN gets the HR staff,
 * HR gets the employees.
 *
 * This exists as its own endpoint rather than reusing GET /api/employees because
 * the two answer different questions. An ADMIN's staff directory is the whole
 * organisation, but their attendance roster is HR only — so the Time screen
 * cannot simply render the directory.
 *
 * Declared before '/:date' so 'roster' is never parsed as a date.
 */
router.get('/roster', CAN_MARK_ATTENDANCE, async (req, res) => {
  try {
    const businessToday = today();
    const date = req.query.date || businessToday;

    if (!isValidDate(date)) {
      return res.status(400).json({
        success: false,
        message: 'date must be a real calendar date in YYYY-MM-DD form.',
      });
    }

    if (date > businessToday) {
      return res.status(400).json({
        success: false,
        code: 'FUTURE_DATE',
        message: `Attendance cannot be recorded for a future date. Today is ${businessToday}.`,
      });
    }

    const roles = attendanceRolesFor(req.auth.role);

    if (roles.length === 0) {
      return res.json({
        success: true,
        data: { date, today: businessToday, timezone: REPORT_TIMEZONE, roles, employees: [] },
      });
    }

    // join_date <= date is what makes the roster reflect who was actually
    // employed on that day. Without it, back-filling an earlier date would list
    // someone who has not started yet and silently create attendance — and
    // therefore salary — for a period before they were hired.
    const { rows } = await query(
      `SELECT id, name, role, department, position, email, phone,
              base_salary, join_date, status
         FROM employees
        WHERE role = ANY($1::text[])
          AND status = 'active'
          AND join_date <= $2::date
        ORDER BY name ASC`,
      [roles, date]
    );

    res.json({
      success: true,
      data: {
        date,
        // The client must not decide this for itself: a device in another
        // timezone would disagree about which dates are in the future, and the
        // server's answer is the one that actually gets enforced.
        today: businessToday,
        timezone: REPORT_TIMEZONE,
        // Echoed so the client can explain whose attendance this is.
        roles,
        employees: rows.map(toEmployee),
      },
    });
  } catch (err) {
    console.error('[attendance] GET /roster error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch the attendance roster.' });
  }
});

// ─── GET all attendance logs ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Newest day first, matching the previous descending sort. Ordering by
    // employee_id within a day just keeps output deterministic; the client
    // indexes logs by employeeId, so intra-day order is not significant.
    const { rows } = await query(
      `SELECT employee_id, date, status
       FROM attendance
       ORDER BY date DESC, employee_id ASC`
    );

    res.json({ success: true, data: toAttendanceDays(rows) });
  } catch (err) {
    console.error('[attendance] GET error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance logs.' });
  }
});

// ─── GET attendance for a specific date ────────────────────────────────────────
router.get('/:date', async (req, res) => {
  try {
    const { date } = req.params;

    if (!DATE_RE.test(date)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const { rows } = await query(
      `SELECT employee_id, date, status
       FROM attendance
       WHERE date = $1
       ORDER BY employee_id ASC`,
      [date]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No attendance record found for date: ${date}`,
      });
    }

    res.json({ success: true, data: toAttendanceDays(rows)[0] });
  } catch (err) {
    console.error('[attendance] GET/:date error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance record.' });
  }
});

// ─── POST upsert daily attendance ──────────────────────────────────────────────
/**
 * Body: { date: '2026-08-15', logs: [{ employeeId, status }, ...] }
 *
 * Behaviour change worth knowing about: the old handler replaced the entire day
 * document, so any employee missing from the payload silently lost that day's
 * record. This version upserts each employee individually inside one
 * transaction, keyed on the UNIQUE (employee_id, date) constraint. Two devices
 * submitting at once can no longer clobber each other, and employees absent
 * from the payload keep whatever was already recorded.
 */
router.post('/', CAN_MARK_ATTENDANCE, async (req, res) => {
  try {
    const { date, logs } = req.body;

    if (!date || !DATE_RE.test(date) || !isValidDate(date)) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid date field (YYYY-MM-DD) is required.' });
    }

    // Attendance is a record of what happened, so it may only be written for the
    // current or a past date. Resolved in the business timezone, not the host's:
    // a UTC server would otherwise reject "today" for the first 5.5 hours of
    // every Indian day.
    const businessToday = today();
    if (date > businessToday) {
      return res.status(400).json({
        success: false,
        code: 'FUTURE_DATE',
        message:
          `Attendance cannot be recorded for a future date. ` +
          `Today is ${businessToday} (${REPORT_TIMEZONE}).`,
      });
    }

    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'logs must be a non-empty array of { employeeId, status } objects.',
      });
    }

    // Reject duplicate employeeIds up front. Without this, a payload containing
    // the same employee twice would hit "ON CONFLICT DO UPDATE command cannot
    // affect row a second time" mid-transaction.
    const seen = new Set();

    for (const log of logs) {
      if (!log || typeof log.employeeId !== 'string' || !log.employeeId) {
        return res.status(400).json({
          success: false,
          message: 'Each log entry must have a valid employeeId string.',
        });
      }
      if (!VALID_STATUSES.includes(log.status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status "${log.status}". Must be one of: ${VALID_STATUSES.join(', ')}.`,
        });
      }
      if (seen.has(log.employeeId)) {
        return res.status(400).json({
          success: false,
          message: `Duplicate entry for employeeId "${log.employeeId}" in the same request.`,
        });
      }
      seen.add(log.employeeId);
    }

    // Verify every referenced employee exists, so we can return a helpful 400
    // rather than surfacing a raw foreign-key error. `role` and `name` come back
    // too, for the delegation check below.
    const ids = [...seen];
    const { rows: found } = await query(
      `SELECT id, name, role, join_date FROM employees WHERE id = ANY($1::text[])`,
      [ids]
    );
    if (found.length !== ids.length) {
      const knownIds = new Set(found.map((r) => r.id));
      const unknown = ids.filter((id) => !knownIds.has(id));
      return res.status(400).json({
        success: false,
        message: `Unknown employeeId(s): ${unknown.join(', ')}.`,
      });
    }

    // ── Delegation check ─────────────────────────────────────────────────────
    // ADMIN records HR, HR records EMPLOYEE. Enforced per row rather than on the
    // request as a whole, so a payload mixing permitted and forbidden people is
    // rejected outright instead of being partially applied — the write below is
    // a transaction and must be all-or-nothing.
    const outOfScope = found.filter((row) => !canMarkAttendanceFor(req.auth.role, row.role));

    if (outOfScope.length > 0) {
      const allowed = attendanceRolesFor(req.auth.role);
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ATTENDANCE_SCOPE',
        message:
          `As ${req.auth.role} you can only mark attendance for ` +
          `${describeRoles(allowed)} staff. Not permitted: ` +
          `${outOfScope.map((r) => `${r.name} (${r.role})`).join(', ')}.`,
      });
    }

    // ── Joining-date check ───────────────────────────────────────────────────
    // An employee cannot have attended before they were hired. This is not just
    // tidiness: the salary formula is score/totalDays * baseSalary, so a stray
    // pre-employment row would pay someone for a period they had not started,
    // and would also inflate the month's totalDays denominator for everyone.
    //
    // join_date arrives as a plain 'YYYY-MM-DD' string (see the DATE type parser
    // in db/index.js), so a string comparison is a correct date comparison here.
    const notYetJoined = found.filter((row) => row.join_date > date);

    if (notYetJoined.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'BEFORE_JOIN_DATE',
        message:
          `These staff had not joined on ${date}: ` +
          `${notYetJoined.map((r) => `${r.name} (joined ${r.join_date})`).join(', ')}.`,
      });
    }

    const saved = await transaction(async (client) => {
      for (const log of logs) {
        await client.query(
          `INSERT INTO attendance (employee_id, date, status)
           VALUES ($1, $2, $3)
           ON CONFLICT (employee_id, date)
           DO UPDATE SET status = EXCLUDED.status`,
          [log.employeeId, date, log.status]
        );
      }

      const { rows } = await client.query(
        `SELECT employee_id, date, status
         FROM attendance
         WHERE date = $1
         ORDER BY employee_id ASC`,
        [date]
      );
      return rows;
    });

    res.status(201).json({
      success: true,
      data: toAttendanceDays(saved)[0] ?? { id: attendanceDayId(date), date, logs: [] },
      message: `Attendance for ${date} saved (${logs.length} employee record(s)).`,
    });
  } catch (err) {
    console.error('[attendance] POST error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save attendance.' });
  }
});

module.exports = router;
