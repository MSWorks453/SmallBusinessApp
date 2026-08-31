/**
 * reports/deliver.js
 * Works out who gets a report, sends it, and records the outcome.
 *
 * ── Recipients ──────────────────────────────────────────────────────────────
 * Every active employee with role ADMIN and a phone number, plus anything in
 * REPORT_EXTRA_RECIPIENTS. Derived from the employees table rather than a static
 * config list so that promoting someone to ADMIN starts their reports and
 * archiving them stops them, with no deploy.
 *
 * Numbers are already E.164 in the database (see db/normalize-phones.js), which
 * is also what the WhatsApp channel needs.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * The scheduler is in-process, so a restart, a redeploy, or a host that spins
 * down and wakes can all re-fire the same period. Delivery is therefore keyed on
 * (report_type, period_key, channel, recipient) in report_deliveries, and a
 * recipient who already has a 'sent' row is skipped.
 *
 * Sends are recorded per recipient, not per run: one admin's number failing must
 * not block the others, and must stay retryable while their successes stand.
 */

const { query } = require('../db');
const { buildDailyReport, buildMonthlyReport } = require('./reportData');
const { render } = require('./format');
const { sendWhatsAppReport, WhatsAppError, providerName } = require('../notify/whatsapp');
const { normalizePhone, maskPhone } = require('../utils/phone');

const CHANNEL = 'whatsapp';

/**
 * Approved Content Template SID per report type. Read at call time so the
 * template can be swapped without a code change.
 *
 * @param {'daily'|'monthly'} type
 * @returns {string}
 */
function contentSidFor(type) {
  return (
    (type === 'monthly'
      ? process.env.WHATSAPP_MONTHLY_CONTENT_SID
      : process.env.WHATSAPP_DAILY_CONTENT_SID) || ''
  );
}

/**
 * Resolves report recipients.
 *
 * @returns {Promise<Array<{ phone: string, name: string, source: string }>>}
 */
async function resolveRecipients() {
  const { rows } = await query(
    `SELECT id, name, phone
       FROM employees
      WHERE role = 'ADMIN'
        AND status = 'active'
        AND phone <> ''
      ORDER BY name ASC`
  );

  const recipients = rows.map((row) => ({
    phone: row.phone,
    name: row.name,
    source: `employee ${row.id}`,
  }));

  // Escape hatch for an owner who is not in the payroll table, or a shared ops
  // number. Normalised here because these come from hand-edited config.
  const extra = (process.env.REPORT_EXTRA_RECIPIENTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  for (const raw of extra) {
    const phone = normalizePhone(raw);
    if (!phone) {
      console.warn(`[reports] Ignoring unparseable REPORT_EXTRA_RECIPIENTS entry "${raw}".`);
      continue;
    }
    if (recipients.some((r) => r.phone === phone)) continue;
    recipients.push({ phone, name: 'Configured recipient', source: 'REPORT_EXTRA_RECIPIENTS' });
  }

  return recipients;
}

/**
 * Recipients already delivered to for this period.
 *
 * @param {'daily'|'monthly'} type
 * @param {string} periodKey
 * @returns {Promise<Set<string>>} phone numbers
 */
async function alreadySent(type, periodKey) {
  const { rows } = await query(
    `SELECT recipient
       FROM report_deliveries
      WHERE report_type = $1 AND period_key = $2 AND channel = $3 AND status = 'sent'`,
    [type, periodKey, CHANNEL]
  );
  return new Set(rows.map((row) => row.recipient));
}

/**
 * @param {object} params
 */
async function recordDelivery({
  type,
  periodKey,
  recipient,
  status,
  provider,
  messageId,
  error,
  payload,
}) {
  await query(
    `INSERT INTO report_deliveries
       (report_type, period_key, channel, recipient, status,
        provider, provider_message_id, error, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     -- A concurrent run may have inserted the same success first; the partial
     -- unique index makes that a conflict rather than a duplicate message.
     ON CONFLICT DO NOTHING`,
    [
      type,
      periodKey,
      CHANNEL,
      recipient,
      status,
      provider || '',
      messageId || '',
      String(error || '').slice(0, 500),
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

/**
 * Builds and sends one report.
 *
 * @param {object} options
 * @param {'daily'|'monthly'} options.type
 * @param {string} [options.periodKey] date ('YYYY-MM-DD') or month ('YYYY-MM');
 *                                     defaults to the current period
 * @param {boolean} [options.force]    resend even if already delivered
 * @returns {Promise<{
 *   type: string, periodKey: string, report: object,
 *   sent: Array<object>, skipped: Array<object>, failed: Array<object>
 * }>}
 */
async function sendReport({ type, periodKey, force = false }) {
  const report =
    type === 'monthly'
      ? await buildMonthlyReport(periodKey)
      : await buildDailyReport(periodKey);

  const resolvedKey = report.periodKey;
  const { text, variables } = render(report);
  const contentSid = contentSidFor(type);

  const [recipients, delivered] = await Promise.all([
    resolveRecipients(),
    force ? Promise.resolve(new Set()) : alreadySent(type, resolvedKey),
  ]);

  const result = { type, periodKey: resolvedKey, report, sent: [], skipped: [], failed: [] };

  if (recipients.length === 0) {
    console.warn(
      '[reports] No recipients. Give at least one active ADMIN employee a phone ' +
        'number, or set REPORT_EXTRA_RECIPIENTS.'
    );
    return result;
  }

  for (const recipient of recipients) {
    if (delivered.has(recipient.phone)) {
      result.skipped.push({ ...recipient, reason: 'already sent' });
      continue;
    }

    try {
      const outcome = await sendWhatsAppReport({
        to: recipient.phone,
        text,
        variables,
        contentSid,
      });

      await recordDelivery({
        type,
        periodKey: resolvedKey,
        recipient: recipient.phone,
        status: 'sent',
        provider: outcome.provider,
        messageId: outcome.id,
        payload: report,
      });

      result.sent.push({ ...recipient, messageId: outcome.id, mode: outcome.mode });
      console.log(
        `[reports] ${type} ${resolvedKey} → ${maskPhone(recipient.phone)} ` +
          `via ${outcome.provider} (${outcome.mode})`
      );
    } catch (err) {
      const message = err instanceof WhatsAppError ? err.message : err.message;

      await recordDelivery({
        type,
        periodKey: resolvedKey,
        recipient: recipient.phone,
        status: 'failed',
        provider: providerName,
        error: message,
        payload: report,
      });

      result.failed.push({ ...recipient, error: message });
      console.error(
        `[reports] ${type} ${resolvedKey} FAILED for ${maskPhone(recipient.phone)}: ${message}`
      );
    }
  }

  return result;
}

/**
 * Recent delivery history, for the admin-facing audit endpoint.
 *
 * @param {number} [limit]
 * @returns {Promise<Array<object>>}
 */
async function recentDeliveries(limit = 30) {
  const { rows } = await query(
    `SELECT report_type, period_key, channel, recipient, status,
            provider, provider_message_id, error, created_at
       FROM report_deliveries
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 30, 1), 200)]
  );

  return rows.map((row) => ({
    reportType: row.report_type,
    periodKey: row.period_key,
    channel: row.channel,
    // Masked: this is an audit view, not a contact directory.
    recipient: maskPhone(row.recipient),
    status: row.status,
    provider: row.provider,
    messageId: row.provider_message_id,
    error: row.error || null,
    createdAt: row.created_at?.toISOString?.() ?? null,
  }));
}

module.exports = { sendReport, resolveRecipients, recentDeliveries, alreadySent };
