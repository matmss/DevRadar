// Global error middleware (BUG-012 / QA-AUTH-2). Registered last by app.js, so every route
// answers JSON { error, code, details } instead of Express's default HTML page with a stack
// trace.
//
// Logging rule: never log `err.body`, `err.message` of body-parser errors, or request bodies.
// body-parser attaches the raw body to its errors, and JSON.parse messages quote the input, so
// either would write one-time sign-in codes (or anything else a client sent) to the logs.
// Body errors log `err.type` only; other errors log name, message and stack server-side.

/**
 * @param {Error & { type?: string, status?: number, statusCode?: number, expose?: boolean }} err
 * @returns {{ status: number, code: string, error: string, details: string[] }}
 */
function describeError(err) {
  if (err.type === 'entity.parse.failed') {
    return { status: 400, code: 'body_invalid', error: 'Invalid request body', details: ['The request body is not valid JSON'] };
  }
  if (err.type === 'entity.too.large') {
    return { status: 413, code: 'body_too_large', error: 'Request body too large', details: ['The request body exceeds the size limit'] };
  }

  const status = err.status || err.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    // http-errors marks client errors as safe to show (`expose`); body errors never get here
    // with their message, since their type was matched above or is reported generically.
    const message = err.expose && !err.type ? err.message : 'The request could not be processed';
    return { status, code: 'request_invalid', error: 'Invalid request', details: [message] };
  }

  return { status: 500, code: 'internal_error', error: 'Internal server error', details: [] };
}

/**
 * Express error-handling middleware. Must be registered after all routes.
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    // Too late to send JSON; Express's default handler closes the connection.
    next(err);
    return;
  }

  const { status, code, error, details } = describeError(err);
  if (err.type) {
    console.warn(`Rejected request to ${req.method} ${req.path}: ${err.type} (${status})`);
  } else if (status >= 500) {
    console.error(`Unhandled error on ${req.method} ${req.path}:`, err.stack || `${err.name}: ${err.message}`);
  }

  res.status(status).json({ error, code, details });
}

/**
 * Catch-all for requests no route matched (QA-AUTH-4). Registered after the routes and before
 * errorHandler, so unknown routes get JSON instead of Express's "Cannot GET" HTML page.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {void}
 */
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found', code: 'not_found', details: [] });
}

module.exports = { errorHandler, notFoundHandler, describeError };
