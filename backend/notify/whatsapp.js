/**
 * notify/whatsapp.js
 * WhatsApp delivery for the scheduled reports.
 *
 * Selected with WHATSAPP_PROVIDER:
 *
 *   console  (default) Prints the report to the server log. Lets the schedule,
 *            the figures and the formatting all be developed and tested with no
 *            WhatsApp Business account and no per-message cost.
 *
 *   twilio   Real delivery through Twilio's WhatsApp channel.
 *
 * ── The 24-hour window, and why this matters ────────────────────────────────
 * WhatsApp splits outbound business messages in two:
 *
 *   Inside the window   The recipient messaged you in the last 24 hours. Any
 *                       free-form text is allowed.
 *
 *   Outside the window  Everything else. Only a pre-approved Content Template,
 *                       referenced by its ContentSid, is accepted. Since
 *                       1 April 2025 Twilio rejects template text supplied as a
 *                       plain body with error 63016.
 *
 * A scheduled 8pm report is always business-initiated and essentially always
 * outside the window, so production delivery REQUIRES an approved template.
 *
 * That constraint shapes the report itself. WhatsApp template variables cannot
 * contain newlines, so a report cannot be one multi-line blob dropped into
 * {{1}} — it has to be a fixed sentence with scalar substitutions. This is why
 * reports/format.js produces both a `text` rendering (for the console provider
 * and for in-window sandbox testing) and a flat `variables` map.
 *
 * `mode` picks between them:
 *   'template'  ContentSid + ContentVariables — the production path
 *   'freeform'  plain body — works in the sandbox and inside the 24h window
 */

const { sendMessage, TwilioError } = require('./twilio');

const PROVIDER_NAME = (process.env.WHATSAPP_PROVIDER || 'console').trim().toLowerCase();

/** Thrown for any WhatsApp delivery failure. */
class WhatsAppError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: number }} [meta]
   */
  constructor(message, { code = 0 } = {}) {
    super(message);
    this.name = 'WhatsAppError';
    this.code = code;
  }
}

/**
 * Twilio addresses WhatsApp endpoints with a 'whatsapp:' scheme prefix.
 * Idempotent, so an already-prefixed value passes through.
 *
 * @param {string} phone E.164
 * @returns {string}
 */
function whatsappAddress(phone) {
  const value = String(phone || '').trim();
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
}

// ── console (development) ─────────────────────────────────────────────────────
const consoleProvider = {
  name: 'console',
  /**
   * @param {{ to: string, text: string, variables: object, mode: string }} params
   */
  async send({ to, text, variables, mode }) {
    console.log(
      '\n┌─ WhatsApp (console provider — nothing was actually sent) ────────────\n' +
        `│ To:   ${to}\n` +
        `│ Mode: ${mode}\n` +
        '├──────────────────────────────────────────────────────────────────────\n' +
        String(text)
          .split('\n')
          .map((line) => `│ ${line}`)
          .join('\n') +
        '\n├─ template variables ────────────────────────────────────────────────\n' +
        `│ ${JSON.stringify(variables)}\n` +
        '└──────────────────────────────────────────────────────────────────────\n'
    );
    return { id: `console_${Date.now()}` };
  },
};

// ── Twilio ────────────────────────────────────────────────────────────────────
const twilioProvider = {
  name: 'twilio',
  /**
   * @param {{ to: string, text: string, variables: object, mode: string, contentSid: string }} params
   */
  async send({ to, text, variables, mode, contentSid }) {
    const from = process.env.TWILIO_WHATSAPP_FROM;
    const messagingServiceSid = process.env.TWILIO_WHATSAPP_MESSAGING_SERVICE_SID;

    if (!from && !messagingServiceSid) {
      throw new WhatsAppError(
        'WHATSAPP_PROVIDER=twilio needs TWILIO_WHATSAPP_FROM (e.g. ' +
          'whatsapp:+14155238886 for the sandbox) or ' +
          'TWILIO_WHATSAPP_MESSAGING_SERVICE_SID.'
      );
    }

    if (mode === 'template' && !contentSid) {
      throw new WhatsAppError(
        'Template mode needs an approved Content Template SID. Set the matching ' +
          'WHATSAPP_DAILY_CONTENT_SID / WHATSAPP_MONTHLY_CONTENT_SID, or set ' +
          'WHATSAPP_MESSAGE_MODE=freeform for sandbox testing.'
      );
    }

    try {
      return await sendMessage({
        to: whatsappAddress(to),
        from: from ? whatsappAddress(from) : undefined,
        messagingServiceSid,
        ...(mode === 'template'
          ? { contentSid, contentVariables: variables }
          : { body: text }),
      });
    } catch (err) {
      if (err instanceof TwilioError) {
        throw new WhatsAppError(err.message, { code: err.code });
      }
      throw err;
    }
  },
};

const PROVIDERS = {
  console: consoleProvider,
  twilio: twilioProvider,
};

if (!PROVIDERS[PROVIDER_NAME]) {
  console.error(
    `[whatsapp] Unknown WHATSAPP_PROVIDER "${PROVIDER_NAME}". ` +
      `Valid values: ${Object.keys(PROVIDERS).join(', ')}. Falling back to "console".`
  );
}

const activeProvider = PROVIDERS[PROVIDER_NAME] || consoleProvider;

/**
 * Default message mode.
 *
 * 'template' for real delivery. The console provider ignores the distinction but
 * still reports which mode would have been used, so a misconfiguration is
 * visible before you switch a provider on.
 */
const MESSAGE_MODE = (process.env.WHATSAPP_MESSAGE_MODE || 'template').trim().toLowerCase();

/**
 * Sends one report.
 *
 * @param {object} params
 * @param {string} params.to          recipient in E.164
 * @param {string} params.text        rendered multi-line report
 * @param {object} params.variables   flat template variables, e.g. { '1': '29 Aug' }
 * @param {string} [params.contentSid] approved template SID for this report type
 * @returns {Promise<{ provider: string, id: string, mode: string }>}
 * @throws {WhatsAppError}
 */
async function sendWhatsAppReport({ to, text, variables, contentSid }) {
  const mode = MESSAGE_MODE === 'freeform' ? 'freeform' : 'template';

  const result = await activeProvider.send({ to, text, variables, mode, contentSid });

  return { provider: activeProvider.name, id: result?.id || '', mode };
}

module.exports = {
  WhatsAppError,
  sendWhatsAppReport,
  whatsappAddress,
  providerName: activeProvider.name,
  isDevProvider: activeProvider.name === 'console',
  messageMode: MESSAGE_MODE,
};
