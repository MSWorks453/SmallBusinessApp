/**
 * routes/analytics.js
 * GET /api/analytics/summary
 *
 * Behind requireAuth (see server.js), with no additional role restriction —
 * every role needs it. Admin and HR read the org-wide dashboard from it, and the
 * employee portal reads a single person's payslip out of `employeeBreakdown`.
 *
 * KNOWN GAP: because the payload is org-wide, an authenticated EMPLOYEE can read
 * every colleague's salary by calling this endpoint directly. The app only shows
 * them their own row, but that is a client-side choice, not enforcement. Fixing
 * it properly means scoping the response by req.auth.role — returning only the
 * caller's own breakdown entry for EMPLOYEE — which changes the response shape
 * and so is left as a separate change rather than folded into the auth rework.
 *
 * Returns (shape unchanged from the JSON-file version):
 *  - currentMonth             : 'YYYY-MM'
 *  - currentMonthSalaryCost   : attendance-weighted salary spend, current month
 *  - currentMonthExpenseCost  : general expenses, current month
 *  - currentMonthTotalCost    : the two combined
 *  - employeeBreakdown        : per-employee salary detail for the current month
 *  - trends                   : 6 months of { month, label, salaryCost, expenseCost, totalCost }
 *  - attendanceRates          : last 7 logged days, rate plus per-status counts
 *  - headcount                : { total, active, byRole, joinedThisMonth }
 *  - weeklyExpenses           : last 7 calendar days of spend, zero-filled
 *
 * The previous implementation read all three JSON files and ran nested loops —
 * 6 months x N logged days x M employees, with an Array.find() per cell —
 * recomputing everything on every request. That is a GROUP BY, so it is now
 * four aggregate queries leaning on the attendance(date) index.
 *
 * Salary formula (unchanged from the JSON version):
 *   totalDays       = distinct dates in the month having ANY attendance row
 *   attendanceScore = sum of that employee's status weights for the month
 *                     (Present 1.0, Half-Day 0.5, Absent 0.0; no row = 0)
 *   effectiveSalary = attendanceScore / totalDays * baseSalary
 *
 * The division and rounding happen in SQL on NUMERIC values, so results are
 * exact to the cent instead of relying on float arithmetic.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { money } = require('../db/mappers');
const { today, addDays } = require('../utils/period');

// Status → weight, written once so every query agrees on it.
const WEIGHT_SQL = `
  CASE a.status
    WHEN 'Present'  THEN 1.0
    WHEN 'Half-Day' THEN 0.5
    ELSE 0.0
  END`;

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTHS_IN_WINDOW = 6;

/**
 * The trailing 6 months ending with the current one, as 'YYYY-MM' strings.
 *
 * Derived from the API server's local clock rather than the database's, which
 * matches the old getMonthLabel() behaviour. Managed Postgres instances
 * generally run in UTC, so using CURRENT_DATE would shift the "current month"
 * around month boundaries for anyone not on UTC.
 */
function monthWindow() {
  const now = new Date();
  const months = [];
  for (let offset = -(MONTHS_IN_WINDOW - 1); offset <= 0; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * '2026-08' → 'Aug 26'
 *
 * Built from the string directly rather than via `new Date('2026-08-01')`,
 * which parses as UTC midnight — so toLocaleString() in any negative-offset
 * timezone rendered the *previous* month. The old code mislabelled every point
 * on the trend chart for US-based users.
 */
function monthLabel(month) {
  const [year, mm] = month.split('-');
  return `${MONTH_NAMES[Number(mm) - 1]} ${year.slice(2)}`;
}

/** '2026-08-01' → '8/1' (string math, so no timezone drift) */
function dayLabel(date) {
  const [, mm, dd] = date.split('-');
  return `${Number(mm)}/${Number(dd)}`;
}

/** First day of the month following `month`. '2026-08' → '2026-09-01' */
function nextMonthStart(month) {
  const [year, mm] = month.split('-').map(Number);
  const d = new Date(year, mm, 1); // mm is 1-based, so this is the next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ─── GET /api/analytics/summary ───────────────────────────────────────────────
router.get('/summary', async (_req, res) => {
  try {
    const months = monthWindow();
    const currentMonth = months[months.length - 1];
    const windowStart = `${months[0]}-01`;
    const windowEnd = nextMonthStart(currentMonth); // exclusive upper bound

    // 1. Active roster. Fetched independently of attendance so that employees
    //    with no logged days still appear in the breakdown with zeroes, and so
    //    the expense trend survives when there are no employees at all.
    const employeesQuery = query(
      `SELECT id, name, department, base_salary
       FROM employees
       WHERE status = 'active'
       ORDER BY name ASC`
    );

    // 2. Per-month, per-employee salary detail for employees who have any
    //    attendance in the window. total_days is the month's denominator:
    //    distinct dates with ANY attendance, not filtered by employee status,
    //    matching the old `monthLogs.length`.
    const breakdownQuery = query(
      `WITH month_days AS (
         SELECT to_char(date, 'YYYY-MM') AS month,
                COUNT(DISTINCT date)     AS total_days
         FROM attendance
         WHERE date >= $1::date AND date < $2::date
         GROUP BY 1
       ),
       per_employee AS (
         SELECT to_char(a.date, 'YYYY-MM') AS month,
                a.employee_id,
                SUM(${WEIGHT_SQL})                            AS score,
                COUNT(*) FILTER (WHERE a.status = 'Present')  AS present_days,
                COUNT(*) FILTER (WHERE a.status = 'Half-Day') AS half_days,
                COUNT(*) FILTER (WHERE a.status = 'Absent')   AS absent_days
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id AND e.status = 'active'
         WHERE a.date >= $1::date AND a.date < $2::date
         GROUP BY 1, 2
       )
       SELECT pe.month,
              pe.employee_id,
              pe.present_days,
              pe.half_days,
              pe.absent_days,
              md.total_days,
              ROUND(pe.score / md.total_days * 100)              AS attendance_percentage,
              ROUND(pe.score / md.total_days * e.base_salary, 2) AS effective_salary
       FROM per_employee pe
       JOIN month_days md ON md.month = pe.month
       JOIN employees  e  ON e.id = pe.employee_id`,
      [windowStart, windowEnd]
    );

    // 3. Days-logged per month, needed so employees with no rows in a month
    //    still report the correct totalDaysLogged denominator.
    const monthDaysQuery = query(
      `SELECT to_char(date, 'YYYY-MM') AS month,
              COUNT(DISTINCT date)     AS total_days
       FROM attendance
       WHERE date >= $1::date AND date < $2::date
       GROUP BY 1`,
      [windowStart, windowEnd]
    );

    // 4. Monthly expense totals over the same window.
    const expenseQuery = query(
      `SELECT to_char(date, 'YYYY-MM') AS month,
              ROUND(SUM(amount), 2)    AS total
       FROM expenses
       WHERE date >= $1::date AND date < $2::date
       GROUP BY 1`,
      [windowStart, windowEnd]
    );

    // 5. Attendance rate for the last 7 days that have any data. The
    //    denominator is the number of logs recorded that day, mirroring the old
    //    `dayEntry.logs.length`, so it is deliberately unfiltered by status.
    //
    //    The per-status counts are returned alongside the rate so the dashboard
    //    chart can say what a bar is made of. A rate on its own cannot
    //    distinguish "everyone half-day" from "half the team absent".
    const ratesQuery = query(
      `SELECT a.date,
              ROUND(SUM(${WEIGHT_SQL}) / COUNT(*) * 100, 1)  AS rate,
              COUNT(*)                                       AS marked,
              COUNT(*) FILTER (WHERE a.status = 'Present')    AS present,
              COUNT(*) FILTER (WHERE a.status = 'Half-Day')   AS half_day,
              COUNT(*) FILTER (WHERE a.status = 'Absent')     AS absent
       FROM attendance a
       GROUP BY a.date
       ORDER BY a.date DESC
       LIMIT 7`
    );

    // 6. Headcount, straight from the roster.
    //
    //    Returned by the API rather than counted from the client's employee list
    //    because that list is role-scoped — HR only receives EMPLOYEE records, so
    //    counting it locally would under-report. The dashboard needs the real
    //    organisation size.
    const headcountQuery = query(
      `SELECT
         COUNT(*)                                        AS total,
         COUNT(*) FILTER (WHERE status = 'active')        AS active,
         COUNT(*) FILTER (WHERE status = 'active' AND role = 'ADMIN')    AS admins,
         COUNT(*) FILTER (WHERE status = 'active' AND role = 'HR')       AS hr,
         COUNT(*) FILTER (WHERE status = 'active' AND role = 'EMPLOYEE') AS employees,
         COUNT(*) FILTER (WHERE status = 'active'
                            AND join_date >= date_trunc('month', $1::date)) AS joined_this_month
       FROM employees`,
      [`${currentMonth}-01`]
    );

    // 7. Daily expense totals for the last 7 calendar days.
    //
    //    generate_series zero-fills days with no spend, which matters: a chart
    //    that silently omits empty days would compress the axis and make an
    //    ordinary week look continuously busy.
    const weekStart = addDays(today(), -6);
    const weeklyExpenseQuery = query(
      `SELECT d::date                        AS date,
              COALESCE(ROUND(SUM(e.amount), 2), 0) AS total,
              COUNT(e.id)                    AS entries
       FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS d
       LEFT JOIN expenses e ON e.date = d::date
       GROUP BY d
       ORDER BY d ASC`,
      [weekStart, today()]
    );

    const [
      employeesResult,
      breakdownResult,
      monthDaysResult,
      expenseResult,
      ratesResult,
      headcountResult,
      weeklyExpenseResult,
    ] = await Promise.all([
      employeesQuery,
      breakdownQuery,
      monthDaysQuery,
      expenseQuery,
      ratesQuery,
      headcountQuery,
      weeklyExpenseQuery,
    ]);

    const activeEmployees = employeesResult.rows;

    // Index the aggregates for O(1) lookup while building the grid
    const detailByMonthEmployee = new Map();
    for (const row of breakdownResult.rows) {
      detailByMonthEmployee.set(`${row.month}::${row.employee_id}`, row);
    }
    const totalDaysByMonth = new Map(
      monthDaysResult.rows.map((r) => [r.month, Number(r.total_days)])
    );
    const expenseByMonth = new Map(expenseResult.rows.map((r) => [r.month, money(r.total)]));

    /** Builds the full per-employee breakdown for one month, zero-filling gaps. */
    function breakdownFor(month) {
      const totalDaysLogged = totalDaysByMonth.get(month) ?? 0;

      return activeEmployees.map((emp) => {
        const detail = detailByMonthEmployee.get(`${month}::${emp.id}`);

        return {
          employeeId: emp.id,
          name: emp.name,
          department: emp.department,
          baseSalary: money(emp.base_salary),
          presentDays: detail ? Number(detail.present_days) : 0,
          halfDays: detail ? Number(detail.half_days) : 0,
          absentDays: detail ? Number(detail.absent_days) : 0,
          totalDaysLogged,
          attendancePercentage: detail ? Number(detail.attendance_percentage) : 0,
          effectiveSalary: detail ? money(detail.effective_salary) : 0,
        };
      });
    }

    const trends = months.map((month) => {
      const salaryCost = money(
        breakdownFor(month).reduce((sum, e) => sum + e.effectiveSalary, 0)
      );
      const expenseCost = expenseByMonth.get(month) ?? 0;

      return {
        month,
        label: monthLabel(month),
        salaryCost,
        expenseCost,
        totalCost: money(salaryCost + expenseCost),
      };
    });

    const employeeBreakdown = breakdownFor(currentMonth);
    const currentTrend = trends[trends.length - 1];

    // Oldest-first so the bar chart reads left to right
    const attendanceRates = ratesResult.rows
      .slice()
      .reverse()
      .map((r) => ({
        date: r.date,
        rate: money(r.rate),
        label: dayLabel(r.date),
        marked: Number(r.marked),
        present: Number(r.present),
        halfDay: Number(r.half_day),
        absent: Number(r.absent),
      }));

    const hc = headcountResult.rows[0];
    const headcount = {
      total: Number(hc.total),
      active: Number(hc.active),
      byRole: {
        ADMIN: Number(hc.admins),
        HR: Number(hc.hr),
        EMPLOYEE: Number(hc.employees),
      },
      joinedThisMonth: Number(hc.joined_this_month),
    };

    const weeklyExpenses = weeklyExpenseResult.rows.map((r) => ({
      date: r.date,
      label: dayLabel(r.date),
      total: money(r.total),
      entries: Number(r.entries),
    }));

    res.json({
      success: true,
      data: {
        currentMonth,
        currentMonthSalaryCost: currentTrend.salaryCost,
        currentMonthExpenseCost: currentTrend.expenseCost,
        currentMonthTotalCost: currentTrend.totalCost,
        employeeBreakdown,
        trends,
        attendanceRates,

        // Added for the dashboard. Purely additive — existing consumers of this
        // endpoint are unaffected.
        headcount,
        weeklyExpenses,
      },
    });
  } catch (err) {
    console.error('[analytics] GET /summary error:', err.message);
    res
      .status(500)
      .json({ success: false, message: 'Failed to compute analytics summary.' });
  }
});

module.exports = router;
