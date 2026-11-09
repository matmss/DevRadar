import React, { useState, useEffect, useCallback } from 'react';
import api, { setSessionEndedHandler } from './services/api'
import { getToken, saveToken, clearToken } from './services/session';
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

const MESSAGES = {
  sessionExpired: 'Sessão expirada, entre novamente',
  signInCancelled: 'Login cancelado',
  signInFailed: 'Não foi possível entrar com o GitHub, tente novamente',
  githubRateLimited: 'O GitHub está ocupado no momento, tente novamente em alguns minutos',
  githubUnavailable: 'Não foi possível falar com o GitHub, tente novamente',
  serverUnreachable: 'Não foi possível falar com o servidor, tente novamente mais tarde',
  pkceUnsupported: 'Este navegador não permite entrar com segurança (use https)',
};

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

/** @param {unknown} err @returns {boolean} true for an HTTP 401 (handled by the api interceptor) */
function isUnauthorized(err) {
  return Boolean(err && err.response && err.response.status === 401);
}

// Session states: "loading" (restoring the session or finishing sign-in), "signedOut" (only the
// sign-in button), "signedIn" (user, registration form and dev list).
function App() {
  const [session, setSession] = useState({ status: 'loading', user: null });
  const [notice, setNotice] = useState(null);
  const [devs, setDevs] = useState([]);
  const [formError, setFormError] = useState(null);

  // Signed out by the user (no message) or by a rejected token (api interceptor).
  const endSession = useCallback((code) => {
    clearToken();
    setSession({ status: 'signedOut', user: null });
    setDevs([]);
    setFormError(null);
    setNotice(code === 'token_expired' ? MESSAGES.sessionExpired : null);
  }, []);

  useEffect(() => {
    setSessionEndedHandler(endSession);
    return () => setSessionEndedHandler(null);
  }, [endSession]);

  useEffect(() => {
    async function restoreSession() {
      if (isSignInCallback()) {
        const result = await completeSignIn();
        if (result.ok) {
          saveToken(result.token);
          setNotice(null);
          setSession({ status: 'signedIn', user: result.user });
        } else {
          setNotice(signInFailureMessage(result));
          setSession({ status: 'signedOut', user: null });
        }
        return;
      }

      if (!getToken()) {
        setSession({ status: 'signedOut', user: null });
        return;
      }

      try {
        const user = await fetchCurrentUser();
        setSession({ status: 'signedIn', user });
      } catch (err) {
        // A rejected token already ended the session (endSession). Otherwise keep the token,
        // so a reload retries, and say the server could not be reached.
        if (isUnauthorized(err)) return;
        setNotice(MESSAGES.serverUnreachable);
        setSession({ status: 'signedOut', user: null });
      }
    }

    restoreSession();
  }, []);

  useEffect(() => {
    if (session.status !== 'signedIn') return;

    async function loadDevs(){
      try {
        const response = await api.get('/devs');

        setDevs(response.data);
      } catch (err) {
        if (!isUnauthorized(err)) console.warn('Could not load developers:', err.message);
      }
    }

    loadDevs();
  }, [session.status]);

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

    try {
      const response = await api.post('/devs', data);

      // The backend returns the existing record when the dev is already registered.
      if (!devs.some(dev => dev._id === response.data._id)) {
        setDevs([...devs, response.data]);
      }
    } catch (err) {
      // An expired or invalid session switches to the signed-out view (api interceptor).
      if (!isUnauthorized(err)) {
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
        <SessionUser user={session.user} onSignOut={() => endSession(null)} />
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
