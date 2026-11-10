// src/services/authErrors.js and src/services/sessionState.js: auth failures -> sign-in screen.
const {
  MESSAGES,
  authFailureNotice,
  httpAuthFailure,
  socketAuthFailure,
  signInFailureMessage,
  unavailableNotice,
} = require('../../../mobile/src/services/authErrors');
const { STATUS, initialSessionState, sessionReducer } = require('../../../mobile/src/services/sessionState');

describe('httpAuthFailure', () => {
  it.each([
    ['token_expired', { code: 'token_expired', error: 'Session expired, sign in again' }],
    ['token_invalid', { code: 'token_invalid' }],
    ['token_missing', { code: 'token_missing' }],
    ['an unknown code', { code: 'session_revoked' }],
  ])('turns a 401 with %s into an auth failure with that code', (_label, data) => {
    expect(httpAuthFailure({ response: { status: 401, data } })).toEqual({ code: data.code });
  });

  it('turns any 401 without a code (e.g. a proxy) into an auth failure without a code', () => {
    expect(httpAuthFailure({ response: { status: 401, data: 'Unauthorized' } })).toEqual({ code: null });
    expect(httpAuthFailure({ response: { status: 401 } })).toEqual({ code: null });
  });

  it.each([
    ['a 400', { response: { status: 400, data: { code: 'token_invalid' } } }],
    ['a 429', { response: { status: 429 } }],
    ['a 500', { response: { status: 500 } }],
    ['a network error', { message: 'Network Error' }],
    ['a timeout', { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }],
    ['nothing', undefined],
  ])('does not treat %s as an auth failure', (_label, error) => {
    expect(httpAuthFailure(error)).toBeNull();
  });
});

describe('socketAuthFailure', () => {
  it.each(['token_missing', 'token_expired', 'token_invalid'])('recognises a handshake refused with %s', (code) => {
    const error = Object.assign(new Error('refused'), { data: { code, details: ['x'] } });
    expect(socketAuthFailure(error)).toEqual({ code });
  });

  it.each([
    ['subscription_invalid', Object.assign(new Error('Invalid subscription'), { data: { code: 'subscription_invalid' } })],
    ['internal_error', Object.assign(new Error('Internal server error'), { data: { code: 'internal_error' } })],
    ['a transport error', new Error('xhr poll error')],
    ['nothing', undefined],
  ])('does not treat %s as an auth failure', (_label, error) => {
    expect(socketAuthFailure(error)).toBeNull();
  });
});

describe('messages', () => {
  it('says "Sessão expirada, entre novamente" for an expired session', () => {
    expect(authFailureNotice('token_expired')).toBe('Sessão expirada, entre novamente');
  });

  it.each(['token_invalid', 'token_missing', 'session_revoked', null])('asks to sign in again for %p', (code) => {
    expect(authFailureNotice(code)).toBe(MESSAGES.sessionInvalid);
  });

  it('maps sign-in results like the web app', () => {
    expect(signInFailureMessage({ error: 'sign_in_cancelled' })).toBe('Login cancelado');
    expect(signInFailureMessage({ error: 'sign_in_failed', reason: 'github_rate_limited' })).toBe(MESSAGES.githubRateLimited);
    expect(signInFailureMessage({ error: 'sign_in_failed', reason: 'github_unavailable' })).toBe(MESSAGES.githubUnavailable);
    expect(signInFailureMessage({ error: 'sign_in_failed', reason: '<script>' })).toBe(MESSAGES.signInFailed);
    expect(signInFailureMessage({ error: 'sign_in_failed' })).toBe(MESSAGES.signInFailed);
  });

  it('explains an unchecked session without calling it expired', () => {
    expect(unavailableNotice(429)).toBe(MESSAGES.tooManyRequests);
    expect(unavailableNotice(undefined)).toBe(MESSAGES.serverUnreachable);
    expect(unavailableNotice(503)).toBe(MESSAGES.serverUnreachable);
  });
});

describe('sessionReducer', () => {
  const signedIn = { status: STATUS.SIGNED_IN, user: { github_username: 'gaearon' }, notice: null };

  it('starts loading', () => {
    expect(initialSessionState).toEqual({ status: STATUS.LOADING, user: null, notice: null });
  });

  it('goes from the map to the sign-in screen with "Sessão expirada" on token_expired', () => {
    expect(sessionReducer(signedIn, { type: 'authFailed', code: 'token_expired' })).toEqual({
      status: STATUS.SIGNED_OUT,
      user: null,
      notice: 'Sessão expirada, entre novamente',
    });
  });

  it('goes from the map to the sign-in screen with a message on any other auth failure', () => {
    const next = sessionReducer(signedIn, { type: 'authFailed', code: 'token_invalid' });
    expect(next.status).toBe(STATUS.SIGNED_OUT);
    expect(next.user).toBeNull();
    expect(next.notice).toBe(MESSAGES.sessionInvalid);
  });

  it('signs out without a message', () => {
    expect(sessionReducer(signedIn, { type: 'signedOut' })).toEqual({ status: STATUS.SIGNED_OUT, user: null, notice: null });
  });

  it('shows the map with the signed-in user', () => {
    const user = { github_username: 'alice', name: null, avatar_url: null };
    expect(sessionReducer(initialSessionState, { type: 'signedIn', user })).toEqual({ status: STATUS.SIGNED_IN, user, notice: null });
  });

  it('keeps the sign-in screen while signing in, then explains a failure', () => {
    const signingIn = sessionReducer({ status: STATUS.SIGNED_OUT, user: null, notice: 'old' }, { type: 'signInStarted' });
    expect(signingIn).toEqual({ status: STATUS.SIGNING_IN, user: null, notice: null });
    expect(sessionReducer(signingIn, { type: 'signInFailed', result: { error: 'sign_in_cancelled' } })).toEqual({
      status: STATUS.SIGNED_OUT,
      user: null,
      notice: 'Login cancelado',
    });
  });

  it('shows "unavailable" (not signed out) when the session cannot be checked', () => {
    expect(sessionReducer(initialSessionState, { type: 'unavailable', status: 429 })).toEqual({
      status: STATUS.UNAVAILABLE,
      user: null,
      notice: MESSAGES.tooManyRequests,
    });
  });

  it('ignores unknown actions', () => {
    expect(sessionReducer(signedIn, { type: 'nope' })).toBe(signedIn);
  });
});
