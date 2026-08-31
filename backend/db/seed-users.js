#!/usr/bin/env node
/**
 * db/seed-users.js
 * Creates the staff accounts needed to exercise each role.
 *
 *   npm run db:seed-users              # create or update, then print login numbers
 *   npm run db:seed-users -- --list    # just show who can sign in, change nothing
 *
 * ── Why this is a script and not an API call ─────────────────────────────────
 * POST /api/employees requires an ADMIN token, and a token only comes from
 * signing in as an existing ADMIN. With no ADMIN in the table that is circular,
 * so the first one has to be written directly. Once an ADMIN exists, everyone
 * else can be added from the Staff screen in the app.
 *
 * ── Login ───────────────────────────────────────────────────────────────────
 * There are no passwords. Sign-in is an OTP texted to `phone`, so the phone
 * column is the credential and must be unique and in E.164 — normalizePhone()
 * enforces both. While SMS_PROVIDER=console the code is printed to the server
 * log and returned in the API response, so these placeholder numbers work for
 * local testing without a real handset.
 *
 * Re-running is safe: rows upsert on their fixed id, so this will not create
 * duplicates or reset anyone's sessions.
 */

const { query, healthCheck, close } = require('./index');
const { normalizePhone } = require('../utils/phone');
const { todayISO } = require('../utils/fileHelpers');

/**
 * Fixed ids rather than generateId(), so re-running updates these same rows
 * instead of inserting near-duplicates every time.
 *
 * Phone numbers are deliberately obvious placeholders in the 90000000xx block.
 * Replace them with real numbers before switching SMS_PROVIDER to twilio,
 * otherwise the codes go to whoever actually owns them.
 */
const USERS = [
  {
    // The business owner. "Owner" is not a role — the role enum is only
    // ADMIN / HR / EMPLOYEE — so ownership is expressed as ADMIN plus a
    // position, which needs no schema change. Nothing in the system currently
    // behaves differently for the owner than for any other ADMIN.
    id: 'emp_seed_owner',
    name: 'Ravi Kumar',
    role: 'ADMIN',
    department: 'Management',
    position: 'Owner',
    email: 'owner@fintrack.local',
    phone: '9000000000',
    // Owners often do not draw a payroll salary. This value only reaches the
    // salary-cost figures if the owner has attendance rows: analytics and the
    // reports compute score/totalDays * baseSalary, and an employee with no
    // attendance contributes zero. Set it to whatever is actually drawn.
    baseSalary: 150000,
  },
  {
    id: 'emp_seed_admin',
    name: 'Eva Chen',
    role: 'ADMIN',
    department: 'Finance',
    position: 'Finance Lead',
    email: 'eva.chen@fintrack.local',
    phone: '9000000001',
    baseSalary: 90000,
  },
  {
    id: 'emp_seed_hr',
    name: 'Carol Davis',
    role: 'HR',
    department: 'Human Resources',
    position: 'HR Manager',
    email: 'carol.davis@fintrack.local',
    phone: '9000000002',
    baseSalary: 65000,
  },
];

/** Prints everyone who can currently sign in. */
async function listSignInAccounts() {
  const { rows } = await query(
    `SELECT id, name, role, position, phone, status
       FROM employees
      WHERE phone <> ''
      ORDER BY
        CASE role WHEN 'ADMIN' THEN 1 WHEN 'HR' THEN 2 ELSE 3 END,
        -- Owner first within ADMIN, so the account that matters is at the top.
        CASE WHEN lower(position) LIKE '%owner%' THEN 0 ELSE 1 END,
        name ASC`
  );

  if (rows.length === 0) {
    console.log('\n[seed-users] Nobody has a phone number, so nobody can sign in.\n');
    return;
  }

  console.log('\n[seed-users] Accounts that can sign in (enter the number on the login screen):\n');
  console.log('  ROLE      PHONE            NAME                 POSITION');
  for (const row of rows) {
    const flag = row.status === 'active' ? '' : '   (inactive — cannot sign in)';
    console.log(
      `  ${row.role.padEnd(9)} ${row.phone.padEnd(16)} ${row.name.padEnd(20)} ` +
        `${row.position}${flag}`
    );
  }

  const { rows: noPhone } = await query(
    `SELECT name, role FROM employees WHERE phone = '' AND status = 'active'`
  );
  if (noPhone.length > 0) {
    console.log('\n  No phone on record, so cannot sign in:');
    for (const row of noPhone) console.log(`    ${row.role.padEnd(9)} ${row.name}`);
  }
  console.log('');
}

async function main() {
  const LIST_ONLY = process.argv.slice(2).includes('--list');

  const health = await healthCheck();
  if (!health.connected) {
    console.error(`\n[seed-users] Cannot connect to the database:\n  ${health.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (LIST_ONLY) {
    await listSignInAccounts();
    return;
  }

  const created = [];
  const updated = [];

  for (const user of USERS) {
    const phone = normalizePhone(user.phone);
    if (!phone) {
      console.error(`[seed-users] Skipping ${user.name}: "${user.phone}" is not a valid number.`);
      continue;
    }

    try {
      // xmax = 0 distinguishes an INSERT from an ON CONFLICT UPDATE, so the
      // summary can report what actually happened rather than guessing.
      const { rows } = await query(
        `INSERT INTO employees
           (id, name, role, department, position, email, phone,
            base_salary, join_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
         ON CONFLICT (id) DO UPDATE SET
           name        = EXCLUDED.name,
           role        = EXCLUDED.role,
           department  = EXCLUDED.department,
           position    = EXCLUDED.position,
           email       = EXCLUDED.email,
           phone       = EXCLUDED.phone,
           base_salary = EXCLUDED.base_salary,
           status      = 'active'
         RETURNING id, (xmax = 0) AS inserted`,
        [
          user.id,
          user.name,
          user.role,
          user.department,
          user.position,
          user.email.toLowerCase(),
          phone,
          user.baseSalary,
          todayISO(),
        ]
      );

      (rows[0].inserted ? created : updated).push(`${user.role} ${user.name} (${phone})`);
    } catch (err) {
      // 23505 means the email or phone is already taken by a DIFFERENT row —
      // both are unique, and both are identities we must not silently merge.
      if (err.code === '23505') {
        console.error(
          `[seed-users] Skipping ${user.name}: ${
            err.constraint === 'employees_phone_key' ? 'phone' : 'email'
          } already belongs to another employee. ` +
            'Edit USERS in this file to use a different one.'
        );
        continue;
      }
      throw err;
    }
  }

  console.log('\n[seed-users] Summary:');
  for (const entry of created) console.log(`  created  ${entry}`);
  for (const entry of updated) console.log(`  updated  ${entry}`);
  if (created.length === 0 && updated.length === 0) {
    console.log('  nothing changed');
  }

  await listSignInAccounts();

  console.log(
    '[seed-users] Notes:\n' +
      '  · No passwords. Enter the phone number on the login screen and the app\n' +
      '    will request an OTP. With SMS_PROVIDER=console the code is printed by\n' +
      '    the API and returned in its response, so no real handset is needed.\n' +
      '  · The ADMIN above is now a recipient of the scheduled WhatsApp reports.\n' +
      '  · Replace the 90000000xx placeholders with real numbers before setting\n' +
      '    SMS_PROVIDER=twilio, or codes will go to whoever owns them.\n'
  );
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('\n[seed-users] Failed:', err.message, '\n');
      process.exitCode = 1;
    })
    .finally(close);
}

module.exports = { main, USERS };
