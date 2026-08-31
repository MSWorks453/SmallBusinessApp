/**
 * src/services/tokenStore.js
 * Persistence for the session credentials issued after OTP verification.
 *
 * ── Why a wrapper and not expo-secure-store directly ────────────────────────
 * SecureStore is only implemented on Android and iOS — per the SDK 57 docs,
 * `isAvailableAsync()` resolves true on those two platforms only. This app also
 * runs on web (react-native-web), so calling SecureStore there would throw and
 * take the login screen down with it.
 *
 * Backends, in order of preference:
 *
 *   native  expo-secure-store → Android Keystore-encrypted SharedPreferences,
 *           iOS Keychain (kSecClassGenericPassword).
 *
 *   web     localStorage. Genuinely weaker: anything running in the page can
 *           read it, so a XSS bug is a token theft. It is used because the web
 *           target is a development convenience here, and it is the reason the
 *           access token is short-lived and the refresh token rotates.
 *
 *   last    In-memory. Covers private-mode browsers that throw on localStorage.
 *           The session simply does not survive a reload.
 *
 * Note on iOS: Keychain entries survive app uninstall when the same bundle ID is
 * reinstalled. A stale session can therefore outlive a delete-and-reinstall —
 * harmless here because the server still checks the session row, which will have
 * expired or been revoked.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore keys accept alphanumerics plus '.', '-' and '_'.
const KEYS = {
  accessToken: 'fintrack.accessToken',
  refreshToken: 'fintrack.refreshToken',
  user: 'fintrack.user',
};

const isWeb = Platform.OS === 'web';

// ── In-memory fallback ────────────────────────────────────────────────────────
const memoryStore = new Map();

const memoryBackend = {
  name: 'memory',
  async get(key) {
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  },
  async set(key, value) {
    memoryStore.set(key, value);
  },
  async remove(key) {
    memoryStore.delete(key);
  },
};

// ── Web backend ───────────────────────────────────────────────────────────────
/**
 * Probes localStorage rather than assuming it. Safari in private mode and some
 * embedded webviews expose the object but throw on write.
 */
function localStorageUsable() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const probe = '__fintrack_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const webBackend = {
  name: 'localStorage',
  async get(key) {
    return window.localStorage.getItem(key);
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
  },
  async remove(key) {
    window.localStorage.removeItem(key);
  },
};

// ── Native backend ────────────────────────────────────────────────────────────
const secureStoreBackend = {
  name: 'expo-secure-store',
  async get(key) {
    return SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key) {
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Resolved once, lazily, and cached — picking a backend involves a platform
 * check and (on native) an async availability probe.
 */
let backendPromise = null;

function resolveBackend() {
  if (backendPromise) return backendPromise;

  backendPromise = (async () => {
    if (isWeb) {
      return localStorageUsable() ? webBackend : memoryBackend;
    }

    try {
      const available = await SecureStore.isAvailableAsync();
      if (available) return secureStoreBackend;
      console.warn('[tokenStore] SecureStore unavailable on this device; sessions will not persist.');
    } catch (err) {
      console.warn(`[tokenStore] SecureStore probe failed (${err.message}); using memory.`);
    }
    return memoryBackend;
  })();

  return backendPromise;
}

/** @returns {Promise<string>} name of the active backend, for diagnostics */
export async function backendName() {
  return (await resolveBackend()).name;
}

/**
 * Reads the stored session.
 *
 * Never throws: a cold start must not be blocked by a storage failure. A
 * corrupt or unreadable entry is reported as "no session", which lands the user
 * on the login screen — recoverable, unlike a crash.
 *
 * @returns {Promise<{ accessToken: string|null, refreshToken: string|null, user: object|null }>}
 */
export async function loadSession() {
  try {
    const backend = await resolveBackend();
    const [accessToken, refreshToken, userJson] = await Promise.all([
      backend.get(KEYS.accessToken),
      backend.get(KEYS.refreshToken),
      backend.get(KEYS.user),
    ]);

    let user = null;
    if (userJson) {
      try {
        user = JSON.parse(userJson);
      } catch {
        // Cached profile is a render optimisation, not the credential. Losing it
        // is fine; /api/auth/me refills it.
        user = null;
      }
    }

    return { accessToken: accessToken || null, refreshToken: refreshToken || null, user };
  } catch (err) {
    console.warn('[tokenStore] Could not read stored session:', err.message);
    return { accessToken: null, refreshToken: null, user: null };
  }
}

/**
 * Persists a token pair, and the user profile when one is supplied.
 *
 * `user` is optional because token refresh returns fresh tokens for the same
 * person and there is no need to rewrite the profile every 15 minutes.
 *
 * @param {{ accessToken: string, refreshToken: string, user?: object|null }} session
 */
export async function saveSession({ accessToken, refreshToken, user }) {
  const backend = await resolveBackend();

  const writes = [
    backend.set(KEYS.accessToken, String(accessToken)),
    backend.set(KEYS.refreshToken, String(refreshToken)),
  ];
  if (user) {
    writes.push(backend.set(KEYS.user, JSON.stringify(user)));
  }

  await Promise.all(writes);
}

/**
 * Replaces only the cached user profile.
 * @param {object} user
 */
export async function saveUser(user) {
  const backend = await resolveBackend();
  await backend.set(KEYS.user, JSON.stringify(user));
}

/**
 * Wipes every stored credential. Called on logout and whenever the server tells
 * us the session is unrecoverable.
 *
 * Failures are swallowed on purpose: if clearing storage throws, the in-memory
 * state has still been cleared and the user is signed out from their point of
 * view. Surfacing an error here would only be confusing.
 */
export async function clearSession() {
  try {
    const backend = await resolveBackend();
    await Promise.all([
      backend.remove(KEYS.accessToken),
      backend.remove(KEYS.refreshToken),
      backend.remove(KEYS.user),
    ]);
  } catch (err) {
    console.warn('[tokenStore] Could not clear stored session:', err.message);
  }
}

export default { loadSession, saveSession, saveUser, clearSession, backendName };
