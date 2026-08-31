/**
 * auth/roles.js
 * The role hierarchy, in one place.
 *
 * Attendance is delegated one level down the chain:
 *
 *   ADMIN  marks attendance for  HR
 *   HR     marks attendance for  EMPLOYEE
 *
 * ── Three separate scopes, deliberately ─────────────────────────────────────
 * It is tempting to collapse these into a single "what can this role touch"
 * list, but they genuinely differ, and the difference is the whole point:
 *
 *   VISIBLE      Who appears in the staff directory. ADMIN sees everyone.
 *   ATTENDANCE   Whose attendance may be marked. ADMIN marks HR only.
 *   ASSIGNABLE   Which roles may be created or assigned. ADMIN may assign any.
 *
 * So an ADMIN sees an EMPLOYEE in the directory but cannot mark their
 * attendance — that is HR's job. Merging VISIBLE and ATTENDANCE would break one
 * requirement or the other.
 *
 * ── Consequences worth knowing ──────────────────────────────────────────────
 * Nobody marks attendance for an ADMIN. Since analytics and the reports compute
 * salary as score/totalDays * baseSalary and an employee with no attendance rows
 * contributes zero, ADMIN salaries never reach the payroll cost figures. That is
 * usually right for an owner, and wrong for a salaried admin — see the note in
 * ATTENDANCE_SCOPE below if that needs to change.
 */

const ROLES = {
  ADMIN: 'ADMIN',
  HR: 'HR',
  EMPLOYEE: 'EMPLOYEE',
};

/** Every role, in descending authority. Also the DB CHECK constraint's set. */
const ALL_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.EMPLOYEE];

/**
 * Whose attendance each role may mark.
 *
 * To let admins also record each other (and themselves), add 'ADMIN' to the
 * ADMIN list. Nothing else needs to change — the roster endpoint and the write
 * guard both read from here.
 */
const ATTENDANCE_SCOPE = {
  [ROLES.ADMIN]: [ROLES.HR],
  [ROLES.HR]: [ROLES.EMPLOYEE],
  [ROLES.EMPLOYEE]: [],
};

/** Which roles each role may create, or assign when editing. */
const ASSIGNABLE_ROLES = {
  [ROLES.ADMIN]: [ROLES.ADMIN, ROLES.HR, ROLES.EMPLOYEE],
  [ROLES.HR]: [ROLES.EMPLOYEE],
  [ROLES.EMPLOYEE]: [],
};

/**
 * Which roles appear in each role's staff directory.
 *
 * ADMIN sees the whole organisation. HR sees the staff it is responsible for,
 * which is also exactly the set it may edit — so the directory never shows HR a
 * record that would reject their changes.
 *
 * EMPLOYEE is unscoped for now and still receives the full list. That is a known
 * gap, not a decision: employees have no Staff tab, but the endpoint is reachable
 * with their token and exposes colleagues' salaries. Tightening it to self-only
 * touches the dashboard headcount and the portal lookup, so it is left as a
 * separate change.
 */
const VISIBLE_ROLES = {
  [ROLES.ADMIN]: [ROLES.ADMIN, ROLES.HR, ROLES.EMPLOYEE],
  [ROLES.HR]: [ROLES.EMPLOYEE],
  [ROLES.EMPLOYEE]: ALL_ROLES,
};

/** Roles that may be modified at all, by role. Mirrors ASSIGNABLE_ROLES. */
const MANAGEABLE_ROLES = {
  [ROLES.ADMIN]: [ROLES.ADMIN, ROLES.HR, ROLES.EMPLOYEE],
  [ROLES.HR]: [ROLES.EMPLOYEE],
  [ROLES.EMPLOYEE]: [],
};

/** @param {string} role @returns {string} normalised, e.g. 'hr' → 'HR' */
function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

/**
 * @param {string} callerRole
 * @returns {string[]} roles whose attendance the caller may mark
 */
function attendanceRolesFor(callerRole) {
  return ATTENDANCE_SCOPE[normalizeRole(callerRole)] || [];
}

/**
 * @param {string} callerRole
 * @returns {string[]} roles the caller may see in the directory
 */
function visibleRolesFor(callerRole) {
  return VISIBLE_ROLES[normalizeRole(callerRole)] || [];
}

/**
 * @param {string} callerRole
 * @returns {string[]} roles the caller may create or assign
 */
function assignableRolesFor(callerRole) {
  return ASSIGNABLE_ROLES[normalizeRole(callerRole)] || [];
}

/**
 * @param {string} callerRole
 * @returns {string[]} roles of employees the caller may edit
 */
function manageableRolesFor(callerRole) {
  return MANAGEABLE_ROLES[normalizeRole(callerRole)] || [];
}

/**
 * @param {string} callerRole
 * @param {string} targetRole
 * @returns {boolean}
 */
function canMarkAttendanceFor(callerRole, targetRole) {
  return attendanceRolesFor(callerRole).includes(normalizeRole(targetRole));
}

/**
 * @param {string} callerRole
 * @param {string} targetRole
 * @returns {boolean}
 */
function canAssignRole(callerRole, targetRole) {
  return assignableRolesFor(callerRole).includes(normalizeRole(targetRole));
}

/**
 * @param {string} callerRole
 * @param {string} targetRole
 * @returns {boolean}
 */
function canManageRole(callerRole, targetRole) {
  return manageableRolesFor(callerRole).includes(normalizeRole(targetRole));
}

/** Human-readable list for error messages: ['A','B'] → 'A and B'. */
function describeRoles(roles) {
  if (roles.length === 0) return 'nobody';
  if (roles.length === 1) return roles[0];
  return `${roles.slice(0, -1).join(', ')} and ${roles[roles.length - 1]}`;
}

module.exports = {
  ROLES,
  ALL_ROLES,
  ATTENDANCE_SCOPE,
  ASSIGNABLE_ROLES,
  VISIBLE_ROLES,
  MANAGEABLE_ROLES,
  normalizeRole,
  attendanceRolesFor,
  visibleRolesFor,
  assignableRolesFor,
  manageableRolesFor,
  canMarkAttendanceFor,
  canAssignRole,
  canManageRole,
  describeRoles,
};
