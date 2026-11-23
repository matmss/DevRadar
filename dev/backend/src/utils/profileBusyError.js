// The one server-side failure a client should simply retry: a profile write (services/devOwnership.js)
// gave up after losing too many races against concurrent changes to the same records (its retry
// cap, MAX_ATTEMPTS / MAX_ROUNDS). Nothing is broken and nothing was half-written (every write is
// one conditional update), so middleware/errorHandler.js answers 503 profile_busy with a
// Retry-After header instead of 500 internal_error. Only this error type is mapped: an arbitrary
// error carrying a 5xx `status` stays a 500.

const PROFILE_BUSY = Object.freeze({
  status: 503,
  code: 'profile_busy',
  error: 'Profile is busy',
  details: Object.freeze(['Too many concurrent changes to this profile; try again']),
  // Seconds, for the Retry-After header: the races that cause this last milliseconds.
  retryAfterSeconds: 1,
});

class ProfileBusyError extends Error {
  /**
   * @param {string} message - which retry loop gave up (server-side only, never sent or logged
   *   by the error handler)
   */
  constructor(message) {
    super(message);
    this.name = 'ProfileBusyError';
    this.status = PROFILE_BUSY.status;
    this.code = PROFILE_BUSY.code;
  }
}

/**
 * @param {unknown} err
 * @returns {boolean} true for a ProfileBusyError (and only for one)
 */
function isProfileBusy(err) {
  return err instanceof ProfileBusyError;
}

module.exports = { PROFILE_BUSY, ProfileBusyError, isProfileBusy };
