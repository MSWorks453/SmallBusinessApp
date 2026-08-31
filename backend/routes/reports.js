/**
 * routes/reports.js
 * GET  /api/reports/employees        – per-employee payroll table by month [ADMIN, HR]
 * GET  /api/reports/daily            – preview today's (or ?date=) report   [ADMIN]
 * GET  /api/reports/monthly          – preview this month's (or ?month=)    [ADMIN]
 * POST /api/reports/daily/send       – send it now                          [ADMIN]
 * POST /api/reports/monthly/send     – send it now                          [ADMIN]
 * GET  /api/reports/recipients       – who would receive it                 [ADMIN]
 * GET  /api/reports/deliveries       – recent delivery audit log            [ADMIN]
 * GET  /api/reports/templates        – template bodies to submit for approval [ADMIN]
 *
 * Behind requireAuth (see server.js) and ADMIN-only: these expose org-wide
 * salary totals and can spend money on outbound WhatsApp messages.
 *
 * The preview endpoints exist so the schedule is not the only way to see a
 * report. Waiting until 8pm to discover a formatting mistake, or that WhatsApp
 * rejected the template, is a bad development loop.
 */

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/requireAuth');
const {
  buildDailyReport,
  buildMonthlyReport,
  buildEmployeeMonthlyReport,
  availableMonths,
} = require('../reports/reportData');
const { visibleRolesFor } = require('../auth/roles');
const { render, TEMPLATE_BODIES } = require('../reports/format');
const { sendReport, resolveRecipients, recentDeliveries } = require('../reports/deliver');
const { isValidDate, isValidMonth, REPORT_TIMEZONE } = require('../utils/period');
const {
  providerName: whatsappProvider,
  messageMode,
  isDevProvider,
} = require('../notify/whatsapp');
const { DAILY_CRON, MONTHLY_CRON, ENABLED } = require('../reports/scheduler');
const { maskPhone } = require('../utils/phone');

// Most of this router is org-wide financials or can spend money sending
// WhatsApp messages, so it is ADMIN-only.
//
// The guard is applied per route rather than with a blanket router.use(), so each
// route's audience is visible at the route itself. The employee payroll table is
// the one exception: HR may read it, scoped to the staff they manage.
const ADMIN_ONLY = requireRole('ADMIN');
const ADMIN_OR_HR = requireRole('ADMIN', 'HR');

// ─── GET /api/reports/daily ───────────────────────────────────────────────────
router.get('/daily', ADMIN_ONLY, async (req, res) => {
  try {
    const date = req.query.date;
    if (date !== undefined && !isValidDate(date)) {
      return res.status(400).json({
        success: false,
        message: 'date must be a real calendar date in YYYY-MM-DD form.',
      });
    }

    const report = await buildDailyReport(date);
    const rendered = render(report);

    res.json({ success: true, data: { report, ...rendered } });
  } catch (err) {
    console.error('[reports] GET /daily error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build the daily report.' });
  }
});

// ─── GET /api/reports/monthly ─────────────────────────────────────────────────
router.get('/monthly', ADMIN_ONLY, async (req, res) => {
  try {
    const month = req.query.month;
    if (month !== undefined && !isValidMonth(month)) {
      return res
        .status(400)
        .json({ success: false, message: 'month must be in YYYY-MM form.' });
    }

    const report = await buildMonthlyReport(month);
    const rendered = render(report);

    res.json({ success: true, data: { report, ...rendered } });
  } catch (err) {
    console.error('[reports] GET /monthly error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build the monthly report.' });
  }
});

/**
 * Shared handler for the two send endpoints.
 *
 * `force` is opt-in because the default must stay idempotent: a double-tapped
 * "Send now" button should not deliver twice.
 *
 * @param {'daily'|'monthly'} type
 * @returns {import('express').RequestHandler}
 */
function sendHandler(type) {
  return async (req, res) => {
    try {
      const periodKey = type === 'monthly' ? req.body?.month : req.body?.date;

      if (periodKey !== undefined) {
        const valid = type === 'monthly' ? isValidMonth(periodKey) : isValidDate(periodKey);
        if (!valid) {
          return res.status(400).json({
            success: false,
            message:
              type === 'monthly'
                ? 'month must be in YYYY-MM form.'
                : 'date must be a real calendar date in YYYY-MM-DD form.',
          });
        }
      }

      const result = await sendReport({
        type,
        periodKey,
        force: req.body?.force === true,
      });

      // 207-ish situation, but the report did get built and partially delivered;
      // reporting the per-recipient breakdown is more useful than one status.
      res.json({
        success: true,
        message:
          `${result.sent.length} sent, ${result.skipped.length} skipped, ` +
          `${result.failed.length} failed.`,
        data: {
          type: result.type,
          periodKey: result.periodKey,
          sent: result.sent.map((r) => ({ name: r.name, phone: maskPhone(r.phone), mode: r.mode })),
          skipped: result.skipped.map((r) => ({
            name: r.name,
            phone: maskPhone(r.phone),
            reason: r.reason,
          })),
          failed: result.failed.map((r) => ({
            name: r.name,
            phone: maskPhone(r.phone),
            error: r.error,
          })),
        },
      });
    } catch (err) {
      console.error(`[reports] POST /${type}/send error:`, err.message);
      res.status(500).json({ success: false, message: `Failed to send the ${type} report.` });
    }
  };
}

router.post('/daily/send', ADMIN_ONLY, sendHandler('daily'));
router.post('/monthly/send', ADMIN_ONLY, sendHandler('monthly'));

// ─── GET /api/reports/employees ────────────────────────────────────────────────
/**
 * Per-employee payroll table for one month, plus the list of months worth
 * selecting. Powers the Reports screen.
 *
 * ADMIN and HR, with rows scoped by the same visibility rule as the staff
 * directory: ADMIN sees the whole organisation, HR sees only the staff it
 * manages. Reusing that rule rather than inventing a second one means HR cannot
 * read an admin's pay here after being denied it under Staff.
 *
 * `availableMonths` ships in the same response so the picker needs no second
 * round trip and can never offer a month the report cannot render.
 */
router.get('/employees', ADMIN_OR_HR, async (req, res) => {
  try {
    const month = req.query.month;

    if (month !== undefined && !isValidMonth(month)) {
      return res
        .status(400)
        .json({ success: false, message: 'month must be in YYYY-MM form.' });
    }

    const roles = visibleRolesFor(req.auth.role);

    const [report, months] = await Promise.all([
      buildEmployeeMonthlyReport({ month, roles }),
      availableMonths(),
    ]);

    res.json({
      success: true,
      data: {
        ...report,
        availableMonths: months,
        // Echoed so the screen can label the table honestly rather than implying
        // it covers everyone.
        scopedToRoles: roles,
      },
    });
  } catch (err) {
    console.error('[reports] GET /employees error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build the employee report.' });
  }
});

// ─── GET /api/reports/recipients ───────────────────────────────────────────────
/**
 * Answers "who is actually getting these?" — the usual cause of a report that
 * appears to work but reaches nobody is an ADMIN with no phone number on record.
 */
router.get('/recipients', ADMIN_ONLY, async (_req, res) => {
  try {
    const recipients = await resolveRecipients();

    res.json({
      success: true,
      data: {
        recipients: recipients.map((r) => ({
          name: r.name,
          phone: maskPhone(r.phone),
          source: r.source,
        })),
        schedule: {
          enabled: ENABLED,
          timezone: REPORT_TIMEZONE,
          daily: DAILY_CRON,
          monthly: MONTHLY_CRON,
        },
        channel: {
          provider: whatsappProvider,
          messageMode,
          // The single most common surprise: nothing is really being delivered.
          deliversForReal: !isDevProvider,
        },
      },
    });
  } catch (err) {
    console.error('[reports] GET /recipients error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to resolve recipients.' });
  }
});

// ─── GET /api/reports/deliveries ───────────────────────────────────────────────
router.get('/deliveries', ADMIN_ONLY, async (req, res) => {
  try {
    const data = await recentDeliveries(req.query.limit);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[reports] GET /deliveries error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch delivery history.' });
  }
});

// ─── GET /api/reports/templates ────────────────────────────────────────────────
/**
 * The exact bodies to paste into Twilio's Content Template Builder for WhatsApp
 * approval, with a sample filled in from real current data so the submission can
 * include the sample values WhatsApp asks for.
 */
router.get('/templates', ADMIN_ONLY, async (_req, res) => {
  try {
    const [daily, monthly] = await Promise.all([buildDailyReport(), buildMonthlyReport()]);

    res.json({
      success: true,
      data: {
        note:
          'Submit these bodies as WhatsApp Content Templates, then put the ' +
          'resulting Content SIDs in WHATSAPP_DAILY_CONTENT_SID and ' +
          'WHATSAPP_MONTHLY_CONTENT_SID. Business-initiated WhatsApp messages ' +
          'outside the 24-hour window are rejected without an approved template.',
        daily: {
          body: TEMPLATE_BODIES.daily,
          sampleVariables: render(daily).variables,
        },
        monthly: {
          body: TEMPLATE_BODIES.monthly,
          sampleVariables: render(monthly).variables,
        },
      },
    });
  } catch (err) {
    console.error('[reports] GET /templates error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build template samples.' });
  }
});

module.exports = router;
