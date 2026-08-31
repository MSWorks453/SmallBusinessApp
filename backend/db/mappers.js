/**
 * db/mappers.js
 * Translates snake_case database rows into the exact camelCase JSON shapes the
 * Expo client already consumes, so no frontend change is needed.
 *
 * Two conversions matter:
 *  - NUMERIC arrives from node-postgres as a *string* (to protect precision).
 *    The old API sent numbers, so every money field is coerced here.
 *  - DATE arrives as a 'YYYY-MM-DD' string thanks to the type parser in
 *    db/index.js, matching the legacy format directly.
 */

/** NUMERIC (string) → JS number, rounded to 2dp for money. */
function money(value) {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** TIMESTAMPTZ (Date) → ISO string, matching the old `new Date().toISOString()`. */
function timestamp(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * employees row → legacy employee object.
 * Field set is kept identical to the JSON era: no extra keys.
 */
function toEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    department: row.department,
    position: row.position,
    email: row.email,
    phone: row.phone,
    baseSalary: money(row.base_salary),
    joinDate: row.join_date,
    status: row.status,
  };
}

/** expenses row → legacy expense object. */
function toExpense(row) {
  return {
    id: row.id,
    date: row.date,
    amount: money(row.amount),
    category: row.category,
    description: row.description,
    submittedBy: row.submitted_by ?? null,
    createdAt: timestamp(row.created_at),
  };
}

/**
 * Builds the legacy day-level attendance id from a date.
 * '2026-08-01' → 'att_20260801'
 */
function attendanceDayId(date) {
  return `att_${String(date).replace(/-/g, '')}`;
}

/**
 * Collapses flat attendance rows back into the nested day documents the
 * frontend expects:
 *   [{ id: 'att_20260801', date: '2026-08-01', logs: [{ employeeId, status }] }]
 *
 * Input rows must be ordered by date; output preserves the order in which
 * dates are first encountered.
 *
 * @param {Array<{employee_id: string, date: string, status: string}>} rows
 */
function toAttendanceDays(rows) {
  const byDate = new Map();

  for (const row of rows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, {
        id: attendanceDayId(row.date),
        date: row.date,
        logs: [],
      });
    }
    byDate.get(row.date).logs.push({
      employeeId: row.employee_id,
      status: row.status,
    });
  }

  return Array.from(byDate.values());
}

module.exports = {
  money,
  timestamp,
  toEmployee,
  toExpense,
  toAttendanceDays,
  attendanceDayId,
};
