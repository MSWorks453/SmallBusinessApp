/**
 * utils/period.js
 * Timezone-correct date arithmetic for the business's calendar.
 *
 * Started life in reports/ for the scheduler, and moved here once attendance
 * needed the same notion of "today" — the rule that attendance may only be
 * recorded for the current or a past date is meaningless without one.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * "Today" is not a property of the server. A report scheduled for 20:00
 * Asia/Kolkata runs at 14:30 UTC, and `new Date().toISOString().slice(0,10)` on
 * a UTC host would name the right day only by luck — around midnight in the
 * target zone it names the wrong one outright. The same trap applies to an
 * attendance screen deciding whether "tomorrow" is in the future.
 *
 * Everything here derives calendar dates via Intl with an explicit timeZone, so
 * the answer matches the business's day regardless of where the process runs.
 * The database is left out of it: attendance.date and expenses.date are DATE
 * columns holding the business's calendar day already.
 */

const REPORT_TIMEZONE = (process.env.REPORT_TIMEZONE || 'Asia/Kolkata').trim();

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Calendar date in the report timezone as 'YYYY-MM-DD'.
 *
 * 'en-CA' is used because its short date format is already ISO-ordered, which
 * avoids parsing a localised string back apart.
 *
 * @param {Date} [at] instant to resolve; defaults to now
 * @returns {string}
 */
function today(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Current month in the report timezone as 'YYYY-MM'.
 * @param {Date} [at]
 * @returns {string}
 */
function currentMonth(at = new Date()) {
  return today(at).slice(0, 7);
}

/**
 * Shifts a 'YYYY-MM-DD' string by whole days.
 *
 * Uses Date.UTC so the arithmetic happens on a fixed 24-hour grid with no DST
 * shifts — safe because the input and output are plain calendar labels, not
 * instants.
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {number} days may be negative
 * @returns {string} 'YYYY-MM-DD'
 */
function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Shifts a 'YYYY-MM' string by whole months.
 * @param {string} month 'YYYY-MM'
 * @param {number} months may be negative
 * @returns {string} 'YYYY-MM'
 */
function addMonths(month, months) {
  const [y, m] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + months, 1));
  return shifted.toISOString().slice(0, 7);
}

/**
 * Half-open date range covering a month, for `date >= start AND date < end`.
 *
 * Half-open rather than BETWEEN so month length and leap years never need
 * special-casing.
 *
 * @param {string} month 'YYYY-MM'
 * @returns {{ start: string, end: string }}
 */
function monthRange(month) {
  return { start: `${month}-01`, end: `${addMonths(month, 1)}-01` };
}

/**
 * '2026-08-29' → 'Sat, 29 Aug 2026'
 * Built from the string so no timezone is involved.
 *
 * @param {string} date 'YYYY-MM-DD'
 * @returns {string}
 */
function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));

  return `${weekday}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * '2026-08' → 'August 2026'
 * @param {string} month 'YYYY-MM'
 * @returns {string}
 */
function formatMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const full = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
  }).format(new Date(Date.UTC(y, m - 1, 1)));

  return `${full} ${y}`;
}

/** @param {string} value @returns {boolean} */
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  // Rejects '2026-02-31': round-tripping a real date is lossless.
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.toISOString().slice(0, 10) === value;
}

/** @param {string} value @returns {boolean} */
function isValidMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value))) return false;
  const month = Number(value.split('-')[1]);
  return month >= 1 && month <= 12;
}

module.exports = {
  REPORT_TIMEZONE,
  today,
  currentMonth,
  addDays,
  addMonths,
  monthRange,
  formatDate,
  formatMonth,
  isValidDate,
  isValidMonth,
};
