/**
 * src/services/api.js
 * Centralised API client layer, and the owner of the client's token lifecycle.
 *
 * BASE_URL resolves automatically:
 *  - Physical Android device / Expo Go on device → your machine's LAN IP
 *  - iOS Simulator / Web browser             → localhost
 *  - Android Emulator                         → 10.0.2.2 (maps to host machine)
 *
 * To use on a real device, set EXPO_PUBLIC_API_URL in your .env file:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.x:4000
 *
 * ── Token handling ──────────────────────────────────────────────────────────
 * Tokens live in this module (in memory, mirrored to tokenStore) rather than in
 * React state, because `request()` needs them synchronously on every call and
 * they must survive re-renders and screen unmounts.
 *
 * Access tokens are short-lived by design, so expiry is the normal case, not an
 * error. Three things keep that invisible to the UI:
 *
 *   1. Proactive refresh — a token within REFRESH_SKEW_SECONDS of expiry is
 *      renewed before the request goes out, avoiding a wasted round trip.
 *   2. Reactive refresh — a 401 TOKEN_EXPIRED triggers one refresh and one
 *      retry. Only that code is retried; the others are terminal (see below).
 *   3. Single-flight — concurrent requests share one refresh promise. Without
 *      it, five parallel screens hitting an expired token would fire five
 *      refreshes, and rotation means four of them would end up holding dead
 *      tokens and log the user out.
 *
 * When the session is genuinely unrecoverable, `onSessionExpired` fires so
 * AppContext can drop back to the login screen.
 */

import { Platform } from 'react-native';
import {
  loadSession as loadStoredSession,
  saveSession as saveStoredSession,
  saveUser as saveStoredUser,
  clearSession as clearStoredSession,
} from './tokenStore';

// Detect the correct host at runtime
function resolveBaseURL() {
  // If an env override exists, always use it
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === 'android') {
    // Android emulator routes host machine via this special IP
    return 'http://10.0.2.2:4000';
  }
  // iOS simulator and web both reach host via localhost
  return 'http://localhost:4000';
}

const BASE_URL = resolveBaseURL();

// Refresh this many seconds before the access token actually expires, to absorb
// clock skew and request latency.
const REFRESH_SKEW_SECONDS = 30;

/**
 * 401 reasons that a refresh cannot fix. Retrying these would loop; the only
 * correct response is to clear the session and show the login screen.
 * Mirrors the codes emitted by backend/middleware/requireAuth.js.
 */
const TERMINAL_AUTH_CODES = new Set([
  'TOKEN_INVALID',
  'SESSION_REVOKED',
  'SESSION_REUSED',
  'REFRESH_INVALID',
  'REFRESH_EXPIRED',
  'REFRESH_REVOKED',
  'ACCOUNT_INACTIVE',
]);

/**
 * Error thrown by every request failure.
 *
 * Carries `status` and the server's `code` so callers can branch on the reason
 * (e.g. the login screen distinguishing OTP_COOLDOWN from OTP_INVALID) instead
 * of matching on message text.
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: object }} [meta]
   */
  constructor(message, { status = 0, code = '', details = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True for a transport failure, as opposed to a response from the server. */
  get isNetworkError() {
    return this.status === 0;
  }
}

// ── Token state ───────────────────────────────────────────────────────────────
let accessToken = null;
let refreshToken = null;
/** Epoch ms at which `accessToken` stops being accepted. */
let accessTokenExpiresAt = 0;

/** Shared in-flight refresh, so parallel callers do not each rotate the token. */
let refreshInFlight = null;

/** Subscribers notified when the session becomes unrecoverable. */
const sessionExpiredListeners = new Set();

/**
 * Registers a callback fired when the session cannot be recovered and the user
 * must sign in again. AppContext uses this to clear `currentUser`.
 *
 * @param {(reason: { code: string, message: string }) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onSessionExpired(listener) {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function emitSessionExpired(reason) {
  for (const listener of sessionExpiredListeners) {
    try {
      listener(reason);
    } catch (err) {
      console.warn('[api] Session-expired listener threw:', err.message);
    }
  }
}

/**
 * Stores a credential set in memory and in persistent storage.
 *
 * @param {{ accessToken: string, refreshToken: string, expiresIn?: number, user?: object }} credentials
 */
async function setSession(credentials) {
  accessToken = credentials.accessToken;
  refreshToken = credentials.refreshToken;

  const ttl = Number(credentials.expiresIn);
  // Assume a conservative 60s if the server did not say, so a missing field
  // degrades to "refresh often", never to "never refresh".
  accessTokenExpiresAt = Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 60) * 1000;

  await saveStoredSession({
    accessToken,
    refreshToken,
    user: credentials.user || null,
  });
}

/** Drops all credentials from memory and storage. */
async function clearSession() {
  accessToken = null;
  refreshToken = null;
  accessTokenExpiresAt = 0;
  refreshInFlight = null;
  await clearStoredSession();
}

/**
 * Loads any persisted session into memory. Called once at app start.
 *
 * The stored access token's remaining lifetime is unknown — the app may have
 * been closed for days — so it is treated as already expired. The first request
 * then refreshes, which is also how we find out whether the session is still
 * valid at all.
 *
 * @returns {Promise<{ user: object|null, hasSession: boolean }>}
 */
async function initializeSession() {
  const stored = await loadStoredSession();

  accessToken = stored.accessToken;
  refreshToken = stored.refreshToken;
  accessTokenExpiresAt = 0;

  return {
    user: stored.user,
    // The refresh token is what makes a session recoverable; an access token on
    // its own is worthless once expired.
    hasSession: Boolean(stored.refreshToken),
  };
}

/**
 * Exchanges the stored refresh token for a new pair. De-duplicated: concurrent
 * callers await the same promise.
 *
 * @returns {Promise<string>} the new access token
 * @throws {ApiError} when the session cannot be recovered
 */
function refreshSession() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    if (!refreshToken) {
      throw new ApiError('Your session has ended. Please sign in again.', {
        status: 401,
        code: 'REFRESH_INVALID',
      });
    }

    try {
      // `auth: false` — this endpoint authenticates with the body, and sending a
      // dead access token would just recurse back into here.
      const response = await request('POST', '/api/auth/refresh', { refreshToken }, {
        auth: false,
        retryOnExpiry: false,
      });

      await setSession(response.data);
      return response.data.accessToken;
    } finally {
      // Cleared in `finally` so a failed refresh does not pin the error for
      // every later caller.
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Tears down the session and notifies listeners. Used for any auth failure that
 * a refresh cannot fix.
 *
 * @param {ApiError} error
 */
async function handleTerminalAuthFailure(error) {
  // A failing refresh can reach here twice: once from inside the refresh request
  // itself and once from the caller that awaited it. Only the first pass has
  // credentials to clear, so this both avoids a duplicate notification and stops
  // an OTP-screen 403 (where no session exists yet) from firing the listeners.
  const hadSession = Boolean(accessToken || refreshToken);

  await clearSession();

  if (hadSession) {
    emitSessionExpired({
      code: error.code || 'SESSION_EXPIRED',
      message: error.message,
    });
  }
}

/**
 * Core fetch wrapper.
 * Throws an ApiError with a human-readable message on non-2xx responses.
 *
 * @param {string} method
 * @param {string} path
 * @param {object|null} [body]
 * @param {{ auth?: boolean, retryOnExpiry?: boolean }} [options]
 *        auth           attach the Authorization header (default true)
 *        retryOnExpiry  refresh and retry once on TOKEN_EXPIRED (default true)
 * @returns {Promise<object>} parsed JSON body
 */
async function request(method, path, body = null, options = {}) {
  const { auth = true, retryOnExpiry = true } = options;

  // Proactive refresh: renew a token that is about to expire before spending a
  // round trip discovering that it has.
  if (
    auth &&
    refreshToken &&
    accessTokenExpiresAt > 0 &&
    Date.now() >= accessTokenExpiresAt - REFRESH_SKEW_SECONDS * 1000
  ) {
    try {
      await refreshSession();
    } catch {
      // Fall through and let the request produce the authoritative error, so
      // there is exactly one place that decides the session is dead.
    }
  }

  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (auth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const fetchOptions = { method, headers };
  if (body !== null) {
    fetchOptions.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (networkErr) {
    throw new ApiError(
      `Network request failed. Is the backend running at ${BASE_URL}?\n${networkErr.message}`,
      { status: 0, code: 'NETWORK_ERROR' }
    );
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(`Server returned non-JSON response (status ${response.status}).`, {
      status: response.status,
      code: 'BAD_RESPONSE',
    });
  }

  if (response.ok) return json;

  const error = new ApiError(json?.message || `Request failed with status ${response.status}.`, {
    status: response.status,
    code: json?.code || '',
    details: json || {},
  });

  // ── Auth-specific handling ────────────────────────────────────────────────
  if (response.status === 401 && error.code === 'TOKEN_EXPIRED' && retryOnExpiry && auth) {
    try {
      await refreshSession();
    } catch (refreshError) {
      await handleTerminalAuthFailure(refreshError);
      throw refreshError;
    }
    // One retry only, hence retryOnExpiry: false. A second 401 after a
    // successful refresh means something else is wrong and must not loop.
    return request(method, path, body, { auth, retryOnExpiry: false });
  }

  if ((response.status === 401 || response.status === 403) && TERMINAL_AUTH_CODES.has(error.code)) {
    await handleTerminalAuthFailure(error);
  }

  throw error;
}

// ── Convenience wrappers ───────────────────────────────────────────────────────
const get = (path, options) => request('GET', path, null, options);
const post = (path, body, options) => request('POST', path, body, options);
const put = (path, body, options) => request('PUT', path, body, options);
const del = (path, options) => request('DELETE', path, null, options);

// ── Auth ───────────────────────────────────────────────────────────────────────
export const authAPI = {
  /**
   * Asks the server to text a login code.
   *
   * Succeeds even for a number that is not registered — the server does not
   * reveal which numbers belong to staff. `data.devCode` is present only while
   * SMS_PROVIDER=console.
   *
   * @param {string} phone as typed; the server normalises it
   */
  requestOtp: (phone) => post('/api/auth/otp/request', { phone }, { auth: false }),

  /**
   * Exchanges a code for a session and stores the resulting tokens.
   *
   * @param {string} phone
   * @param {string} code
   * @returns {Promise<object>} the signed-in user
   */
  verifyOtp: async (phone, code) => {
    const response = await post('/api/auth/otp/verify', { phone, code }, { auth: false });
    await setSession(response.data);
    return response.data.user;
  },

  /**
   * Revokes the session server-side, then clears local storage.
   *
   * Local state is cleared even if the network call fails: a user who taps
   * "sign out" must end up signed out on this device regardless. The session row
   * would then survive on the server until its refresh token expires, which is
   * why the call is attempted first rather than skipped.
   */
  logout: async () => {
    try {
      if (refreshToken) {
        await post('/api/auth/logout', { refreshToken }, { retryOnExpiry: false });
      }
    } catch (err) {
      console.warn('[api] Server logout failed; clearing local session anyway:', err.message);
    } finally {
      await clearSession();
    }
  },

  /** Revokes every session for this account. */
  logoutAll: async () => {
    try {
      await post('/api/auth/logout-all', {});
    } finally {
      await clearSession();
    }
  },

  /** The signed-in employee. Doubles as the cold-start session probe. */
  me: () => get('/api/auth/me'),

  /** Signed-in devices for this account. */
  sessions: () => get('/api/auth/sessions'),
};

/**
 * Session lifecycle, for AppContext. Kept separate from `authAPI` because these
 * touch local state rather than the network.
 */
export const session = {
  initialize: initializeSession,
  clear: clearSession,
  saveUser: saveStoredUser,
  onExpired: onSessionExpired,
  /** @returns {boolean} whether a refresh token is held */
  isAuthenticated: () => Boolean(refreshToken),
};

// ── Employees ──────────────────────────────────────────────────────────────────
export const employeesAPI = {
  getAll: () => get('/api/employees'),
  getById: (id) => get(`/api/employees/${id}`),
  create: (data) => post('/api/employees', data),
  update: (id, data) => put(`/api/employees/${id}`, data),
  remove: (id) => del(`/api/employees/${id}`),

  /**
   * Roles the signed-in user may assign and see. Lets the role picker offer
   * exactly what the server will accept, instead of hard-coding all three and
   * failing with a 403 on save.
   *
   * @returns {Promise<{ data: { assignable: string[], visible: string[] } }>}
   */
  getRoleOptions: () => get('/api/employees/meta/roles'),
};

// ── Attendance ─────────────────────────────────────────────────────────────────
export const attendanceAPI = {
  getAll: () => get('/api/attendance'),
  getByDate: (date) => get(`/api/attendance/${date}`),
  submitDailyLogs: (date, logs) => post('/api/attendance', { date, logs }),

  /**
   * The staff the signed-in user may mark attendance for on a given date.
   *
   * Two scopes are applied server-side: role (ADMIN gets HR, HR gets employees)
   * and joining date (only people already hired on `date`). Distinct from the
   * staff directory — an ADMIN sees everyone in Staff but only marks HR here.
   *
   * The response also carries the server's `today`, which the client should use
   * instead of its own clock: a device in another timezone would disagree about
   * which dates count as the future, and the server's view is the enforced one.
   *
   * @param {string} [date] 'YYYY-MM-DD'; defaults to the server's today
   * @returns {Promise<{ data: {
   *   date: string, today: string, timezone: string,
   *   roles: string[], employees: object[]
   * } }>}
   */
  getRoster: (date) =>
    get(`/api/attendance/roster${date ? `?date=${encodeURIComponent(date)}` : ''}`),
};

// ── Expenses ───────────────────────────────────────────────────────────────────
export const expensesAPI = {
  getAll: () => get('/api/expenses'),
  create: (data) => post('/api/expenses', data),
  remove: (id) => del(`/api/expenses/${id}`),
  getCategories: () => get('/api/expenses/meta/categories'),
};

// ── Analytics ──────────────────────────────────────────────────────────────────
export const analyticsAPI = {
  getSummary: () => get('/api/analytics/summary'),
};

// ── Reports ────────────────────────────────────────────────────────────────────
export const reportsAPI = {
  /**
   * Per-employee payroll table for a month, plus the months worth selecting.
   *
   * Rows are scoped server-side by role: ADMIN gets the whole organisation, HR
   * gets only the staff it manages.
   *
   * @param {string} [month] 'YYYY-MM'; defaults to the current month
   * @returns {Promise<{ data: {
   *   month: string, monthLabel: string, daysLogged: number,
   *   employees: object[], totals: object,
   *   availableMonths: Array<{ month: string, label: string }>,
   *   scopedToRoles: string[]
   * } }>}
   */
  getEmployeeMonthly: (month) =>
    get(`/api/reports/employees${month ? `?month=${encodeURIComponent(month)}` : ''}`),
};

// ── Health ─────────────────────────────────────────────────────────────────────
// Public endpoint: reachable before sign-in, so it does not send a token.
export const healthAPI = {
  check: () => get('/api/health', { auth: false }),
};

export default {
  BASE_URL,
  ApiError,
  authAPI,
  session,
  employeesAPI,
  attendanceAPI,
  expensesAPI,
  analyticsAPI,
  reportsAPI,
  healthAPI,
};
