/**
 * netlify/functions/report-scheduler.js
 * Netlify Scheduled Function (see the `report-scheduler` entry in
 * netlify.toml). Polls backend/reports/scheduler.js every 5 minutes and fires
 * the daily/monthly WhatsApp report once local time (in REPORT_TIMEZONE)
 * enters the configured window — see scheduler.tick() for why polling
 * replaces the node-cron timers used in the local dev server.
 */

const scheduler = require('../../backend/reports/scheduler');

exports.handler = async () => {
  await scheduler.tick();
  return { statusCode: 200, body: 'ok' };
};
