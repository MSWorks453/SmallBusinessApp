#!/usr/bin/env node
/**
 * db/seed.js
 * One-time import of the legacy JSON files in backend/data into Postgres.
 *
 *   npm run db:seed                    # import, skipping orphaned attendance rows
 *   npm run db:seed -- --keep-orphans  # import, inventing placeholder employees instead
 *   npm run db:seed -- --reset         # DESTRUCTIVE: wipe all three tables first
 *
 * Re-running without --reset is safe: every insert upserts on its natural key.
 *
 * ── Why the orphan handling exists ──────────────────────────────────────────
 * attendance.json references employee ids (emp_001 … emp_006) that do not exist
 * in employees.json. The old file-based code hid this: computeMonthlySalaries()
 * skipped them while the attendance-rate chart still counted them in
 * `dayEntry.logs.length`. Postgres will not accept those rows, so this script
 * makes the choice explicit rather than silently dropping data.
 */

const path = require('path');
const { readJSON } = require('../utils/fileHelpers');
const { transaction, healthCheck, close } = require('./index');

/** Converts a JS value to a clean string, defaulting to ''. */
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * @param {{ keepOrphans?: boolean, reset?: boolean }} [options]
 *        Defaults are read from process.argv when omitted.
 */
async function main(options = {}) {
  const args = process.argv.slice(2);
  const KEEP_ORPHANS = options.keepOrphans ?? args.includes('--keep-orphans');
  const RESET = options.reset ?? args.includes('--reset');

  const health = await healthCheck();
  if (!health.connected) {
    console.error(`\n[seed] Cannot connect to the database:\n  ${health.error}\n`);
    process.exitCode = 1;
    return;
  }

  const [employees, attendanceDocs, expenses] = await Promise.all([
    readJSON('employees.json'),
    readJSON('attendance.json'),
    readJSON('expenses.json'),
  ]);

  console.log('[seed] Source files:');
  console.log(`  employees.json   ${employees.length} records`);
  console.log(`  attendance.json  ${attendanceDocs.length} day documents`);
  console.log(`  expenses.json    ${expenses.length} records\n`);

  const report = {
    employeesInserted: 0,
    placeholdersCreated: [],
    duplicateEmails: [],
    attendanceInserted: 0,
    attendanceSkipped: [],
    invalidStatuses: [],
    expensesInserted: 0,
    expensesAttributionCleared: [],
  };

  await transaction(async (client) => {
    if (RESET) {
      console.log('[seed] --reset given: truncating attendance, expenses, employees ...');
      await client.query('TRUNCATE attendance, expenses, employees RESTART IDENTITY CASCADE');
    }

    // ── Employees ───────────────────────────────────────────────────────────
    // Guard against case-insensitive duplicate emails, which would otherwise
    // abort the whole transaction on the employees_email_lower_key index.
    const seenEmails = new Map();

    for (const e of employees) {
      const email = str(e.email).toLowerCase();
      if (seenEmails.has(email)) {
        report.duplicateEmails.push(`${e.id} (${email}) collides with ${seenEmails.get(email)}`);
        continue;
      }
      seenEmails.set(email, e.id);

      await client.query(
        `INSERT INTO employees
           (id, name, role, department, position, email, phone, base_salary, join_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           name        = EXCLUDED.name,
           role        = EXCLUDED.role,
           department  = EXCLUDED.department,
           position    = EXCLUDED.position,
           email       = EXCLUDED.email,
           phone       = EXCLUDED.phone,
           base_salary = EXCLUDED.base_salary,
           join_date   = EXCLUDED.join_date,
           status      = EXCLUDED.status`,
        [
          e.id,
          str(e.name),
          str(e.role).toUpperCase() || 'EMPLOYEE',
          str(e.department),
          str(e.position),
          email,
          str(e.phone),
          Number(e.baseSalary) || 1,
          e.joinDate || new Date().toISOString().slice(0, 10),
          e.status === 'inactive' ? 'inactive' : 'active',
        ]
      );
      report.employeesInserted++;
    }

    // ── Flatten attendance day-documents into rows ───────────────────────────
    const known = new Set(
      (await client.query('SELECT id FROM employees')).rows.map((r) => r.id)
    );
    const VALID_STATUS = new Set(['Present', 'Half-Day', 'Absent']);

    // Collect orphan ids first so placeholders can be created up front
    const orphanIds = new Set();
    for (const doc of attendanceDocs) {
      for (const log of doc.logs || []) {
        if (!known.has(log.employeeId)) orphanIds.add(log.employeeId);
      }
    }

    if (orphanIds.size > 0 && KEEP_ORPHANS) {
      for (const id of orphanIds) {
        await client.query(
          `INSERT INTO employees
             (id, name, role, department, position, email, phone, base_salary, join_date, status)
           VALUES ($1,$2,'EMPLOYEE','Archived','Archived',$3,'',1,CURRENT_DATE,'inactive')
           ON CONFLICT (id) DO NOTHING`,
          [id, `Archived ${id}`, `${id}@archived.local`]
        );
        known.add(id);
        report.placeholdersCreated.push(id);
      }
    }

    for (const doc of attendanceDocs) {
      if (!doc.date) continue;
      for (const log of doc.logs || []) {
        if (!known.has(log.employeeId)) {
          report.attendanceSkipped.push(`${doc.date} / ${log.employeeId}`);
          continue;
        }
        if (!VALID_STATUS.has(log.status)) {
          report.invalidStatuses.push(`${doc.date} / ${log.employeeId} / "${log.status}"`);
          continue;
        }
        await client.query(
          `INSERT INTO attendance (employee_id, date, status)
           VALUES ($1,$2,$3)
           ON CONFLICT (employee_id, date) DO UPDATE SET status = EXCLUDED.status`,
          [log.employeeId, doc.date, log.status]
        );
        report.attendanceInserted++;
      }
    }

    // ── Expenses ────────────────────────────────────────────────────────────
    for (const x of expenses) {
      let submittedBy = x.submittedBy || null;
      if (submittedBy && !known.has(submittedBy)) {
        report.expensesAttributionCleared.push(`${x.id} referenced ${submittedBy}`);
        submittedBy = null;
      }

      const amount = Number(x.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      await client.query(
        `INSERT INTO expenses (id, date, amount, category, description, submitted_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, NOW()))
         ON CONFLICT (id) DO UPDATE SET
           date         = EXCLUDED.date,
           amount       = EXCLUDED.amount,
           category     = EXCLUDED.category,
           description  = EXCLUDED.description,
           submitted_by = EXCLUDED.submitted_by`,
        [
          x.id,
          x.date,
          amount,
          str(x.category) || 'Other',
          str(x.description),
          submittedBy,
          x.createdAt || null,
        ]
      );
      report.expensesInserted++;
    }
  });

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('[seed] Imported:');
  console.log(`  employees   ${report.employeesInserted}`);
  console.log(`  attendance  ${report.attendanceInserted} rows`);
  console.log(`  expenses    ${report.expensesInserted}`);

  if (report.placeholdersCreated.length) {
    console.log(
      `\n[seed] Created ${report.placeholdersCreated.length} placeholder employees (--keep-orphans):`
    );
    console.log(`  ${report.placeholdersCreated.join(', ')}`);
    console.log(
      '  These are status=inactive with base_salary=1, so they are excluded from\n' +
        '  salary analytics. Edit or delete them once you know who they were.'
    );
  }

  if (report.attendanceSkipped.length) {
    console.log(
      `\n[seed] Skipped ${report.attendanceSkipped.length} attendance rows with no matching employee:`
    );
    const preview = report.attendanceSkipped.slice(0, 10);
    for (const s of preview) console.log(`  ${s}`);
    if (report.attendanceSkipped.length > preview.length) {
      console.log(`  ... and ${report.attendanceSkipped.length - preview.length} more`);
    }
    console.log('  Re-run with --keep-orphans to retain them as archived employees instead.');
  }

  if (report.duplicateEmails.length) {
    console.log('\n[seed] Skipped employees with duplicate emails:');
    for (const d of report.duplicateEmails) console.log(`  ${d}`);
  }

  if (report.invalidStatuses.length) {
    console.log('\n[seed] Skipped attendance rows with an unrecognised status:');
    for (const s of report.invalidStatuses.slice(0, 10)) console.log(`  ${s}`);
  }

  if (report.expensesAttributionCleared.length) {
    console.log('\n[seed] Cleared submittedBy on expenses pointing at unknown employees:');
    for (const s of report.expensesAttributionCleared) console.log(`  ${s}`);
  }

  console.log('\n[seed] Done.\n');
}

// Run as a script (`npm run db:seed`), but stay importable so the import can be
// driven programmatically without tearing down the connection pool.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error('\n[seed] Failed, transaction rolled back:', err.message, '\n');
      process.exitCode = 1;
    })
    .finally(close);
}

module.exports = { main };
