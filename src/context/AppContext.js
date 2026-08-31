/**
 * src/context/AppContext.js
 * Global application state and the session it hangs off.
 *
 * ── Login flow ──────────────────────────────────────────────────────────────
 * Authentication is SMS OTP. `currentUser` is null until verifyOtp() succeeds,
 * and the role it carries comes from the employee record on the server — there
 * is no role picker, and nothing the client sends can influence it.
 *
 * ── Three states, not two ───────────────────────────────────────────────────
 * A persisted session means "signed out" and "not checked yet" are different
 * things, so `status` is a tri-state:
 *
 *   'bootstrapping'  reading stored tokens; render a splash
 *   'signedOut'      no usable session; render the login screen
 *   'signedIn'       `currentUser` is populated
 *
 * Collapsing these to `currentUser === null` would flash the login screen on
 * every cold start before the stored token was read.
 *
 * Token storage, refresh and expiry all live in src/services/api.js; this file
 * only reacts to them.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { employeesAPI, authAPI, session as apiSession, ApiError } from '../services/api';

// ── Role constants ─────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN:    'ADMIN',
  HR:       'HR',
  EMPLOYEE: 'EMPLOYEE',
};

// ── Session status ─────────────────────────────────────────────────────────────
export const SESSION_STATUS = {
  BOOTSTRAPPING: 'bootstrapping',
  SIGNED_OUT:    'signedOut',
  SIGNED_IN:     'signedIn',
};

// ── Context ────────────────────────────────────────────────────────────────────
const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [status, setStatus]                     = useState(SESSION_STATUS.BOOTSTRAPPING);
  const [currentUser, setCurrentUser]           = useState(null);
  /** Set when a live session ended on its own, so the login screen can say why. */
  const [sessionEndedReason, setSessionEndedReason] = useState(null);

  const [employees, setEmployees]                 = useState([]);
  const [employeesLoading, setEmployeesLoading]   = useState(false);
  const [employeesError, setEmployeesError]       = useState(null);

  // Guards against setState after unmount during the async bootstrap.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchEmployees = useCallback(async () => {
    setEmployeesLoading(true);
    setEmployeesError(null);
    try {
      const res = await employeesAPI.getAll();
      setEmployees(res.data || []);
    } catch (err) {
      // A 401 here is already being handled by the api layer, which will trigger
      // the session-expired path. Showing "unauthorised" in a data banner as
      // well would just be noise on top of a redirect to login.
      if (!(err instanceof ApiError) || err.status !== 401) {
        setEmployeesError(err.message);
      }
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  /** Clears everything derived from a session. */
  const resetState = useCallback(() => {
    setCurrentUser(null);
    setEmployees([]);
    setEmployeesError(null);
    setStatus(SESSION_STATUS.SIGNED_OUT);
  }, []);

  /**
   * Promotes a verified user to signed-in and warms the shared data every screen
   * reads, so the first screen after login is not empty.
   */
  const establishSession = useCallback(async (user) => {
    setCurrentUser(user);
    setSessionEndedReason(null);
    setStatus(SESSION_STATUS.SIGNED_IN);
    await fetchEmployees().catch(() => {});
  }, [fetchEmployees]);

  // ── Cold start ──────────────────────────────────────────────────────────────
  // Restores a stored session, then confirms it against the server. The cached
  // profile is rendered immediately and corrected by /api/auth/me, so a returning
  // user sees their dashboard rather than a spinner while the token is validated.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { user, hasSession } = await apiSession.initialize();

        if (cancelled || !mountedRef.current) return;

        if (!hasSession) {
          setStatus(SESSION_STATUS.SIGNED_OUT);
          return;
        }

        // Optimistic render from cache while the token is verified.
        if (user) setCurrentUser(user);

        // The stored access token is treated as expired, so this call refreshes
        // first. Its outcome is the real test of whether the session survived.
        const res = await authAPI.me();

        if (cancelled || !mountedRef.current) return;

        const freshUser = res.data.user;
        await apiSession.saveUser(freshUser);
        await establishSession(freshUser);
      } catch (err) {
        if (cancelled || !mountedRef.current) return;

        // A network failure at boot is not proof the session is invalid, but the
        // app cannot function without the API either. Signing out is the honest
        // outcome; the tokens are only cleared when the server actually rejects
        // them, which the api layer handles.
        console.warn('[app] Could not restore session:', err.message);
        setCurrentUser(null);
        setStatus(SESSION_STATUS.SIGNED_OUT);
      }
    })();

    return () => { cancelled = true; };
  }, [establishSession]);

  // ── Involuntary sign-out ────────────────────────────────────────────────────
  // Fired by the api layer when a refresh fails or a session is revoked, which
  // can happen mid-session and from any screen.
  useEffect(() => {
    return apiSession.onExpired((reason) => {
      if (!mountedRef.current) return;
      setSessionEndedReason(reason);
      resetState();
    });
  }, [resetState]);

  // ── Auth actions ────────────────────────────────────────────────────────────

  /**
   * Step 1: ask the server to text a code.
   *
   * Resolves for unregistered numbers too — the server deliberately does not
   * disclose which numbers belong to staff, so the UI advances to the code entry
   * screen either way.
   *
   * @param {string} phone as typed by the user
   * @returns {Promise<{ phone: string, expiresInSeconds: number, resendAfterSeconds: number, devCode?: string }>}
   */
  const requestOtp = useCallback(async (phone) => {
    const res = await authAPI.requestOtp(phone);
    return res.data;
  }, []);

  /**
   * Step 2: exchange the code for a session.
   *
   * @param {string} phone
   * @param {string} code
   * @returns {Promise<object>} the signed-in user
   */
  const verifyOtp = useCallback(async (phone, code) => {
    const user = await authAPI.verifyOtp(phone, code);
    await establishSession(user);
    return user;
  }, [establishSession]);

  /**
   * Signs out: revokes the session server-side, then clears local state.
   * Never rejects — the local half always happens, so the button cannot leave
   * the user stuck in a half-signed-out state.
   */
  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } finally {
      setSessionEndedReason(null);
      resetState();
    }
  }, [resetState]);

  /** Signs out of every device for this account. */
  const logoutAllDevices = useCallback(async () => {
    try {
      await authAPI.logoutAll();
    } finally {
      setSessionEndedReason(null);
      resetState();
    }
  }, [resetState]);

  /** Clears the "your session expired" notice once the login screen has shown it. */
  const acknowledgeSessionEnded = useCallback(() => setSessionEndedReason(null), []);

  const value = {
    // Session
    status,
    isBootstrapping: status === SESSION_STATUS.BOOTSTRAPPING,
    isSignedIn:      status === SESSION_STATUS.SIGNED_IN,
    currentUser,
    sessionEndedReason,
    acknowledgeSessionEnded,

    // Auth actions
    requestOtp,
    verifyOtp,
    logout,
    logoutAllDevices,

    // Shared data
    employees,
    employeesLoading,
    employeesError,
    fetchEmployees,

    // Role helpers
    isAdmin:    currentUser?.role === ROLES.ADMIN,
    isHR:       currentUser?.role === ROLES.HR,
    isEmployee: currentUser?.role === ROLES.EMPLOYEE,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside <AppProvider>');
  return ctx;
}
