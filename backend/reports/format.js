/**
 * reports/format.js
 * Renders a report object two ways, because the delivery channel needs both.
 *
 *   text()       Multi-line WhatsApp-flavoured markdown. Used by the console
 *                provider and for free-form sends inside the 24-hour window.
 *
 *   variables()  Flat { '1': …, '2': … } map for a WhatsApp Content Template.
 *                This is the production path: business-initiated messages
 *                outside the 24-hour window must go through an approved
 *                template, and template variables CANNOT contain newlines.
 *                Every value here is therefore a single short scalar.
 *
 * The two must stay in step: if you add a variable, add it to the approved
 * template too, in the same order. TEMPLATE_BODIES below is the exact text to
 * submit for approval, which is why it lives next to the code that fills it.
 */

const CURRENCY = (process.env.REPORT_CURRENCY || '₹').trim();
const BUSINESS_NAME = (process.env.REPORT_BUSINESS_NAME || 'FinTrack').trim();

/**
 * Thousands-separated money, no decimals.
 *
 * Reports are read on a phone screen, where '₹1,23,456' is scannable and
 * '₹123456.78' is not. The cents are still in the stored payload for anyone who
 * needs them.
 *
 * @param {number} amount
 * @returns {string}
 */
function currency(amount) {
  const rounded = Math.round(Number(amount) || 0);
  // en-IN gives lakh/crore grouping, which matches the default ₹ currency.
  return `${CURRENCY}${rounded.toLocaleString('en-IN')}`;
}

/**
 * The exact template bodies to submit to WhatsApp for approval.
 *
 * Kept here so the placeholder numbering cannot drift from the `variables()`
 * functions below. Two WhatsApp rules are respected: a body must not start or
 * end with a variable, and two variables must not sit adjacent.
 */
const TEMPLATE_BODIES = {
  daily:
    'Daily report for {{1}}\n\n' +
    'Attendance: {{2}} of {{3}} marked ({{4}}% rate)\n' +
    'Present {{5}}, half-day {{6}}, absent {{7}}, not marked {{8}}\n\n' +
    'Expenses today: {{9}} across {{10}} entry/entries\n\n' +
    'Month to date ({{11}}): salary {{12}}, expenses {{13}}, total {{14}}\n\n' +
    'Sent automatically by {{15}}.',

  monthly:
    'Monthly report for {{1}}\n\n' +
    'Headcount {{2}}, days logged {{3}}, attendance rate {{4}}%\n' +
    'Present {{5}}, half-day {{6}}, absent {{7}}\n\n' +
    'Salary cost {{8}}\n' +
    'Expenses {{9}} across {{10}} entry/entries, top category {{11}}\n' +
    'Total cost {{12}}\n\n' +
    'Best attendance: {{13}}\n' +
    'Needs attention: {{14}}\n\n' +
    'Sent automatically by {{15}}.',
};

/**
 * Template variables for a daily report.
 * Order and count must match TEMPLATE_BODIES.daily.
 *
 * @param {object} report from buildDailyReport()
 * @returns {Record<string, string>}
 */
function dailyVariables(report) {
  return {
    1: report.dateLabel,
    2: String(report.marked),
    3: String(report.headcount),
    4: String(report.attendanceRate),
    5: String(report.present),
    6: String(report.halfDay),
    7: String(report.absent),
    8: String(report.notMarked),
    9: currency(report.expenseTotal),
    10: String(report.expenseCount),
    11: report.monthLabel,
    12: currency(report.monthToDateSalaryCost),
    13: currency(report.monthToDateExpenseCost),
    14: currency(report.monthToDateTotalCost),
    15: BUSINESS_NAME,
  };
}

/**
 * Template variables for a monthly report.
 * Order and count must match TEMPLATE_BODIES.monthly.
 *
 * @param {object} report from buildMonthlyReport()
 * @returns {Record<string, string>}
 */
function monthlyVariables(report) {
  // Collapsed to one scalar each: a template variable cannot hold a newline, so
  // "name (pct%)" is the most that fits.
  const best = report.bestAttendance
    ? `${report.bestAttendance.name} (${report.bestAttendance.pct}%)`
    : 'no data';
  const worst = report.worstAttendance
    ? `${report.worstAttendance.name} (${report.worstAttendance.pct}%)`
    : 'no data';

  return {
    1: report.monthLabel,
    2: String(report.headcount),
    3: String(report.daysLogged),
    4: String(report.attendanceRate),
    5: String(report.present),
    6: String(report.halfDay),
    7: String(report.absent),
    8: currency(report.salaryCost),
    9: currency(report.expenseCost),
    10: String(report.expenseCount),
    11: report.topExpenseCategory,
    12: currency(report.totalCost),
    13: best,
    14: worst,
    15: BUSINESS_NAME,
  };
}

/**
 * Readable rendering of a daily report.
 * WhatsApp uses *asterisks* for bold.
 *
 * @param {object} report
 * @returns {string}
 */
function dailyText(report) {
  const lines = [
    `*${BUSINESS_NAME} — Daily Report*`,
    report.dateLabel,
    '',
    '*Attendance*',
    `Marked: ${report.marked} of ${report.headcount}  (${report.attendanceRate}% rate)`,
    `Present: ${report.present}   Half-day: ${report.halfDay}   Absent: ${report.absent}`,
  ];

  // Only worth a line when there is something to chase.
  if (report.notMarked > 0) {
    lines.push(`⚠️ Not marked: ${report.notMarked}`);
  }

  lines.push(
    '',
    '*Expenses today*',
    report.expenseCount > 0
      ? `${currency(report.expenseTotal)} across ${report.expenseCount} entry/entries` +
          (report.topExpenseCategory !== '—'
            ? `\nLargest: ${report.topExpenseCategory} (${currency(report.topExpenseCategoryTotal)})`
            : '')
      : 'None logged',
    '',
    `*Month to date — ${report.monthLabel}*`,
    `Salary:   ${currency(report.monthToDateSalaryCost)}`,
    `Expenses: ${currency(report.monthToDateExpenseCost)}`,
    `Total:    ${currency(report.monthToDateTotalCost)}`,
    `(${report.monthDaysLogged} day(s) of attendance logged)`,
    '',
    '_Sent automatically. Reply is not monitored._'
  );

  return lines.join('\n');
}

/**
 * Readable rendering of a monthly report.
 *
 * @param {object} report
 * @returns {string}
 */
function monthlyText(report) {
  const lines = [
    `*${BUSINESS_NAME} — Monthly Report*`,
    report.monthLabel,
    '',
    '*Cost*',
    `Salary:   ${currency(report.salaryCost)}`,
    `Expenses: ${currency(report.expenseCost)}`,
    `Total:    ${currency(report.totalCost)}`,
    '',
    '*Attendance*',
    `Headcount: ${report.headcount}   Days logged: ${report.daysLogged}`,
    `Rate: ${report.attendanceRate}%`,
    `Present: ${report.present}   Half-day: ${report.halfDay}   Absent: ${report.absent}`,
  ];

  if (report.bestAttendance) {
    lines.push('', `Best attendance: ${report.bestAttendance.name} (${report.bestAttendance.pct}%)`);
  }
  if (report.worstAttendance) {
    lines.push(`Needs attention: ${report.worstAttendance.name} (${report.worstAttendance.pct}%)`);
  }

  if (report.expenseCount > 0 && report.topExpenseCategory !== '—') {
    lines.push(
      '',
      '*Expenses*',
      `${report.expenseCount} entry/entries`,
      `Top category: ${report.topExpenseCategory} (${currency(report.topExpenseCategoryTotal)})`
    );
  }

  lines.push('', '_Sent automatically. Reply is not monitored._');

  return lines.join('\n');
}

/**
 * Renders any report to both forms.
 *
 * @param {object} report from buildDailyReport() or buildMonthlyReport()
 * @returns {{ text: string, variables: Record<string, string> }}
 */
function render(report) {
  if (report.type === 'monthly') {
    return { text: monthlyText(report), variables: monthlyVariables(report) };
  }
  return { text: dailyText(report), variables: dailyVariables(report) };
}

module.exports = {
  render,
  currency,
  TEMPLATE_BODIES,
  BUSINESS_NAME,
};
