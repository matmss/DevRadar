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
import { upsertDev, removeDev } from './services/devList';

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
  serverUnreachableShort: 'Não foi possível falar com o servidor, tente novamente',
  profileUpdated: 'Perfil atualizado',
  profileDeleted: 'Perfil excluído',
  profileGone: 'Seu perfil não existe mais, cadastre-se novamente',
  alreadyRegistered: (dev) => `Você já tinha um perfil cadastrado (${Array.isArray(dev.techs) ? dev.techs.join(', ') : ''}). `
    + 'Os dados que você digitou estão no formulário: clique em "Atualizar" para salvá-los.',
};

// `profile` (the signed-in user's own dev, GET /devs/me):
//   undefined  not known yet (loading): the form is not shown
//   null       no profile: registration form ("Salvar")
//   object     registered: update form ("Atualizar") with "Excluir meu perfil" (US-6)
const PROFILE_UNKNOWN = undefined;

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

/**
 * The text to show for a failed save or delete: the backend's `{ error, details }`, or "server
 * unreachable" when there is no answer.
 * @param {unknown} err
 * @returns {string}
 */
function requestErrorMessage(err) {
  const body = err && err.response && err.response.data;
  if (!body || typeof body.error !== 'string') return MESSAGES.serverUnreachableShort;
  const details = Array.isArray(body.details) && body.details.length > 0 ? `: ${body.details.join('; ')}` : '';
  return `${body.error}${details}`;
}

/**
 * True only for the backend's "you have no profile" answer. Any other 404 (`not_found` from a
 * backend without these routes, a proxy or path prefix that does not route /devs/me, ...) means
 * nothing happened to the profile and is shown as an error (QA-AUTH5-1).
 * @param {unknown} err
 * @returns {boolean}
 */
function isDevNotFound(err) {
  return hasStatus(err, 404) && Boolean(err.response.data) && err.response.data.code === 'dev_not_found';
}

/**
 * Whether the dev POST /devs answered holds what the user submitted. If not, the user already
 * had a profile (another tab registered, or GET /devs/me failed) and POST returned it unchanged.
 * Compared the way the backend stores the input: techs trimmed without empty entries, numbers.
 * @param {{ techs: string[], location: { coordinates: number[] } }} dev
 * @param {{ techs: string, latitude: unknown, longitude: unknown }} submitted
 * @returns {boolean}
 */
function holdsSubmittedValues(dev, submitted) {
  const techs = String(submitted.techs).split(',').map(tech => tech.trim()).filter(Boolean);
  const coordinates = (dev.location && dev.location.coordinates) || [];
  return Array.isArray(dev.techs)
    && dev.techs.join(',') === techs.join(',')
    && coordinates[1] === Number(submitted.latitude)
    && coordinates[0] === Number(submitted.longitude);
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
  const [formNotice, setFormNotice] = useState(null);
  const [profile, setProfile] = useState(PROFILE_UNKNOWN);
  // Bumped on every save or delete: remounts DevForm so it shows the saved values (or an empty
  // registration form after a delete).
  const [formRevision, setFormRevision] = useState(0);
  // What the user typed, carried into the remounted form when the mode changes under their input.
  const [formDraft, setFormDraft] = useState(null);
  const sessionTokenRef = useRef(null);

  const showSignedOut = useCallback((message) => {
    sessionTokenRef.current = null;
    setSession(SIGNED_OUT);
    setDevs([]);
    setProfile(PROFILE_UNKNOWN);
    setFormDraft(null);
    setFormError(null);
    setFormNotice(null);
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

  // Signed in: load the dev list and the user's own profile (GET /devs/me), which decides between
  // the registration and the update form. Answers that arrive after the session changed are
  // dropped.
  useEffect(() => {
    if (session.status !== 'signedIn') return undefined;
    let current = true;
    setProfile(PROFILE_UNKNOWN);
    setFormDraft(null);
    setFormError(null);
    setFormNotice(null);

    async function loadDevs(){
      try {
        const response = await api.get('/devs');

        if (current) setDevs(response.data);
      } catch (err) {
        if (!hasStatus(err, 401)) console.warn('Could not load developers:', err.message);
      }
    }

    async function loadProfile() {
      try {
        const response = await api.get('/devs/me');
        if (current) setProfile(response.data);
      } catch (err) {
        // A 401 already went through handleUnauthorized. 404: not registered yet. Anything else
        // (server unreachable): offer registration anyway, since POST /devs answers with the
        // existing profile if there is one, which then switches the form to update mode.
        if (!current || hasStatus(err, 401)) return;
        if (!hasStatus(err, 404)) console.warn('Could not load your profile:', err.message);
        setProfile(null);
      }
    }

    loadDevs();
    loadProfile();
    return () => {
      current = false;
    };
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

  // Every change acts only as the user this tab shows: if another tab changed the stored
  // session, re-validate first instead of sending someone else's token (QA-AUTH2-3).
  function startProfileRequest() {
    setFormError(null);
    setFormNotice(null);
    if (getToken() !== sessionTokenRef.current) {
      restoreStoredSession();
      throw new Error('The session changed in another tab');
    }
  }

  /** Shows a failed save or delete; any 401 already switched to the signed-out view. */
  function showRequestError(err) {
    if (!hasStatus(err, 401)) setFormError(requestErrorMessage(err));
  }

  /**
   * The saved profile replaces its entry in the list, and the form is remounted in update mode
   * with the saved values, or with `draft` (the user's input) if given.
   */
  function showSavedProfile(dev, notice = null, draft = null) {
    setProfile(dev);
    setDevs(current => upsertDev(current, dev));
    setFormDraft(draft);
    setFormRevision(revision => revision + 1);
    setFormNotice(notice);
  }

  /**
   * The profile is gone: out of the list, and the form is remounted for registration, empty or
   * with `draft` (the user's input) if given.
   */
  function showProfileRemoved(removed, notice, draft = null) {
    setProfile(null);
    if (removed) setDevs(current => removeDev(current, removed));
    setFormDraft(draft);
    setFormRevision(revision => revision + 1);
    setFormNotice(notice);
  }

  // Failures are rethrown so DevForm keeps the user's input.
  async function handleAddDev(data) {
    startProfileRequest();
    let dev;
    try {
      // The backend returns the existing record when the dev is already registered.
      const response = await api.post('/devs', data);
      dev = response.data;
    } catch (err) {
      showRequestError(err);
      throw err;
    }

    if (holdsSubmittedValues(dev, data)) {
      showSavedProfile(dev);
      return;
    }
    // Already registered (another tab registered, or GET /devs/me failed): the stored profile
    // is in the list, and the user's input stays in the update form, one click from saving.
    showSavedProfile(dev, MESSAGES.alreadyRegistered(dev), data);
  }

  async function handleUpdateDev(data) {
    startProfileRequest();
    try {
      const response = await api.put('/devs/me', data);
      showSavedProfile(response.data, MESSAGES.profileUpdated);
    } catch (err) {
      // Deleted meanwhile (another tab or device): offer registration again, with the input kept.
      if (isDevNotFound(err)) {
        showProfileRemoved(profile, null, data);
        setFormError(MESSAGES.profileGone);
        return;
      }
      showRequestError(err);
      throw err;
    }
  }

  async function handleDeleteDev() {
    startProfileRequest();
    try {
      await api.delete('/devs/me');
    } catch (err) {
      // dev_not_found: already deleted (another tab, or a repeated request), which is what the
      // user wants. Any other failure, including another 404, deleted nothing (QA-AUTH5-1).
      if (!isDevNotFound(err)) {
        showRequestError(err);
        throw err;
      }
    }
    showProfileRemoved(profile, MESSAGES.profileDeleted);
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
        <strong>{profile ? 'Meu perfil' : 'Cadastro'}</strong>
        {profile === PROFILE_UNKNOWN ? (
          <p className="form-loading">Carregando seu perfil...</p>
        ) : (
          <DevForm
            key={`${profile ? profile._id : 'new'}-${formRevision}`}
            dev={profile}
            draft={formDraft}
            onSubmit={profile ? handleUpdateDev : handleAddDev}
            onDelete={handleDeleteDev}
          />
        )}
        {formNotice && <p className="form-notice" role="status">{formNotice}</p>}
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
