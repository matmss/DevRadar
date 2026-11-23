// What the profile form shows when a save or delete fails (App.js). UI strings are in Portuguese.

export const REQUEST_ERROR_MESSAGES = {
  serverUnreachable: 'Não foi possível falar com o servidor, tente novamente',
  profileBusy: 'Perfil ocupado, tente novamente.',
};

/**
 * The backend gave up on a profile write after too many concurrent changes (503 profile_busy,
 * backend utils/profileBusyError.js): nothing is wrong with the session or the profile, and a
 * retry can succeed.
 * @param {unknown} err - an axios error
 * @returns {boolean}
 */
export function isProfileBusy(err) {
  const response = err && err.response;
  return Boolean(response && response.status === 503 && response.data && response.data.code === 'profile_busy');
}

/**
 * The text to show for a failed save or delete: "busy, try again" for profile_busy, otherwise the
 * backend's `{ error, details }`, or "server unreachable" when there is no answer.
 * @param {unknown} err - an axios error
 * @returns {string}
 */
export function requestErrorMessage(err) {
  if (isProfileBusy(err)) return REQUEST_ERROR_MESSAGES.profileBusy;
  const body = err && err.response && err.response.data;
  if (!body || typeof body.error !== 'string') return REQUEST_ERROR_MESSAGES.serverUnreachable;
  const details = Array.isArray(body.details) && body.details.length > 0 ? `: ${body.details.join('; ')}` : '';
  return `${body.error}${details}`;
}
