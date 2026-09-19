/**
 * app.js
 * Builds the Express app: middleware, routes, health check, error handling.
 *
 * Split out from server.js so the same app can be mounted inside a Netlify
 * Function (via netlify/functions/api.js) without also pulling in the
 * process-lifetime concerns that only make sense for a long-running host —
 * .listen(), the cron report scheduler, and the signal handlers.
 */

const express = require('express');
const cors = require('cors');

const { healthCheck } = require('./db');
const { requireAuth } = require('./middleware/requireAuth');

// ── Route imports ──────────────────────────────────────────────────────────────
const authRouter = require('./routes/auth');
const employeesRouter = require('./routes/employees');
const attendanceRouter = require('./routes/attendance');
const expensesRouter = require('./routes/expenses');
const analyticsRouter = require('./routes/analytics');
const reportsRouter = require('./routes/reports');

const app = express();

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
// Reports database connectivity too, and returns 503 when the DB is
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

module.exports = app;
