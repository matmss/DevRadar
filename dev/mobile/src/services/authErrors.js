// Maps backend auth failures and sign-in results to what the app shows. UI strings are in
// Portuguese, like the web app (dev/web/src/App.js).

export const MESSAGES = {
  sessionExpired: 'Sessão expirada, entre novamente',
  sessionInvalid: 'Sua sessão não é mais válida, entre novamente',
  signInCancelled: 'Login cancelado',
  signInFailed: 'Não foi possível entrar com o GitHub, tente novamente',
  githubRateLimited: 'O GitHub está ocupado no momento, tente novamente em alguns minutos',
  githubUnavailable: 'Não foi possível falar com o GitHub, tente novamente',
  serverUnreachable: 'Não foi possível falar com o servidor, tente novamente mais tarde',
  tooManyRequests: 'Muitas tentativas em pouco tempo, tente novamente mais tarde',
  searchFailed: 'Não foi possível buscar devs, tente novamente',
  locationDenied: 'Permita o acesso à localização para ver os devs perto de você',
  locationUnavailable: 'Não foi possível obter sua localização. Verifique se ela está ativada e tente novamente',
};

// Codes the backend uses for a rejected session token, on HTTP 401 bodies (middleware/auth.js)
// and Socket.io connect_error data (websocket.js).
export const TOKEN_ERROR = {
  MISSING: 'token_missing',
  EXPIRED: 'token_expired',
  INVALID: 'token_invalid',
};

const TOKEN_ERROR_CODES = Object.values(TOKEN_ERROR);

export const SIGN_IN_RESULT = {
  CANCELLED: 'sign_in_cancelled',
  FAILED: 'sign_in_failed',
};

/**
 * The message on the sign-in screen after the session ended because of an auth failure.
 * @param {string | null} code - the backend's code, or null if the 401 had none
 * @returns {string}
 */
export function authFailureNotice(code) {
  return code === TOKEN_ERROR.EXPIRED ? MESSAGES.sessionExpired : MESSAGES.sessionInvalid;
}

/**
 * Any HTTP 401, whatever its body (a proxy's 401 has no code), is an auth failure.
 * @param {unknown} error - an axios error
 * @returns {{ code: string | null } | null} null if this is not an auth failure
 */
export function httpAuthFailure(error) {
  const response = error && error.response;
  if (!response || response.status !== 401) return null;
  const code = response.data && typeof response.data.code === 'string' ? response.data.code : null;
  return { code };
}

/**
 * A socket handshake refused by the backend's auth middleware: connect_error with
 * `data.code` one of the token codes. Other refusals (subscription_invalid, internal_error,
 * network errors) are not auth failures.
 * @param {unknown} error - a socket.io-client connect_error
 * @returns {{ code: string } | null}
 */
export function socketAuthFailure(error) {
  const code = error && error.data && error.data.code;
  return TOKEN_ERROR_CODES.includes(code) ? { code } : null;
}

/**
 * @param {{ error: string, reason?: string | null }} result - a failed sign-in
 * @returns {string}
 */
export function signInFailureMessage(result) {
  if (result.error === SIGN_IN_RESULT.CANCELLED) return MESSAGES.signInCancelled;
  if (result.reason === 'github_rate_limited') return MESSAGES.githubRateLimited;
  if (result.reason === 'github_unavailable') return MESSAGES.githubUnavailable;
  return MESSAGES.signInFailed;
}

/**
 * Why a stored session could not be checked (not an auth failure): the token is kept.
 * @param {number | undefined} status - HTTP status, undefined for network errors and timeouts
 * @returns {string}
 */
export function unavailableNotice(status) {
  return status === 429 ? MESSAGES.tooManyRequests : MESSAGES.serverUnreachable;
}
