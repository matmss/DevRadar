// What the app shows for the session, as a pure reducer (SessionProvider holds it):
//   loading      restoring the stored session at launch, or retrying
//   signedOut    the "Entrar com GitHub" screen, with an optional notice (why)
//   signingIn    the same screen while the system auth session is open
//   signedIn     the map
//   unavailable  a stored session could not be checked (server unreachable, timeout or 429):
//                the token is kept, with "Tentar novamente" and "Sair"
import {
  authFailureNotice,
  signInFailureMessage,
  unavailableNotice,
} from './authErrors';

export const STATUS = {
  LOADING: 'loading',
  SIGNED_OUT: 'signedOut',
  SIGNING_IN: 'signingIn',
  SIGNED_IN: 'signedIn',
  UNAVAILABLE: 'unavailable',
};

export const initialSessionState = { status: STATUS.LOADING, user: null, notice: null };

/**
 * @typedef {{ status: string, user: object | null, notice: string | null }} SessionState
 * @typedef {{ type: 'restoring' }
 *   | { type: 'signInStarted' }
 *   | { type: 'signedIn', user: object }
 *   | { type: 'signInFailed', result: { error: string, reason?: string } }
 *   | { type: 'authFailed', code: string | null }
 *   | { type: 'signedOut' }
 *   | { type: 'unavailable', status?: number }} SessionAction
 */

/**
 * @param {SessionState} state
 * @param {SessionAction} action
 * @returns {SessionState}
 */
export function sessionReducer(state, action) {
  switch (action.type) {
    case 'restoring':
      return { status: STATUS.LOADING, user: null, notice: null };
    case 'signInStarted':
      return { status: STATUS.SIGNING_IN, user: null, notice: null };
    case 'signedIn':
      return { status: STATUS.SIGNED_IN, user: action.user, notice: null };
    case 'signInFailed':
      return { status: STATUS.SIGNED_OUT, user: null, notice: signInFailureMessage(action.result) };
    // Any 401 or socket auth refusal: back to sign-in with a message, never an empty map.
    case 'authFailed':
      return { status: STATUS.SIGNED_OUT, user: null, notice: authFailureNotice(action.code) };
    case 'signedOut':
      return { status: STATUS.SIGNED_OUT, user: null, notice: null };
    case 'unavailable':
      return { status: STATUS.UNAVAILABLE, user: null, notice: unavailableNotice(action.status) };
    default:
      return state;
  }
}
