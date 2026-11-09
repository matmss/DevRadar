// Holds the session for the whole app (US-7): restores it at launch, signs in and out, and sends
// the user back to the sign-in screen on any auth failure from the API (401) or the socket
// handshake (connect_error with a token code). See services/sessionState.js for the states.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';

import { setUnauthorizedHandler } from './services/api';
import { signInWithGithub, fetchCurrentUser } from './services/auth';
import { SIGN_IN_RESULT } from './services/authErrors';
import { clearToken, getToken, loadToken, saveToken } from './services/session';
import { disconnect as disconnectSocket, subscribeToAuthErrors } from './services/socket';
import { initialSessionState, sessionReducer } from './services/sessionState';

const SessionContext = createContext(null);

/** @param {unknown} err @param {number} status @returns {boolean} */
function hasStatus(err, status) {
  return Boolean(err && err.response && err.response.status === status);
}

export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  // A 401 or a refused socket handshake for `sentToken`. Ends the session only if one is active
  // and that is still its token: a late 401 for an older session must not end a newer one, and a
  // failure for a request sent without a token (nothing to end, e.g. after "Sair") must not turn
  // a voluntary sign-out into "Sua sessão não é mais válida" (QA-AUTH4-1).
  const handleAuthFailure = useCallback(async (code, sentToken) => {
    if (!sentToken) return;
    const ended = await clearToken(sentToken);
    if (!ended) return;
    disconnectSocket();
    dispatch({ type: 'authFailed', code });
  }, []);

  // Restores the stored session: GET /auth/me checks it and returns who is signed in.
  const restore = useCallback(async () => {
    dispatch({ type: 'restoring' });
    const token = await loadToken();
    if (!token) {
      dispatch({ type: 'signedOut' });
      return;
    }
    try {
      const user = await fetchCurrentUser();
      if (getToken() !== token) return;
      dispatch({ type: 'signedIn', user });
    } catch (err) {
      // A 401 already went through handleAuthFailure. Otherwise the session is unknown
      // (unreachable, timeout, 429): keep the token and say why.
      if (hasStatus(err, 401) || getToken() !== token) return;
      dispatch({ type: 'unavailable', status: err.response ? err.response.status : undefined });
    }
  }, []);

  // One sign-in at a time: a second tap on "Entrar com GitHub" before the screen re-renders with
  // the disabled button would open a second auth session with another PKCE verifier.
  const signInInFlight = useRef(false);

  const signIn = useCallback(async () => {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    try {
      dispatch({ type: 'signInStarted' });
      const result = await signInWithGithub();
      if (!result.ok) {
        dispatch({ type: 'signInFailed', result });
        return;
      }
      try {
        await saveToken(result.token);
      } catch (err) {
        console.warn('Could not store the session:', err.message);
        dispatch({ type: 'signInFailed', result: { error: SIGN_IN_RESULT.FAILED } });
        return;
      }
      dispatch({ type: 'signedIn', user: result.user });
    } finally {
      signInInFlight.current = false;
    }
  }, []);

  // "Sair": closes the socket and removes the token from secure storage. Tokens are stateless
  // JWTs, so a copy made before sign-out stays valid until it expires (no server revocation).
  const signOut = useCallback(async () => {
    disconnectSocket();
    await clearToken();
    dispatch({ type: 'signedOut' });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleAuthFailure);
    const unsubscribe = subscribeToAuthErrors(handleAuthFailure);
    return () => {
      setUnauthorizedHandler(null);
      unsubscribe();
    };
  }, [handleAuthFailure]);

  useEffect(() => {
    restore();
  }, [restore]);

  const value = useMemo(() => ({ state, signIn, signOut, retry: restore }), [state, signIn, signOut, restore]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * @returns {{ state: import('./services/sessionState').SessionState, signIn: () => Promise<void>,
 *   signOut: () => Promise<void>, retry: () => Promise<void> }}
 */
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
