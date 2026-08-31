/**
 * server.js
 * Express entry point for the Small Business App API.
 * Listens on PORT 4000 by default.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const { healthCheck, close: closeDb } = require('./db');
const { requireAuth } = require('./middleware/requireAuth');
const { assertSecret } = require('./auth/tokens');
const { providerName: smsProvider } = require('./auth/sms');
const { pruneExpiredCodes } = require('./auth/otp');
const { pruneExpiredSessions } = require('./auth/sessions');
const reportScheduler = require('./reports/scheduler');
const { providerName: whatsappProvider, messageMode } = require('./notify/whatsapp');
const { REPORT_TIMEZONE } = require('./utils/period');

// ── Route imports ──────────────────────────────────────────────────────────────
const authRouter = require('./routes/auth');
const employeesRouter = require('./routes/employees');
const attendanceRouter = require('./routes/attendance');
const expensesRouter = require('./routes/expenses');
const analyticsRouter = require('./routes/analytics');
const reportsRouter = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ─────────────────────────────────────────────────────────────────

// Origins are read from CORS_ORIGINS (comma-separated) when set, and default to
// '*' otherwise so Expo Go on a LAN IP still works during development.
//
// '*' is acceptable here only because credentials travel in an Authorization
// header rather than a cookie: there is no ambient credential for a hostile page
// to ride on, since it would have to read the token out of the device's secure
// storage first. Set CORS_ORIGINS in production regardless.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Trust X-Forwarded-For so clientIp() in the auth routes records the real client
// behind a proxy rather than the proxy itself.
app.set('trust proxy', true);

// Parse JSON bodies (up to 1 MB)
app.use(express.json({ limit: '1mb' }));

// Parse URL-encoded form bodies
app.use(express.urlencoded({ extended: true }));

// ── Request logger (dev-friendly) ─────────────────────────────────────────────
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.originalUrl}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
//
// /api/auth is the only public router — it is how a client obtains a token in
// the first place. Everything else is mounted behind requireAuth, so a missing
// or expired token is rejected before any handler or query runs.
//
// Guards are applied here at the mount point rather than per-handler so that
// adding a route to one of these files cannot accidentally ship unauthenticated.
// Role-level rules (who may write, not merely who may read) live inside each
// router next to the handler they protect.
app.use('/api/auth', authRouter);
app.use('/api/employees', requireAuth, employeesRouter);
app.use('/api/attendance', requireAuth, attendanceRouter);
app.use('/api/expenses', requireAuth, expensesRouter);
app.use('/api/analytics', requireAuth, analyticsRouter);
// The router applies its own ADMIN-only guard, since every route in it exposes
// org-wide financials or can spend money sending WhatsApp messages.
app.use('/api/reports', requireAuth, reportsRouter);

// ── Health check ──────────────────────────────────────────────────────────────
// Now reports database connectivity too, and returns 503 when the DB is
// unreachable so the app can surface a real problem instead of failing later
// on the first data request.
app.get('/api/health', async (_req, res) => {
  const db = await healthCheck();

  res.status(db.connected ? 200 : 503).json({
    status: db.connected ? 'ok' : 'degraded',
    database: db.connected
      ? { connected: true, serverTime: db.serverTime }
      : { connected: false, error: db.error },
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected server error occurred.',
    ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
  });
});

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
