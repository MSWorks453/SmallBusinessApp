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

/**
 * Pulls the minute/hour (and, for the monthly job, day-of-month) out of a
 * simple cron string. Only literal values are supported in those fields — no
 * ranges, steps or lists — which matches both documented defaults
 * ("0 20 * * *", "0 9 1 * *") and every value a business owner would
 * realistically set for a single daily/monthly firing time.
 *
 * @param {string} cronExpr
 * @returns {{ minute: number, hour: number, dayOfMonth: number|null }|null}
 */
function parseFixedTime(cronExpr) {
  const parts = String(cronExpr).trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, dom] = parts;
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;

  return {
    minute: Number(minute),
    hour: Number(hour),
    dayOfMonth: /^\d{1,2}$/.test(dom) ? Number(dom) : null,
  };
}

/**
 * How wide a window (in minutes) counts as "on time" for a `tick()` check.
 * Must be >= the interval the caller polls at (see netlify/functions/
 * report-scheduler.js, which polls every 5 minutes), or a target time could
 * fall between two ticks and be missed entirely for the day.
 */
const TICK_WINDOW_MINUTES = 5;

/**
 * Serverless-friendly alternative to `start()`.
 *
 * There is no process alive between requests in a Netlify Function, so the
 * `node-cron` timers registered by `start()` never fire there. Instead,
 * netlify/functions/report-scheduler.js polls this on a short interval (a
 * Netlify Scheduled Function), and `tick()` runs the daily/monthly job itself
 * once local time in REPORT_TIMEZONE enters its target window.
 *
 * Firing more than once inside that window is harmless: `sendReport()` is
 * idempotent per recipient/period (see reports/deliver.js).
 *
 * @param {Date} [now]
 */
async function tick(now = new Date()) {
  if (!ENABLED) return;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const localHour = Number(parts.find((p) => p.type === 'hour').value);
  const localMinute = Number(parts.find((p) => p.type === 'minute').value);
  const minutesOfDay = localHour * 60 + localMinute;
  const dayOfMonth = Number(today(now).slice(-2));

  const daily = parseFixedTime(DAILY_CRON);
  if (daily) {
    const target = daily.hour * 60 + daily.minute;
    if (minutesOfDay >= target && minutesOfDay < target + TICK_WINDOW_MINUTES) {
      await runReport('daily');
      await catchUp();
    }
  } else {
    console.error(`[reports] REPORT_DAILY_CRON "${DAILY_CRON}" is not a fixed minute/hour; tick() cannot schedule it.`);
  }

  const monthly = parseFixedTime(MONTHLY_CRON);
  if (monthly) {
    const target = monthly.hour * 60 + monthly.minute;
    const dayMatches = monthly.dayOfMonth === null || dayOfMonth === monthly.dayOfMonth;
    if (dayMatches && minutesOfDay >= target && minutesOfDay < target + TICK_WINDOW_MINUTES) {
      await runReport('monthly', addMonths(currentMonth(now), -1));
    }
  } else {
    console.error(`[reports] REPORT_MONTHLY_CRON "${MONTHLY_CRON}" is not a fixed minute/hour; tick() cannot schedule it.`);
  }
}

module.exports = { start, tick, runReport, catchUp, DAILY_CRON, MONTHLY_CRON, ENABLED };
