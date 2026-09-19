/**
 * server.js
 * Local/dev entry point for the Small Business App API.
 * Listens on PORT 4000 by default.
 *
 * The Express app itself lives in app.js so the exact same routes and
 * middleware can be mounted inside a Netlify Function (see
 * netlify/functions/api.js) without also running .listen(), the cron report
 * scheduler, or the shutdown handlers below — none of which make sense inside
 * a serverless invocation.
 */

const app = require('./app');

const { healthCheck, close: closeDb } = require('./db');
const { assertSecret } = require('./auth/tokens');
const { providerName: smsProvider } = require('./auth/sms');
const { pruneExpiredCodes } = require('./auth/otp');
const { pruneExpiredSessions } = require('./auth/sessions');
const reportScheduler = require('./reports/scheduler');
const { providerName: whatsappProvider, messageMode } = require('./notify/whatsapp');
const { REPORT_TIMEZONE } = require('./utils/period');

const PORT = process.env.PORT || 4000;

// ── Start ──────────────────────────────────────────────────────────────────────
// Fail before binding the port rather than at the first login attempt. A server
// that accepts requests but cannot sign a token is worse than one that refuses
// to start, because the failure surfaces as an opaque 500 to the user.
try {
  assertSecret();
} catch (err) {
  console.error(`\n[server] Cannot start: ${err.message}\n`);
  process.exit(1);
}

/** Set once the report scheduler starts, so shutdown can stop its cron jobs. */
let reportSchedulerHandle = null;

const server = app.listen(PORT, async () => {
  console.log(`\n🚀  Small Business API is running`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    Health:  http://localhost:${PORT}/api/health`);
  console.log(`    Auth:    SMS OTP  (SMS_PROVIDER=${smsProvider})`);

  if (smsProvider === 'console') {
    console.log(
      `             ↳ dev mode: codes are printed here and returned by the API,\n` +
        `               no SMS is sent. Set SMS_PROVIDER=twilio to deliver for real.`
    );
  }

  console.log(
    `    Reports: WhatsApp (WHATSAPP_PROVIDER=${whatsappProvider}, ` +
      `mode=${messageMode}, tz=${REPORT_TIMEZONE})`
  );

  // Report DB status at boot so a bad DATABASE_URL is obvious immediately
  // rather than surfacing as a 500 on the first request.
  const db = await healthCheck();
  if (db.connected) {
    console.log(`    DB:      connected (server time ${db.serverTime})\n`);
  } else {
    console.error(`    DB:      NOT CONNECTED — ${db.error}`);
    console.error(`             Check DATABASE_URL in backend/.env\n`);
  }

  // Started after the DB check so a misconfigured database surfaces as one clear
  // boot error rather than as a failed report job.
  if (db.connected) {
    reportSchedulerHandle = reportScheduler.start();
  } else {
    console.error('[reports] Scheduler not started: no database connection.\n');
  }
});

// ── Auth housekeeping ─────────────────────────────────────────────────────────
// Spent OTP rows and dead sessions accumulate forever otherwise. Both tables are
// on the login hot path, so this keeps them small. unref() so the timer never
// holds the process open during shutdown.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function runAuthCleanup() {
  try {
    const [codes, sessions] = await Promise.all([
      pruneExpiredCodes(),
      pruneExpiredSessions(),
    ]);
    if (codes > 0 || sessions > 0) {
      console.log(`[auth] Cleanup removed ${codes} OTP row(s), ${sessions} session(s).`);
    }
  } catch (err) {
    console.error('[auth] Cleanup failed:', err.message);
  }
}

const cleanupTimer = setInterval(runAuthCleanup, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Close the HTTP listener and drain the connection pool so nodemon restarts and
// container stops do not leave sockets open against the database.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} received, shutting down ...`);

  clearInterval(cleanupTimer);
  reportSchedulerHandle?.stop();

  server.close(async () => {
    try {
      await closeDb();
      console.log('[server] Database pool closed. Bye.');
    } catch (err) {
      console.error('[server] Error closing pool:', err.message);
    }
    process.exit(0);
  });

  // Do not hang forever on lingering keep-alive connections
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
