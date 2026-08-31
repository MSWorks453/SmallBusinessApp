/**
 * notify/twilio.js
 * Low-level Twilio Messages API call, shared by SMS (OTP codes) and WhatsApp
 * (scheduled reports).
 *
 * Uses global fetch (Node 18+) rather than the Twilio SDK: this is one HTTP POST
 * with basic auth, and the SDK would be a large dependency for it.
 *
 * ── Two ways to address a message ───────────────────────────────────────────
 * body        Free-form text. Fine for SMS always, and for WhatsApp only inside
 *             the 24-hour customer-service window.
 *
 * contentSid  A pre-approved Content Template ('HX…') plus its variables.
 *             REQUIRED for business-initiated WhatsApp outside that window —
 *             since 1 April 2025 Twilio rejects template text passed in `body`
 *             with error 63016. See notify/whatsapp.js for the consequences.
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/** Outside-the-window rejection. Surfaced specifically because the fix is not obvious. */
const ERROR_OUTSIDE_WINDOW = 63016;

/** Recipient has not opted in / is not a valid WhatsApp user. */
const ERROR_NOT_WHATSAPP_USER = 63003;

/** Thrown for any delivery failure, so callers can answer 502 rather than 500. */
class TwilioError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: number }} [meta]
   */
  constructor(message, { status = 0, code = 0 } = {}) {
    super(message);
    this.name = 'TwilioError';
    this.status = status;
    /** Twilio's numeric error code, e.g. 63016. */
    this.code = code;
  }
}

/**
 * Reads credentials from the environment at call time, not module load, so a
 * test or script can set them after requiring this file.
 *
 * @returns {{ accountSid: string, authToken: string }}
 * @throws {TwilioError} when unconfigured
 */
function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new TwilioError(
      'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set to send through Twilio.'
    );
  }

  return { accountSid, authToken };
}

/**
 * Sends one message.
 *
 * @param {object} params
 * @param {string} params.to                     E.164, or 'whatsapp:+91…' for WhatsApp
 * @param {string} [params.from]                 sender; omit when using messagingServiceSid
 * @param {string} [params.messagingServiceSid]  preferred over `from` when present
 * @param {string} [params.body]                 free-form text
 * @param {string} [params.contentSid]           approved Content Template SID ('HX…')
 * @param {object} [params.contentVariables]     template variables, e.g. { '1': 'Aug 29' }
 * @returns {Promise<{ id: string, status: string }>}
 * @throws {TwilioError}
 */
async function sendMessage({
  to,
  from,
  messagingServiceSid,
  body,
  contentSid,
  contentVariables,
}) {
  const { accountSid, authToken } = credentials();

  if (!to) throw new TwilioError('A destination (`to`) is required.');
  if (!from && !messagingServiceSid) {
    throw new TwilioError('Either `from` or `messagingServiceSid` is required.');
  }
  if (!body && !contentSid) {
    throw new TwilioError('Either `body` or `contentSid` is required.');
  }

  const form = new URLSearchParams({ To: to });

  // A messaging service handles sender pooling and is preferred when configured.
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from);

  if (contentSid) {
    form.set('ContentSid', contentSid);
    if (contentVariables) {
      form.set('ContentVariables', JSON.stringify(contentVariables));
    }
  } else {
    form.set('Body', body);
  }

  let response;
  let payload;
  try {
    response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    payload = await response.json().catch(() => ({}));
  } catch (err) {
    throw new TwilioError(`Could not reach Twilio: ${err.message}`);
  }

  if (!response.ok) {
    // 63016 is by far the most likely failure for scheduled WhatsApp, and its
    // default message does not say what to do about it.
    if (payload.code === ERROR_OUTSIDE_WINDOW) {
      throw new TwilioError(
        'WhatsApp rejected this message: it was sent outside the 24-hour ' +
          'customer-service window, so it must reference an approved Content ' +
          'Template. Set WHATSAPP_DAILY_CONTENT_SID / ' +
          'WHATSAPP_MONTHLY_CONTENT_SID to your approved template SIDs.',
        { status: response.status, code: payload.code }
      );
    }

    if (payload.code === ERROR_NOT_WHATSAPP_USER) {
      throw new TwilioError(
        `${to} is not reachable on WhatsApp. Check the number, and if you are ` +
          'using the Twilio sandbox make sure this number has joined it.',
        { status: response.status, code: payload.code }
      );
    }

    throw new TwilioError(
      `Twilio rejected the message (HTTP ${response.status}` +
        `${payload.code ? `, code ${payload.code}` : ''}): ` +
        `${payload.message || 'no detail returned'}`,
      { status: response.status, code: payload.code || 0 }
    );
  }

  return { id: payload.sid || '', status: payload.status || '' };
}

module.exports = {
  TwilioError,
  sendMessage,
  ERROR_OUTSIDE_WINDOW,
  ERROR_NOT_WHATSAPP_USER,
};
