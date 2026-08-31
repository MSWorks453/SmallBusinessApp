#!/usr/bin/env node
/**
 * db/normalize-phones.js
 * One-off data migration: rewrite employees.phone into E.164.
 *
 *   npm run db:normalize-phones -- --dry-run   # report only, change nothing
 *   npm run db:normalize-phones                # apply
 *
 * ── Why this is needed ──────────────────────────────────────────────────────
 * Phone became the login identity when password sign-in was replaced by SMS OTP.
 * /api/auth/otp/request normalises whatever the user types to E.164 and then
 * looks the employee up with a plain equality match, so a row still holding a
 * national-format number like '7787787779' can never be matched against
 * '+917787787779'. The account looks perfectly healthy and simply never receives
 * a code.
 *
 * Rows are only rewritten when normalisation actually changes them, so the script
 * is idempotent and safe to re-run.
 *
 * Numbers that cannot be normalised are reported and left alone rather than
 * blanked — losing a contact number is worse than leaving one un-loginable, and
 * it needs a human to decide what the right number is.
 */

const { query, healthCheck, close } = require('./index');
const { normalizePhone, DEFAULT_COUNTRY_CODE } = require('../utils/phone');

async function main() {
  const DRY_RUN = process.argv.slice(2).includes('--dry-run');

  const health = await healthCheck();
  if (!health.connected) {
    console.error(`\n[normalize-phones] Cannot connect to the database:\n  ${health.error}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[normalize-phones] Default country code: ${DEFAULT_COUNTRY_CODE}` +
      `${DRY_RUN ? '   (DRY RUN — no writes)' : ''}\n`
  );

  const { rows } = await query(
    `SELECT id, name, phone, status FROM employees ORDER BY name ASC`
  );

  const planned = [];
  const unchanged = [];
  const blank = [];
  const invalid = [];

  for (const row of rows) {
    const current = row.phone || '';

    if (!current.trim()) {
      blank.push(row);
      continue;
    }

    const normalized = normalizePhone(current);

    if (!normalized) {
      invalid.push(row);
    } else if (normalized === current) {
      unchanged.push(row);
    } else {
      planned.push({ ...row, normalized });
    }
  }

  if (planned.length > 0) {
    console.log(`${DRY_RUN ? 'Would rewrite' : 'Rewriting'} ${planned.length} row(s):`);
    for (const row of planned) {
      console.log(`  ${row.id}  ${row.name.padEnd(20)} ${row.phone}  →  ${row.normalized}`);
    }
    console.log('');
  }

  let applied = 0;
  let conflicts = 0;

  if (!DRY_RUN) {
    for (const row of planned) {
      try {
        await query('UPDATE employees SET phone = $2 WHERE id = $1', [row.id, row.normalized]);
        applied++;
      } catch (err) {
        // 23505: another employee already holds the normalised number. Two rows
        // that looked different ('09876543210' and '+919876543210') collapse to
        // the same identity, and only a human can say which is correct.
        if (err.code === '23505') {
          conflicts++;
          console.error(
            `  CONFLICT ${row.id} (${row.name}): ${row.normalized} is already used by ` +
              'another employee. Left unchanged — fix the duplicate manually.'
          );
        } else {
          throw err;
        }
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('[normalize-phones] Summary:');
  console.log(`  already E.164   ${unchanged.length}`);
  console.log(`  ${DRY_RUN ? 'would change  ' : 'rewritten     '}  ${DRY_RUN ? planned.length : applied}`);
  if (conflicts > 0) console.log(`  conflicts       ${conflicts}  (see above)`);
  console.log(`  no number       ${blank.length}`);
  console.log(`  unparseable     ${invalid.length}`);

  if (blank.length > 0) {
    console.log('\n[normalize-phones] These employees have no phone and CANNOT sign in:');
    for (const row of blank) console.log(`  ${row.id}  ${row.name} (${row.status})`);
    console.log('  Add a mobile number via the Staff screen to enable OTP login.');
  }

  if (invalid.length > 0) {
    console.log('\n[normalize-phones] These numbers could not be parsed and were left as-is:');
    for (const row of invalid) console.log(`  ${row.id}  ${row.name}  "${row.phone}"`);
    console.log('  Correct them via the Staff screen; OTP login will not work until then.');
  }

  console.log('');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('\n[normalize-phones] Failed:', err.message, '\n');
      process.exitCode = 1;
    })
    .finally(close);
}

module.exports = { main };
