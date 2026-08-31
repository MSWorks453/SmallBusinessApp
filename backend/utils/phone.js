/**
 * utils/phone.js
 * Phone-number normalisation for OTP login.
 *
 * `employees.phone` is the login identity, so the string a user types and the
 * string in the database have to agree exactly. Rather than pull in a full
 * libphonenumber dependency, this does the narrow job the app actually needs:
 * strip formatting, apply a default country code, and emit E.164.
 *
 * Everything downstream (otp_codes.phone, the SMS provider, employee lookup)
 * consumes the normalised form only.
 */

// Default country dial code applied to national-format numbers. The seeded data
// is 10-digit Indian mobile numbers, hence +91. Override per deployment.
const DEFAULT_COUNTRY_CODE = (process.env.AUTH_DEFAULT_COUNTRY_CODE || '+91').trim();

// E.164 allows at most 15 digits including the country code, and the shortest
// real-world mobile numbers are around 8.
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * Normalises user input to E.164, e.g. '+919876543210'.
 *
 * Accepts the shapes people actually type:
 *   '9876543210'        → '+919876543210'   (default country code applied)
 *   '098765 43210'      → '+919876543210'   (trunk 0 dropped)
 *   '+91 98765-43210'   → '+919876543210'
 *   '0091 9876543210'   → '+919876543210'   (00 international prefix)
 *
 * @param {unknown} input
 * @returns {string|null} E.164 string, or null when the input cannot be a number
 */
function normalizePhone(input) {
  if (input === undefined || input === null) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  // Anything other than digits, a single leading +, and separators is a typo,
  // not a number we should guess at.
  if (!/^[+\d][\d\s().-]*$/.test(raw)) return null;

  const hadPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) {
    // Already international — take it as given.
  } else if (digits.startsWith('00')) {
    // '00' is the ITU international access prefix; the rest is the real number.
    digits = digits.slice(2);
  } else {
    const cc = DEFAULT_COUNTRY_CODE.replace(/\D/g, '');

    // A national number may carry a trunk prefix '0' that is not part of E.164.
    if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');

    // Guard against double-prefixing a number that already starts with the
    // country code but was typed without a '+'.
    if (!digits.startsWith(cc)) digits = `${cc}${digits}`;
  }

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  return `+${digits}`;
}

/**
 * Masks a number for display and logs: '+919876543210' → '+91••••••3210'.
 * Used in API responses so the OTP screen can confirm which number was texted
 * without echoing the full number back to an unauthenticated caller.
 *
 * @param {string} phone E.164 string
 * @returns {string}
 */
function maskPhone(phone) {
  const value = String(phone || '');
  if (value.length <= 7) return value;
  const head = value.slice(0, 3);
  const tail = value.slice(-4);
  return `${head}${'•'.repeat(Math.max(2, value.length - 7))}${tail}`;
}

module.exports = { normalizePhone, maskPhone, DEFAULT_COUNTRY_CODE };
