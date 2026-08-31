/**
 * db/index.js
 * PostgreSQL connection pool and query helpers.
 *
 * Configuration comes from a single DATABASE_URL env var, which works
 * unchanged against a local Postgres, Neon, Supabase, or RDS:
 *
 *   local     postgresql://postgres:postgres@localhost:5432/smallbusiness
 *   neon      postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require
 *   supabase  postgresql://postgres.xxx:pass@aws-0-region.pooler.supabase.com:6543/postgres
 *   render    postgresql://user:pass@dpg-xxx-a.REGION-postgres.render.com/dbname
 *
 * Render note: the dashboard shows two URLs. The "Internal Database URL" uses a
 * short host (dpg-xxx-a) that only resolves inside Render's private network —
 * using it from a laptop fails with `getaddrinfo ENOTFOUND dpg-xxx-a`. For local
 * development use the "External Database URL", which has the full
 * .REGION-postgres.render.com suffix.
 */

require('dotenv').config();

const { Pool, types } = require('pg');

/**
 * Return DATE columns as raw 'YYYY-MM-DD' strings.
 *
 * By default node-postgres parses DATE (OID 1082) into a JS Date at local
 * midnight. Calling .toISOString() on that shifts the calendar day backwards
 * for any negative UTC offset, which would quietly corrupt attendance dates and
 * month bucketing. The legacy JSON API already spoke 'YYYY-MM-DD', so keeping
 * DATE as text is both safer and shape-compatible.
 */
types.setTypeParser(1082, (value) => value);

const CONNECTION_STRING = process.env.DATABASE_URL;

if (!CONNECTION_STRING) {
  console.error(
    '\n[db] DATABASE_URL is not set.\n' +
      '     Copy backend/.env.example to backend/.env and fill in your connection string.\n'
  );
}

/**
 * Managed providers (Neon, Supabase, Heroku, RDS) require TLS but serve
 * certificates that Node will not verify against its default CA bundle.
 * Local databases generally do not speak TLS at all.
 *
 * We enable SSL unless the host is local, and allow an explicit override
 * via PGSSLMODE=disable.
 */
function resolveSSL(connectionString) {
  if (process.env.PGSSLMODE === 'disable') return false;

  try {
    const { hostname } = new URL(connectionString);
    const isLocal =
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (isLocal) return false;
  } catch {
    // Unparseable URL — let pg surface the real error on connect
    return false;
  }

  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: CONNECTION_STRING,
  ssl: CONNECTION_STRING ? resolveSSL(CONNECTION_STRING) : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Surface pool-level failures instead of crashing the process silently
pool.on('error', (err) => {
  console.error('[db] Unexpected idle client error:', err.message);
});

/**
 * Runs a single parameterised query.
 * Always pass values via `params` — never interpolate into the SQL string.
 *
 * @param {string} text - SQL with $1, $2 placeholders
 * @param {Array} params - bound values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    if (process.env.DB_LOG_QUERIES === 'true') {
      const ms = Date.now() - start;
      console.log(`[db] ${ms}ms rows=${result.rowCount} :: ${text.split('\n')[0].trim()}`);
    }
    return result;
  } catch (err) {
    console.error(`[db] Query failed: ${err.message}\n     SQL: ${text.trim().slice(0, 200)}`);
    throw err;
  }
}

/**
 * Runs `fn` inside a transaction on a dedicated client.
 * Commits on success, rolls back on any thrown error, and always
 * returns the client to the pool.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifies connectivity. Used by the /api/health endpoint.
 * @returns {Promise<{connected: boolean, error?: string, serverTime?: string}>}
 */
async function healthCheck() {
  try {
    const { rows } = await pool.query('SELECT NOW() AS now');
    return { connected: true, serverTime: rows[0].now.toISOString() };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/** Closes the pool. Called on graceful shutdown and by CLI scripts. */
async function close() {
  await pool.end();
}

module.exports = { pool, query, transaction, healthCheck, close };
