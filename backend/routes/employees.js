/**
 * routes/employees.js
 * GET    /api/employees      – list employees (active by default)
 * GET    /api/employees/:id  – fetch one employee
 * POST   /api/employees      – create an employee                       [ADMIN, HR]
 * PUT    /api/employees/:id  – update an employee                       [ADMIN, HR]
 *                              changing `role`, or touching an ADMIN,   [ADMIN]
 * DELETE /api/employees/:id  – delete, or archive if payroll history exists  [ADMIN]
 *
 * The whole router sits behind requireAuth (see server.js); the bracketed roles
 * above are the additional per-route restrictions.
 *
 * Two invariants are enforced on writes, both guarding one-way doors:
 *  1. Only an ADMIN may set `role` or modify an ADMIN. `role` grants permissions,
 *     so allowing HR to write it would let HR make itself ADMIN.
 *  2. The last active ADMIN cannot be demoted, archived or deleted. With none
 *     left, every route that could appoint a new one is itself ADMIN-only.
 *
 * Response shapes are byte-compatible with the previous JSON-file version.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { toEmployee } = require('../db/mappers');
const { generateId } = require('../utils/fileHelpers');
const { requireRole } = require('../middleware/requireAuth');
const { revokeAllSessions } = require('../auth/sessions');
const { normalizePhone } = require('../utils/phone');
const {
  ALL_ROLES,
  visibleRolesFor,
  assignableRolesFor,
  manageableRolesFor,
  canAssignRole,
  canManageRole,
  describeRoles,
  normalizeRole,
} = require('../auth/roles');

const VALID_ROLES = ALL_ROLES;

// Authentication is applied to this whole router in server.js. These are the
// narrower rules: reading the directory is fine for any signed-in employee, but
// changing who is on the payroll is not. The client hides the Staff tab from the
// EMPLOYEE role, which is presentation only — this is the actual enforcement.
const CAN_MANAGE_STAFF = requireRole('ADMIN', 'HR');
const CAN_REMOVE_STAFF = requireRole('ADMIN');

/**
 * Active ADMIN count, used to refuse changes that would leave none.
 *
 * With zero active admins nobody can create an employee, promote anyone, or open
 * the reports — and there is no in-app way back, because every route that could
 * fix it is itself ADMIN-only. Recovery would need direct database access. This
 * is a one-way door, so it is worth a query to keep shut.
 *
 * @param {string} [excludingId] treat this employee as if already gone
 * @returns {Promise<number>}
 */
async function countActiveAdmins(excludingId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS cnt
       FROM employees
      WHERE role = 'ADMIN' AND status = 'active'
        AND ($1::text IS NULL OR id <> $1)`,
    [excludingId || null]
  );
  return Number(rows[0].cnt);
}

// Column list reused across queries so every response has the same fields
const COLS = `id, name, role, department, position, email, phone,
              base_salary, join_date, status`;

// Postgres error codes we translate into friendly HTTP responses
const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

// Index names, so a 409 can name the field that actually clashed. There are now
// two unique constraints on this table and reporting the wrong one sends the
// admin hunting for a duplicate email that does not exist.
const EMAIL_INDEX = 'employees_email_lower_key';
const PHONE_INDEX = 'employees_phone_key';

/**
 * Validates and normalises an incoming phone number.
 *
 * Since phone is the login identity, it must be stored in the same E.164 form
 * that /api/auth/otp/request normalises to. Storing '9876543210' while login
 * looks up '+919876543210' would silently lock the employee out — the account
 * would look fine and simply never receive a code.
 *
 * @param {unknown} value raw request value
 * @returns {{ ok: true, phone: string } | { ok: false, message: string }}
 *          phone is '' when the field was intentionally cleared
 */
function prepPhone(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim();

  // Empty is allowed: an employee record without a number is valid, they just
  // cannot sign in until one is added.
  if (!raw) return { ok: true, phone: '' };

  const normalized = normalizePhone(raw);
  if (!normalized) {
    return {
      ok: false,
      message:
        'Phone must be a valid mobile number. It is used to sign in, so it is ' +
        'stored in international format (e.g. +919876543210).',
    };
  }

  return { ok: true, phone: normalized };
}

/**
 * Maps a unique-violation to the field responsible.
 * @param {Error & { constraint?: string }} err
 * @param {'create'|'update'} mode
 * @returns {string|null}
 */
function duplicateMessage(err, mode) {
  const other = mode === 'create' ? 'An employee' : 'Another employee';

  if (err.constraint === PHONE_INDEX) {
    return `${other} already uses this phone number. Sign-in numbers must be unique.`;
  }
  if (err.constraint === EMAIL_INDEX) {
    return mode === 'create'
      ? 'An employee with this email already exists.'
      : 'Another employee already uses this email.';
  }
  // Unknown constraint — stay vague rather than blame the wrong field.
  return `${other} already uses one of these details.`;
}

// ─── GET all employees ────────────────────────────────────────────────────────
/**
 * By default this returns only active employees, because DELETE now archives
 * anyone with payroll history instead of removing them. Pass
 * ?includeInactive=true to see archived records too.
 */
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';

    // Scoped by role: ADMIN sees the whole organisation, HR sees only the staff
    // it is responsible for. Filtering here rather than in the client means an
    // HR token cannot retrieve an admin's salary by calling the API directly.
    const roles = visibleRolesFor(req.auth.role);

    if (roles.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const conditions = ['role = ANY($1::text[])'];
    if (!includeInactive) conditions.push("status = 'active'");

    const { rows } = await query(
      `SELECT ${COLS} FROM employees
        WHERE ${conditions.join(' AND ')}
        ORDER BY name ASC`,
      [roles]
    );

    res.json({ success: true, data: rows.map(toEmployee) });
  } catch (err) {
    console.error('[employees] GET error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch employees.' });
  }
});

// ─── GET /api/employees/meta/roles ────────────────────────────────────────────
/**
 * Which roles the caller may assign, so the client's role picker can offer
 * exactly those instead of hard-coding the list and getting a 403 on save.
 *
 * Declared before '/:id' so 'meta' is never treated as an employee id.
 */
router.get('/meta/roles', (req, res) => {
  res.json({
    success: true,
    data: {
      assignable: assignableRolesFor(req.auth.role),
      visible: visibleRolesFor(req.auth.role),
    },
  });
});

// ─── GET single employee by ID ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`SELECT ${COLS} FROM employees WHERE id = $1`, [
      req.params.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    res.json({ success: true, data: toEmployee(rows[0]) });
  } catch (err) {
    console.error('[employees] GET/:id error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch employee.' });
  }
});

// ─── POST create employee ─────────────────────────────────────────────────────
router.post('/', CAN_MANAGE_STAFF, async (req, res) => {
  try {
    const { name, role, department, position, email, phone, baseSalary, joinDate } = req.body;

    if (!name || !role || !department || !position || !email || !baseSalary) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, role, department, position, email, baseSalary.',
      });
    }

    if (!VALID_ROLES.includes(normalizeRole(role))) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}.`,
      });
    }

    // ADMIN may create any role; HR may create EMPLOYEE only. Checked here as
    // well as in the client's role picker, because the picker is a convenience
    // and this is the rule.
    if (!canAssignRole(req.auth.role, role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ROLE',
        message:
          `As ${req.auth.role} you can only create ` +
          `${describeRoles(assignableRolesFor(req.auth.role))} accounts.`,
      });
    }

    const salary = parseFloat(baseSalary);
    if (Number.isNaN(salary) || salary <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'baseSalary must be a positive number.' });
    }

    const phoneResult = prepPhone(phone);
    if (!phoneResult.ok) {
      return res.status(400).json({ success: false, message: phoneResult.message });
    }

    // Duplicate email and phone are enforced by their unique indexes rather than
    // a read-then-write check, which two concurrent requests could both pass.
    const { rows } = await query(
      `INSERT INTO employees
         (id, name, role, department, position, email, phone, base_salary, join_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, CURRENT_DATE),'active')
       RETURNING ${COLS}`,
      [
        generateId('emp'),
        String(name).trim(),
        String(role).toUpperCase(),
        String(department).trim(),
        String(position).trim(),
        String(email).toLowerCase().trim(),
        phoneResult.phone,
        salary,
        joinDate || null,
      ]
    );

    res.status(201).json({ success: true, data: toEmployee(rows[0]) });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({
        success: false,
        message: duplicateMessage(err, 'create'),
      });
    }
    if (err.code === PG_CHECK_VIOLATION) {
      return res.status(400).json({
        success: false,
        message: 'One or more fields failed validation. Check role, status and baseSalary.',
      });
    }
    console.error('[employees] POST error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create employee.' });
  }
});

// ─── PUT update employee ──────────────────────────────────────────────────────
router.put('/:id', CAN_MANAGE_STAFF, async (req, res) => {
  try {
    const { name, role, department, position, email, phone, baseSalary, joinDate, status } =
      req.body;

    if (role !== undefined && !VALID_ROLES.includes(normalizeRole(role))) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}.`,
      });
    }

    if (status !== undefined && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be 'active' or 'inactive'.",
      });
    }

    let salary;
    if (baseSalary !== undefined) {
      salary = parseFloat(baseSalary);
      if (Number.isNaN(salary) || salary <= 0) {
        return res
          .status(400)
          .json({ success: false, message: 'baseSalary must be a positive number.' });
      }
    }

    // The target's current state is needed before the write, to answer two
    // questions the UPDATE itself cannot: who is allowed to make this change,
    // and would it leave the system with no administrator.
    const { rows: currentRows } = await query(
      `SELECT id, name, role, status FROM employees WHERE id = $1`,
      [req.params.id]
    );

    if (currentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    const current = currentRows[0];
    const nextRole = role !== undefined ? normalizeRole(role) : current.role;
    const nextStatus = status || current.status;

    // ── May the caller touch this person at all? ─────────────────────────────
    // HR manages EMPLOYEEs only, so an HR user cannot edit or archive an ADMIN
    // or another HR. ADMIN manages everyone.
    if (!canManageRole(req.auth.role, current.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ROLE',
        message:
          `As ${req.auth.role} you can only modify ` +
          `${describeRoles(manageableRolesFor(req.auth.role))} records.`,
      });
    }

    // ── Privilege escalation ────────────────────────────────────────────────
    // `role` is not an ordinary field: writing it grants permissions. Without
    // this check an HR user could PUT their own record with role=ADMIN and
    // immediately gain expense deletion and the financial reports — requireAuth
    // re-reads the role from the database on every request, so their existing
    // token would start working as an admin token with no new sign-in.
    //
    // The comparison is against the CURRENT value rather than rejecting the
    // field outright, because the app's edit form submits the whole employee
    // object; an HR user editing someone's phone number legitimately sends an
    // unchanged `role` along with it.
    if (nextRole !== current.role && !canAssignRole(req.auth.role, nextRole)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ROLE',
        message:
          `As ${req.auth.role} you can only assign ` +
          `${describeRoles(assignableRolesFor(req.auth.role))}.`,
      });
    }

    // ── Last-administrator guard ────────────────────────────────────────────
    const losesAdmin =
      current.role === 'ADMIN' &&
      current.status === 'active' &&
      (nextRole !== 'ADMIN' || nextStatus !== 'active');

    if (losesAdmin && (await countActiveAdmins(current.id)) === 0) {
      return res.status(409).json({
        success: false,
        code: 'LAST_ADMIN',
        message:
          `${current.name} is the only active ADMIN. Promote another employee to ` +
          'ADMIN first, otherwise nobody would be able to manage staff or reports.',
      });
    }

    // Only normalise when the field was actually sent; `null` below means "leave
    // whatever is stored", and an empty string means "clear it".
    let phoneValue = null;
    if (phone !== undefined) {
      const phoneResult = prepPhone(phone);
      if (!phoneResult.ok) {
        return res.status(400).json({ success: false, message: phoneResult.message });
      }
      phoneValue = phoneResult.phone;
    }

    // COALESCE keeps the stored value for any field the client omitted,
    // reproducing the old partial-update behaviour in a single statement.
    const { rows } = await query(
      `UPDATE employees SET
         name        = COALESCE($2, name),
         role        = COALESCE($3, role),
         department  = COALESCE($4, department),
         position    = COALESCE($5, position),
         email       = COALESCE($6, email),
         phone       = COALESCE($7, phone),
         base_salary = COALESCE($8::numeric, base_salary),
         join_date   = COALESCE($9::date, join_date),
         status      = COALESCE($10, status)
       WHERE id = $1
       RETURNING ${COLS}`,
      [
        req.params.id,
        name !== undefined ? String(name).trim() : null,
        role !== undefined ? String(role).toUpperCase() : null,
        department !== undefined ? String(department).trim() : null,
        position !== undefined ? String(position).trim() : null,
        email !== undefined ? String(email).toLowerCase().trim() : null,
        phoneValue,
        salary !== undefined ? salary : null,
        joinDate || null,
        status || null,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    const updated = rows[0];

    // Archiving an employee has to end their access, not just hide them from the
    // list. requireAuth would reject them within one access-token lifetime
    // anyway, but revoking here closes that window and invalidates the refresh
    // token so the device cannot quietly keep renewing.
    if (updated.status !== 'active') {
      const revoked = await revokeAllSessions(updated.id);
      if (revoked > 0) {
        console.log(`[employees] Archived ${updated.id}; revoked ${revoked} session(s).`);
      }
    }

    res.json({ success: true, data: toEmployee(updated) });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res
        .status(409)
        .json({ success: false, message: duplicateMessage(err, 'update') });
    }
    console.error('[employees] PUT error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update employee.' });
  }
});

// ─── DELETE employee ──────────────────────────────────────────────────────────
/**
 * Attendance rows are payroll evidence, so the foreign key is ON DELETE RESTRICT.
 * If an employee has any history we archive them (status = 'inactive') instead
 * of destroying that history. Employees with no history are removed outright,
 * which covers the common "created by mistake" case.
 *
 * Either way the response keeps the old { success, data, message } shape, and
 * archived employees disappear from the default GET list.
 */
router.delete('/:id', CAN_REMOVE_STAFF, async (req, res) => {
  try {
    const { rows: existing } = await query(`SELECT ${COLS} FROM employees WHERE id = $1`, [
      req.params.id,
    ]);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    // Same one-way door as the PUT guard: whether this ends as a delete or an
    // archive, the employee stops being an active admin either way.
    if (
      existing[0].role === 'ADMIN' &&
      existing[0].status === 'active' &&
      (await countActiveAdmins(existing[0].id)) === 0
    ) {
      return res.status(409).json({
        success: false,
        code: 'LAST_ADMIN',
        message:
          `${existing[0].name} is the only active ADMIN. Promote another employee to ` +
          'ADMIN first, otherwise nobody would be able to manage staff or reports.',
      });
    }

    const { rows: counts } = await query(
      `SELECT
         (SELECT COUNT(*) FROM attendance WHERE employee_id = $1) AS attendance_count,
         (SELECT COUNT(*) FROM expenses   WHERE submitted_by = $1) AS expense_count`,
      [req.params.id]
    );

    const attendanceCount = Number(counts[0].attendance_count);
    const expenseCount = Number(counts[0].expense_count);

    if (attendanceCount > 0) {
      const { rows } = await query(
        `UPDATE employees SET status = 'inactive' WHERE id = $1 RETURNING ${COLS}`,
        [req.params.id]
      );

      // Archiving must also end access. An outright DELETE below needs no such
      // step: auth_sessions.employee_id is ON DELETE CASCADE, so the rows go
      // with the employee.
      await revokeAllSessions(req.params.id);

      return res.json({
        success: true,
        data: toEmployee(rows[0]),
        message:
          `${rows[0].name} has ${attendanceCount} attendance record(s), so they were ` +
          `archived instead of deleted to preserve payroll history. ` +
          `They no longer appear in the employee list or salary analytics.`,
      });
    }

    const { rows } = await query(`DELETE FROM employees WHERE id = $1 RETURNING ${COLS}`, [
      req.params.id,
    ]);

    res.json({
      success: true,
      data: toEmployee(rows[0]),
      message:
        expenseCount > 0
          ? `Employee deleted. ${expenseCount} expense record(s) were kept but are now unattributed.`
          : 'Employee deleted successfully.',
    });
  } catch (err) {
    if (err.code === PG_FK_VIOLATION) {
      return res.status(409).json({
        success: false,
        message:
          'This employee has linked records and cannot be deleted. Set status to "inactive" instead.',
      });
    }
    console.error('[employees] DELETE error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete employee.' });
  }
});

module.exports = router;
