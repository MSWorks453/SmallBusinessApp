/**
 * reports/scheduler.js
 * The report bot: fires the daily and monthly WhatsApp reports on a schedule.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * Cron expressions are evaluated in REPORT_TIMEZONE, not the host's zone. A
 * small business owner means 8pm local when they say 8pm, and a container almost
 * always runs UTC.
 *
 * ── Catch-up, and why it is not optional ────────────────────────────────────
 * An in-process timer only fires if the process is alive at that instant. Free
 * hosting tiers spin down when idle, deploys restart, and crashes happen — any
 * of which silently skips a day. A report that quietly stops arriving is worse
 * than one that never worked, because nobody notices.
 *
 * So on boot the scheduler asks report_deliveries what it owes, rather than
 * trusting that it was running. It backfills up to CATCH_UP_DAYS of missed daily
 * reports, oldest first, and each is labelled with its own date so a late report
 * is not mistaken for today's.
 *
 * Idempotency lives in reports/deliver.js, keyed per recipient, so catch-up can
 * run freely without risking a duplicate.
 */

const cron = require('node-cron');
const { sendReport, alreadySent } = require('./deliver');
const { today, currentMonth, addDays, addMonths, REPORT_TIMEZONE } = require('../utils/period');

// Default 20:00 daily — after the working day, so attendance is marked.
const DAILY_CRON = (process.env.REPORT_DAILY_CRON || '0 20 * * *').trim();

// Default 09:00 on the 1st, reporting the month that just closed.
const MONTHLY_CRON = (process.env.REPORT_MONTHLY_CRON || '0 9 1 * *').trim();

const ENABLED = process.env.REPORTS_ENABLED !== 'false';

/**
 * How far back to backfill. Bounded on purpose: a report from three weeks ago is
 * noise, and blasting twenty messages after a long outage would look like a bug
 * and burn through WhatsApp message costs.
 */
const CATCH_UP_DAYS = Math.min(Number(process.env.REPORT_CATCH_UP_DAYS || 3), 14);

/** Guard against overlapping runs if a send outlives its interval. */
let running = false;

const tasks = [];

/**
 * Runs one report, swallowing errors.
 *
 * A scheduled job must never throw into the timer: an unhandled rejection here
 * would take down the API process over a failed WhatsApp message. Per-recipient
 * failures are already recorded in report_deliveries.
 *
 * @param {'daily'|'monthly'} type
 * @param {string} [periodKey]
 */
async function runReport(type, periodKey) {
  try {
    const result = await sendReport({ type, periodKey });
    const { sent, skipped, failed } = result;

    if (sent.length === 0 && failed.length === 0 && skipped.length > 0) {
      console.log(`[reports] ${type} ${result.periodKey} already delivered; nothing to do.`);
    } else {
      console.log(
        `[reports] ${type} ${result.periodKey}: ${sent.length} sent, ` +
          `${skipped.length} skipped, ${failed.length} failed.`
      );
    }
  } catch (err) {
    console.error(`[reports] ${type} run failed:`, err.message);
  }
}

/**
 * Backfills reports that should already have gone out.
 *
 * Skips the current day: at boot time the day is usually not over, and sending
 * a partial "daily report" at 6am would be misleading. Today's report is the
 * cron job's business.
 */
async function catchUp() {
  if (running) return;
  running = true;

  try {
    const currentDay = today();

    // Oldest first, so a run of missed days arrives in reading order.
    for (let offset = CATCH_UP_DAYS; offset >= 1; offset--) {
      const date = addDays(currentDay, -offset);
      const delivered = await alreadySent('daily', date);
      if (delivered.size > 0) continue;

      console.log(`[reports] Catching up missed daily report for ${date} ...`);
      await runReport('daily', date);
    }

    // Same idea for the previous month, once we are past the 1st.
    const previousMonth = addMonths(currentMonth(), -1);
    const monthlyDelivered = await alreadySent('monthly', previousMonth);
    if (monthlyDelivered.size === 0 && Number(currentDay.slice(-2)) > 1) {
      console.log(`[reports] Catching up missed monthly report for ${previousMonth} ...`);
      await runReport('monthly', previousMonth);
    }
  } catch (err) {
    console.error('[reports] Catch-up failed:', err.message);
  } finally {
    running = false;
  }
}

/**
 * Registers the cron jobs and kicks off catch-up.
 *
 * @returns {{ stop: () => void }} handle for graceful shutdown
 */
function start() {
  if (!ENABLED) {
    console.log('[reports] Scheduler disabled (REPORTS_ENABLED=false).');
    return { stop: () => {} };
  }

  if (!cron.validate(DAILY_CRON)) {
    console.error(`[reports] REPORT_DAILY_CRON "${DAILY_CRON}" is not a valid cron expression; daily reports are OFF.`);
  } else {
    tasks.push(
      cron.schedule(DAILY_CRON, () => runReport('daily'), { timezone: REPORT_TIMEZONE })
    );
  }

  if (!cron.validate(MONTHLY_CRON)) {
    console.error(`[reports] REPORT_MONTHLY_CRON "${MONTHLY_CRON}" is not a valid cron expression; monthly reports are OFF.`);
  } else {
    tasks.push(
      cron.schedule(
        MONTHLY_CRON,
        // On the 1st, the useful report is the month that just ended.
        () => runReport('monthly', addMonths(currentMonth(), -1)),
        { timezone: REPORT_TIMEZONE }
      )
    );
  }

  console.log(
    `[reports] Scheduler on (${REPORT_TIMEZONE})  daily="${DAILY_CRON}"  monthly="${MONTHLY_CRON}"`
  );

  // Deliberately not awaited: boot must not wait on outbound WhatsApp calls.
  catchUp();

  return {
    stop() {
      for (const task of tasks) {
        try {
          task.stop();
        } catch {
          // Already stopped — nothing to do.
        }
      }
      tasks.length = 0;
    },
  };
}

module.exports = { start, runReport, catchUp, DAILY_CRON, MONTHLY_CRON, ENABLED };
