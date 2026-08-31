/**
 * auth/sms.js
 * Pluggable SMS delivery for OTP codes.
 *
 * Selected with SMS_PROVIDER:
 *
 *   console  (default) Prints the code to the server log and does not send an
 *            SMS. Lets the whole login flow be developed and tested with no
 *            provider account and no per-message cost.
 *
 *   twilio   Sends through Twilio's REST API using global fetch (Node 18+), so
 *            no SDK dependency is added for one HTTP call.
 *
 * Adding a provider means adding one entry to PROVIDERS with a
 * `send({ phone, message })` function. Nothing else in the codebase needs to
 * know which provider is in use.
 */

const { sendMessage, TwilioError } = require('../notify/twilio');

const PROVIDER_NAME = (process.env.SMS_PROVIDER || 'console').trim().toLowerCase();

/** Thrown when delivery fails, so the route can answer 502 rather than 500. */
class SmsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmsError';
  }
}

// ── console (development) ──────────────────────────────────────────────────────
const consoleProvider = {
  name: 'console',
  /**
   * @param {{ phone: string, message: string }} params
   */
  async send({ phone, message }) {
    console.log(
      '\n┌─ SMS (console provider — nothing was actually sent) ────────────────\n' +
        `│ To:      ${phone}\n` +
        `│ Message: ${message}\n` +
        '└─────────────────────────────────────────────────────────────────────\n'
    );
    return { id: `console_${Date.now()}` };
  },
};

// ── Twilio ────────────────────────────────────────────────────────────────────
// The HTTP call lives in notify/twilio.js, shared with the WhatsApp report
// sender. This adapter only maps config and error types.
const twilioProvider = {
  name: 'twilio',
  /**
   * @param {{ phone: string, message: string }} params
   */
  async send({ phone, message }) {
    try {
      return await sendMessage({
        to: phone,
        from: process.env.TWILIO_FROM_NUMBER,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        body: message,
      });
    } catch (err) {
      if (err instanceof TwilioError) throw new SmsError(err.message);
      throw err;
    }
  },
};

const PROVIDERS = {
  console: consoleProvider,
  twilio: twilioProvider,
};

const provider = PROVIDERS[PROVIDER_NAME];

if (!provider) {
  console.error(
    `[sms] Unknown SMS_PROVIDER "${PROVIDER_NAME}". ` +
      `Valid values: ${Object.keys(PROVIDERS).join(', ')}. Falling back to "console".`
  );
}

const activeProvider = provider || consoleProvider;

/**
 * True when codes are not actually delivered, so the API can safely echo the
 * code back in its response to keep local development usable.
 */
const isDevProvider = activeProvider.name === 'console';

/**
 * Sends an OTP code.
 *
 * @param {{ phone: string, code: string, ttlMinutes: number }} params
 * @returns {Promise<{ provider: string, id: string }>}
 * @throws {SmsError}
 */
async function sendOtpSms({ phone, code, ttlMinutes }) {
  const appName = process.env.SMS_APP_NAME || 'FinTrack';
  const message =
    `${code} is your ${appName} verification code. ` +
    `It expires in ${ttlMinutes} minutes. Do not share it with anyone.`;

  const result = await activeProvider.send({ phone, message });
  return { provider: activeProvider.name, id: result?.id || '' };
}

module.exports = {
  SmsError,
  sendOtpSms,
  isDevProvider,
  providerName: activeProvider.name,
};
