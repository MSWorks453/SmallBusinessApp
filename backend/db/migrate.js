#!/usr/bin/env node
/**
 * db/migrate.js
 * Applies db/schema.sql to the database in DATABASE_URL.
 *
 *   npm run db:migrate
 *
 * schema.sql is written to be idempotent, so this is safe to re-run.
 */

const fs = require('fs/promises');
const path = require('path');
const { query, healthCheck, close } = require('./index');

async function main() {
  const health = await healthCheck();
  if (!health.connected) {
    console.error(`\n[migrate] Cannot connect to the database:\n  ${health.error}\n`);
    console.error('  Check that DATABASE_URL in backend/.env is correct.\n');
    process.exitCode = 1;
    return;
  }
  console.log(`[migrate] Connected. Server time: ${health.serverTime}`);

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = await fs.readFile(schemaPath, 'utf8');

  console.log('[migrate] Applying schema.sql ...');
  // Simple-query protocol: the whole file runs as one implicit transaction,
  // so a failure partway through leaves nothing half-applied.
  await query(sql);

  const { rows } = await query(`
    SELECT table_name,
           (SELECT COUNT(*) FROM information_schema.columns c
             WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS columns
    FROM information_schema.tables t
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  console.log('\n[migrate] Schema applied. Tables now present:');
  for (const r of rows) {
    console.log(`  - ${r.table_name} (${r.columns} columns)`);
  }
  console.log('\n[migrate] Done. Next: npm run db:seed\n');
}

// Run as a script (`npm run db:migrate`), but stay importable so the migration
// can be driven programmatically without tearing down the connection pool.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error('\n[migrate] Failed:', err.message, '\n');
      process.exitCode = 1;
    })
    .finally(close);
}

module.exports = { main };
