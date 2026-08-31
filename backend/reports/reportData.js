/**
 * reports/reportData.js
 * Builds the figures for the daily and monthly admin reports.
 *
 * Every number is aggregated in SQL rather than by looping in JS, and the salary
 * formula is deliberately the same one routes/analytics.js uses:
 *
 *   totalDays       = distinct dates in the month having ANY attendance row
 *   attendanceScore = sum of the employee's status weights (Present 1, Half 0.5)
 *   effectiveSalary = attendanceScore / totalDays * baseSalary
 *
 * Keeping it identical matters more than avoiding the duplication: a report that
 * quoted a different salary total from the dashboard for the same month would
 * destroy trust in both. WEIGHT_SQL and the CTE shape below mirror analytics.js
 * exactly; if that formula ever changes, both must change together.
 *
 * Output is plain scalars plus a couple of short lists. That is a constraint from
 * the delivery channel, not a simplification — WhatsApp template variables
 * cannot contain newlines, so the report has to be substitutable values rather
 * than a rendered block of text. See notify/whatsapp.js.
 */

const { query } = require('../db');
const { money } = require('../db/mappers');
const {
  today,
  currentMonth,
  monthRange,
  addDays,
  formatDate,
  formatMonth,
} = require('../utils/period');

// Status → weight. Identical to routes/analytics.js.
const WEIGHT_SQL = `
  CASE a.status
    WHEN 'Present'  THEN 1.0
    WHEN 'Half-Day' THEN 0.5
    ELSE 0.0
  END`;

/**
 * Attendance-weighted salary cost for a month, plus the day count behind it.
 *
 * @param {string} month 'YYYY-MM'
 * @returns {Promise<{ salaryCost: number, daysLogged: number }>}
 */
async function monthlySalaryCost(month) {
  const { start, end } = monthRange(month);

  const { rows } = await query(
    `WITH month_days AS (
       SELECT COUNT(DISTINCT date) AS total_days
       FROM attendance
       WHERE date >= $1::date AND date < $2::date
     ),
     per_employee AS (
       SELECT a.employee_id, SUM(${WEIGHT_SQL}) AS score
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id AND e.status = 'active'
       WHERE a.date >= $1::date AND a.date < $2::date
       GROUP BY 1
     )
     SELECT
       (SELECT total_days FROM month_days) AS days_logged,
       COALESCE(
         ROUND(SUM(pe.score / NULLIF(md.total_days, 0) * e.base_salary), 2),
         0
       ) AS salary_cost
     FROM per_employee pe
     CROSS JOIN month_days md
     JOIN employees e ON e.id = pe.employee_id`,
    [start, end]
  );

  // No attendance at all in the month yields no rows, not a zero row.
  const row = rows[0] || {};
  return {
    salaryCost: money(row.salary_cost),
    daysLogged: Number(row.days_logged || 0),
  };
}

/**
 * Expense totals for a half-open date range.
 *
 * @param {string} start inclusive 'YYYY-MM-DD'
 * @param {string} end exclusive 'YYYY-MM-DD'
 * @returns {Promise<{ count: number, total: number, topCategory: string, topCategoryTotal: number }>}
 */
async function expenseTotals(start, end) {
  const [totals, byCategory] = await Promise.all([
    query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE date >= $1::date AND date < $2::date`,
      [start, end]
    ),
    query(
      `SELECT category, SUM(amount) AS total
       FROM expenses
       WHERE date >= $1::date AND date < $2::date
       GROUP BY category
       ORDER BY total DESC
       LIMIT 1`,
      [start, end]
    ),
  ]);

  return {
    count: Number(totals.rows[0].cnt || 0),
    total: money(totals.rows[0].total),
    topCategory: byCategory.rows[0]?.category || '—',
    topCategoryTotal: byCategory.rows[0] ? money(byCategory.rows[0].total) : 0,
  };
}

/** @returns {Promise<number>} count of active employees */
async function headcount() {
  const { rows } = await query(
    `SELECT COUNT(*) AS cnt FROM employees WHERE status = 'active'`
  );
  return Number(rows[0].cnt || 0);
}

/**
 * The daily report for one calendar date.
 *
 * `notMarked` is the number the admin most often acts on: active employees with
 * no attendance row for the day. It is computed as headcount minus marked-active
 * rather than by a NOT EXISTS scan, and it is why the count of marked employees
 * is joined against `status = 'active'` — an archived employee's historical row
 * must not make the day look complete.
 *
 * @param {string} [date] 'YYYY-MM-DD', defaults to today in REPORT_TIMEZONE
 * @returns {Promise<object>}
 */
async function buildDailyReport(date = today()) {
  const month = date.slice(0, 7);
  const { start: monthStart, end: monthEnd } = monthRange(month);
  const dayEnd = addDays(date, 1);

  const [attendance, dayExpenses, monthExpenses, salary, staff] = await Promise.all([
    query(
      `SELECT
         COUNT(*)                                        AS marked,
         COUNT(*) FILTER (WHERE a.status = 'Present')     AS present,
         COUNT(*) FILTER (WHERE a.status = 'Half-Day')    AS half_day,
         COUNT(*) FILTER (WHERE a.status = 'Absent')      AS absent,
         COALESCE(ROUND(SUM(${WEIGHT_SQL}) / NULLIF(COUNT(*), 0) * 100, 1), 0) AS rate
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id AND e.status = 'active'
       WHERE a.date = $1::date`,
      [date]
    ),
    expenseTotals(date, dayEnd),
    expenseTotals(monthStart, monthEnd),
    monthlySalaryCost(month),
    headcount(),
  ]);

  const row = attendance.rows[0];
  const marked = Number(row.marked || 0);

  return {
    type: 'daily',
    periodKey: date,
    date,
    dateLabel: formatDate(date),
    month,
    monthLabel: formatMonth(month),

    headcount: staff,
    marked,
    notMarked: Math.max(0, staff - marked),
    present: Number(row.present || 0),
    halfDay: Number(row.half_day || 0),
    absent: Number(row.absent || 0),
    attendanceRate: money(row.rate),

    expenseCount: dayExpenses.count,
    expenseTotal: dayExpenses.total,
    topExpenseCategory: dayExpenses.topCategory,
    topExpenseCategoryTotal: dayExpenses.topCategoryTotal,

    // Month-to-date context, so a single day's numbers can be judged against
    // where the month is heading.
    monthToDateSalaryCost: salary.salaryCost,
    monthToDateExpenseCost: monthExpenses.total,
    monthToDateTotalCost: money(salary.salaryCost + monthExpenses.total),
    monthDaysLogged: salary.daysLogged,

    generatedAt: new Date().toISOString(),
  };
}

/**
 * The monthly report for one month.
 *
 * Adds the two per-employee extremes an owner actually asks about — best and
 * worst attendance — which the daily report has no useful equivalent of.
 *
 * @param {string} [month] 'YYYY-MM', defaults to the current month
 * @returns {Promise<object>}
 */
async function buildMonthlyReport(month = currentMonth()) {
  const { start, end } = monthRange(month);

  const [salary, expenses, staff, attendance, extremes] = await Promise.all([
    monthlySalaryCost(month),
    expenseTotals(start, end),
    headcount(),
    query(
      `SELECT
         COUNT(*)                                     AS marked,
         COUNT(*) FILTER (WHERE a.status = 'Present')  AS present,
         COUNT(*) FILTER (WHERE a.status = 'Half-Day') AS half_day,
         COUNT(*) FILTER (WHERE a.status = 'Absent')   AS absent,
         COALESCE(ROUND(SUM(${WEIGHT_SQL}) / NULLIF(COUNT(*), 0) * 100, 1), 0) AS rate
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id AND e.status = 'active'
       WHERE a.date >= $1::date AND a.date < $2::date`,
      [start, end]
    ),
    query(
      `WITH month_days AS (
         SELECT COUNT(DISTINCT date) AS total_days
         FROM attendance
         WHERE date >= $1::date AND date < $2::date
       )
       SELECT e.name,
              ROUND(SUM(${WEIGHT_SQL}) / NULLIF((SELECT total_days FROM month_days), 0) * 100) AS pct
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id AND e.status = 'active'
       WHERE a.date >= $1::date AND a.date < $2::date
       GROUP BY e.id, e.name
       ORDER BY pct DESC, e.name ASC`,
      [start, end]
    ),
  ]);

  const row = attendance.rows[0];
  const ranked = extremes.rows;

  return {
    type: 'monthly',
    periodKey: month,
    month,
    monthLabel: formatMonth(month),

    headcount: staff,
    daysLogged: salary.daysLogged,
    marked: Number(row.marked || 0),
    present: Number(row.present || 0),
    halfDay: Number(row.half_day || 0),
    absent: Number(row.absent || 0),
    attendanceRate: money(row.rate),

    salaryCost: salary.salaryCost,
    expenseCost: expenses.total,
    totalCost: money(salary.salaryCost + expenses.total),
    expenseCount: expenses.count,
    topExpenseCategory: expenses.topCategory,
    topExpenseCategoryTotal: expenses.topCategoryTotal,

    bestAttendance: ranked[0] ? { name: ranked[0].name, pct: Number(ranked[0].pct) } : null,
    worstAttendance:
      ranked.length > 1
        ? {
            name: ranked[ranked.length - 1].name,
            pct: Number(ranked[ranked.length - 1].pct),
          }
        : null,

    generatedAt: new Date().toISOString(),
  };
}

/**
 * Per-employee payroll table for one month — the Reports screen's data.
 *
 * ── Column meanings ─────────────────────────────────────────────────────────
 * daysWorked   Attendance-weighted days: Present counts 1, Half-Day counts 0.5.
 *              This is the figure `payment` is derived from, which is why it is
 *              the one shown rather than a raw count of days present. A month
 *              with 18 present and 4 half days reads as 20 days worked.
 * leaves       Days explicitly marked Absent. Days with no record at all are NOT
 *              counted as leave — they are simply unrecorded, and lumping the two
 *              together would accuse people of absence on days nobody marked.
 * payment      daysWorked / daysLogged * baseSalary.
 *
 * ── Who appears ─────────────────────────────────────────────────────────────
 * Anyone who had joined before the month ended, and is either still active or has
 * attendance that month. That second clause matters for historical months: an
 * employee who has since left was still paid, so removing them would make an old
 * month's total stop reconciling.
 *
 * The formula is deliberately identical to routes/analytics.js and
 * monthlySalaryCost() above — a payroll table that disagreed with the dashboard
 * about the same month would make both untrustworthy.
 *
 * @param {object} params
 * @param {string} [params.month] 'YYYY-MM', defaults to the current month
 * @param {string[]} params.roles roles to include, from the caller's visible scope
 * @returns {Promise<object>}
 */
async function buildEmployeeMonthlyReport({ month = currentMonth(), roles }) {
  const { start, end } = monthRange(month);

  const { rows } = await query(
    `WITH month_days AS (
       SELECT COUNT(DISTINCT date) AS total_days
       FROM attendance
       WHERE date >= $1::date AND date < $2::date
     ),
     per_employee AS (
       SELECT a.employee_id,
              SUM(${WEIGHT_SQL})                            AS score,
              COUNT(*) FILTER (WHERE a.status = 'Present')    AS present_days,
              COUNT(*) FILTER (WHERE a.status = 'Half-Day')   AS half_days,
              COUNT(*) FILTER (WHERE a.status = 'Absent')     AS absent_days,
              COUNT(*)                                       AS marked_days
       FROM attendance a
       WHERE a.date >= $1::date AND a.date < $2::date
       GROUP BY 1
     )
     SELECT e.id, e.name, e.role, e.department, e.position, e.status,
            e.join_date, e.base_salary,
            (SELECT total_days FROM month_days)      AS days_logged,
            COALESCE(pe.score, 0)                    AS score,
            COALESCE(pe.present_days, 0)             AS present_days,
            COALESCE(pe.half_days, 0)                AS half_days,
            COALESCE(pe.absent_days, 0)              AS absent_days,
            COALESCE(pe.marked_days, 0)              AS marked_days,
            CASE WHEN (SELECT total_days FROM month_days) > 0
                 THEN ROUND(COALESCE(pe.score, 0)
                            / (SELECT total_days FROM month_days) * e.base_salary, 2)
                 ELSE 0 END                          AS payment,
            CASE WHEN (SELECT total_days FROM month_days) > 0
                 THEN ROUND(COALESCE(pe.score, 0)
                            / (SELECT total_days FROM month_days) * 100)
                 ELSE 0 END                          AS attendance_percentage
     FROM employees e
     LEFT JOIN per_employee pe ON pe.employee_id = e.id
     WHERE e.role = ANY($3::text[])
       AND e.join_date < $2::date
       AND (e.status = 'active' OR pe.employee_id IS NOT NULL)
     ORDER BY e.name ASC`,
    [start, end, roles]
  );

  const employees = rows.map((row) => ({
    employeeId: row.id,
    name: row.name,
    role: row.role,
    department: row.department,
    position: row.position,
    status: row.status,
    joinDate: row.join_date,
    baseSalary: money(row.base_salary),

    daysLogged: Number(row.days_logged || 0),
    daysWorked: money(row.score),
    presentDays: Number(row.present_days),
    halfDays: Number(row.half_days),
    leaves: Number(row.absent_days),
    markedDays: Number(row.marked_days),
    attendancePercentage: Number(row.attendance_percentage),
    payment: money(row.payment),
  }));

  const totals = employees.reduce(
    (acc, e) => ({
      daysWorked: acc.daysWorked + e.daysWorked,
      leaves: acc.leaves + e.leaves,
      payment: acc.payment + e.payment,
    }),
    { daysWorked: 0, leaves: 0, payment: 0 }
  );

  return {
    month,
    monthLabel: formatMonth(month),
    daysLogged: employees[0]?.daysLogged ?? 0,
    employees,
    totals: {
      headcount: employees.length,
      daysWorked: money(totals.daysWorked),
      leaves: totals.leaves,
      payment: money(totals.payment),
    },
  };
}

/**
 * Months that actually have data, newest first, for the month picker.
 *
 * The current month is always included even when empty, so the picker is never
 * blank on a fresh install and always opens on something meaningful.
 *
 * @returns {Promise<Array<{ month: string, label: string }>>}
 */
async function availableMonths() {
  const { rows } = await query(
    `SELECT to_char(date, 'YYYY-MM') AS month FROM attendance
     UNION
     SELECT to_char(date, 'YYYY-MM') AS month FROM expenses
     ORDER BY month DESC`
  );

  const months = rows.map((r) => r.month);
  const now = currentMonth();
  if (!months.includes(now)) months.unshift(now);

  months.sort((a, b) => b.localeCompare(a));

  return months.map((month) => ({ month, label: formatMonth(month) }));
}

module.exports = {
  buildDailyReport,
  buildMonthlyReport,
  buildEmployeeMonthlyReport,
  availableMonths,
  monthlySalaryCost,
};
