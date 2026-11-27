// The error the shared stores (utils/sharedOneTimeStore.js, middleware/mongoRateLimitStore.js)
// throw when MongoDB fails them. Fail closed: it reaches the global error handler, which answers
// 500 internal_error and logs this error's stack.
//
// Its message names the operation and the driver error's class and code only, never the
// driver's message, and it does not keep the driver error (`cause`): a driver message can quote
// the document key (e.g. E11000 "dup key: { _id: ... }"), and those keys are client IPs,
// account ids or hashes of sign-in values.

class SharedStateError extends Error {
  /**
   * @param {string} operation - e.g. "rate_limits increment"
   * @param {unknown} driverError
   */
  constructor(operation, driverError) {
    super(`${operation} failed: ${describeDriverError(driverError)}`);
    this.name = 'SharedStateError';
  }
}

/**
 * @param {unknown} err
 * @returns {string} the error's class and code, e.g. "MongoServerError (code 11000 DuplicateKey)"
 */
function describeDriverError(err) {
  if (!err || typeof err !== 'object') return 'unknown error';
  const name = typeof err.name === 'string' && /^\w{1,64}$/.test(err.name) ? err.name : 'Error';
  const code = Number.isInteger(err.code) ? ` ${err.code}` : '';
  const codeName = typeof err.codeName === 'string' && /^\w{1,64}$/.test(err.codeName) ? ` ${err.codeName}` : '';
  return code || codeName ? `${name} (code${code}${codeName})` : name;
}

/**
 * Runs one MongoDB operation, turning any failure into a SharedStateError.
 * @template T
 * @param {string} operation
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function sharedStateOperation(operation, run) {
  try {
    return await run();
  } catch (err) {
    throw new SharedStateError(operation, err);
  }
}

module.exports = { SharedStateError, describeDriverError, sharedStateOperation };
