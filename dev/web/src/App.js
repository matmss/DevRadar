import React, { useState, useEffect, useCallback, useRef } from 'react';
import api, { setUnauthorizedHandler } from './services/api'
import { getToken, saveToken, clearToken, SESSION_TOKEN_KEY } from './services/session';
import {
  startSignIn,
  completeSignIn,
  fetchCurrentUser,
  isSignInCallback,
  SIGN_IN_RESULT,
} from './services/auth';

import './Global.css'
import './App.css'
import './Sidebar.css'
import './Main.css'

import DevItem from './components/DevItem';
import DevForm from './components/DevForm';
import SignIn from './components/SignIn';
import SessionUser from './components/SessionUser';
import SessionUnavailable from './components/SessionUnavailable';

const MESSAGES = {
  sessionExpired: 'Sessão expirada, entre novamente',
  signInCancelled: 'Login cancelado',
  signInFailed: 'Não foi possível entrar com o GitHub, tente novamente',
  githubRateLimited: 'O GitHub está ocupado no momento, tente novamente em alguns minutos',
  githubUnavailable: 'Não foi possível falar com o GitHub, tente novamente',
  serverUnreachable: 'Não foi possível falar com o servidor, tente novamente mais tarde',
  tooManyRequests: 'Muitas tentativas em pouco tempo, tente novamente mais tarde',
  pkceUnsupported: 'Este navegador não permite entrar com segurança (use https)',
};

const SIGNED_OUT = { status: 'signedOut', user: null };

/**
 * @param {{ error: string, reason?: string }} result - a failed completeSignIn() result
 * @returns {string}
 */
function signInFailureMessage(result) {
  if (result.error === SIGN_IN_RESULT.CANCELLED) return MESSAGES.signInCancelled;
  if (result.reason === 'github_rate_limited') return MESSAGES.githubRateLimited;
  if (result.reason === 'github_unavailable') return MESSAGES.githubUnavailable;
  return MESSAGES.signInFailed;
}

/** @param {unknown} err @param {number} status @returns {boolean} */
function hasStatus(err, status) {
  return Boolean(err && err.response && err.response.status === status);
}

// Session states:
//   "loading"     restoring or re-validating the session, or finishing sign-in
//   "signedOut"   only the sign-in button (no token stored)
//   "signedIn"    user, registration form and dev list (sessionTokenRef is the token shown)
//   "unavailable" a stored session could not be checked (server unreachable or 429): the token
//                 is kept, with "Tentar novamente" and "Sair"
// The token in localStorage is shared by every tab. A tab only acts for the token it validated
// (sessionTokenRef); when another tab signs out or signs in as someone else, the `storage` event
// makes this tab follow (QA-AUTH2-3).
function App() {
  const [session, setSession] = useState({ status: 'loading', user: null });
  const [notice, setNotice] = useState(null);
  const [devs, setDevs] = useState([]);
  const [formError, setFormError] = useState(null);
  const sessionTokenRef = useRef(null);

  const showSignedOut = useCallback((message) => {
    sessionTokenRef.current = null;
    setSession(SIGNED_OUT);
    setDevs([]);
    setFormError(null);
    setNotice(message);
  }, []);

  // Signed out by the user ("Sair": always clears the stored token, which also signs out the
  // other tabs).
  const endSession = useCallback(() => {
    clearToken();
    showSignedOut(null);
  }, [showSignedOut]);

  // Validates whatever token is stored now (GET /auth/me) and shows its user.
  const restoreStoredSession = useCallback(async () => {
    const token = getToken();
    if (!token) {
      showSignedOut(null);
      return;
    }

    sessionTokenRef.current = null;
    setSession({ status: 'loading', user: null });
    setFormError(null);
    try {
      const user = await fetchCurrentUser();
      // Another tab changed the session meanwhile: its storage event re-validates again.
      if (getToken() !== token) return;
      sessionTokenRef.current = token;
      setNotice(null);
      setSession({ status: 'signedIn', user });
    } catch (err) {
      // A 401 already went through handleUnauthorized. Otherwise the session is unknown: keep
      // the token, and say why (429: try later, not "expired").
      if (hasStatus(err, 401) || getToken() !== token) return;
      setNotice(hasStatus(err, 429) ? MESSAGES.tooManyRequests : MESSAGES.serverUnreachable);
      setSession({ status: 'unavailable', user: null });
    }
  }, [showSignedOut]);

  // Any 401 (QA-AUTH2-4) ends the session it was sent with: "token_expired" shows the expired
  // message, any other or missing code the plain signed-out view. The stored token is cleared only
  // if it is still the one the failing request carried: if another tab saved a new session since,
  // that one is kept and re-validated instead.
  const handleUnauthorized = useCallback((code, sentToken) => {
    if (!clearToken(sentToken)) {
      restoreStoredSession();
      return;
    }
    showSignedOut(code === 'token_expired' ? MESSAGES.sessionExpired : null);
  }, [restoreStoredSession, showSignedOut]);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, [handleUnauthorized]);

  // Follow sign-in and sign-out in other tabs (the event fires only in the other tabs).
  useEffect(() => {
    function handleStorage(event) {
      if (event.storageArea !== window.localStorage) return;
      if (event.key !== null && event.key !== SESSION_TOKEN_KEY) return;
      const token = getToken();
      if (token !== null && token === sessionTokenRef.current) return;
      if (token === null) {
        showSignedOut(null);
        return;
      }
      restoreStoredSession();
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [restoreStoredSession, showSignedOut]);

  useEffect(() => {
    async function start() {
      if (!isSignInCallback()) {
        await restoreStoredSession();
        return;
      }

      const result = await completeSignIn();
      if (result.ok) {
        saveToken(result.token);
        sessionTokenRef.current = result.token;
        setNotice(null);
        setSession({ status: 'signedIn', user: result.user });
        return;
      }
      // QA-AUTH2-5: a callback that does not complete a sign-in (e.g. a link opened while signed
      // in, or forwarded from elsewhere) never touches a stored session: the stored session is
      // restored as on any load. Only a successful sign-in replaces the token.
      if (getToken()) {
        await restoreStoredSession();
        return;
      }
      showSignedOut(signInFailureMessage(result));
    }

    start();
  }, [restoreStoredSession, showSignedOut]);

  useEffect(() => {
    if (session.status !== 'signedIn') return;

    async function loadDevs(){
      try {
        const response = await api.get('/devs');

        setDevs(response.data);
      } catch (err) {
        if (!hasStatus(err, 401)) console.warn('Could not load developers:', err.message);
      }
    }

    loadDevs();
  }, [session.status, session.user]);

  async function handleSignIn() {
    setNotice(null);
    try {
      await startSignIn();
    } catch (err) {
      console.warn('Could not start sign-in:', err.message);
      setNotice(MESSAGES.pkceUnsupported);
      throw err;
    }
  }

  async function handleAddDev(data) {
    setFormError(null);

    // Only register as the user this tab shows: if another tab changed the stored session,
    // re-validate first instead of sending someone else's token (QA-AUTH2-3).
    if (getToken() !== sessionTokenRef.current) {
      restoreStoredSession();
      throw new Error('The session changed in another tab');
    }

    try {
      const response = await api.post('/devs', data);

      // The backend returns the existing record when the dev is already registered.
      if (!devs.some(dev => dev._id === response.data._id)) {
        setDevs([...devs, response.data]);
      }
    } catch (err) {
      // Any 401 switches to the signed-out view (handleUnauthorized).
      if (!hasStatus(err, 401)) {
        const body = err.response && err.response.data;
        const details = body && Array.isArray(body.details) && body.details.length > 0
          ? `: ${body.details.join('; ')}`
          : '';
        setFormError(body && body.error
          ? `${body.error}${details}`
          : 'Could not reach the server, try again later');
      }

      // Rethrow so DevForm keeps the user's input instead of clearing it.
      throw err;
    }
  }

  if (session.status === 'loading') {
    return (
      <div id="app">
        <p className="app-loading">Carregando...</p>
      </div>
    );
  }

  if (session.status === 'unavailable') {
    return (
      <div id="app">
        <SessionUnavailable notice={notice} onRetry={restoreStoredSession} onSignOut={endSession} />
      </div>
    );
  }

  if (session.status === 'signedOut') {
    return (
      <div id="app">
        <SignIn notice={notice} onSignIn={handleSignIn} />
      </div>
    );
  }

  return (
    <div id="app">
      <aside>
        <SessionUser user={session.user} onSignOut={endSession} />
        <strong>Cadastro</strong>
        <DevForm onSubmit={handleAddDev} />
        {formError && <p className="form-error" role="alert">{formError}</p>}
      </aside>

      <main>
        <ul>
          {devs.map(dev => (
            <DevItem key={dev._id} dev={dev} />
          ))}
        </ul>
      </main>
    </div>
  );
}

export default App;
