const { errorHandler, describeError } = require('../../../dev/backend/src/middleware/errorHandler');

function fakeRes({ headersSent = false } = {}) {
  const res = { statusCode: 200, body: undefined, headersSent };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function bodyParserError(type, status, body) {
  // Shaped like body-parser's errors: message quotes the input, raw body attached.
  return Object.assign(new Error(`Unexpected token in JSON: ${body}`), { type, status, statusCode: status, body, expose: true });
}

describe('errorHandler', () => {
  let warn;
  let error;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  const req = { method: 'POST', path: '/auth/token' };

  function run(err, res = fakeRes()) {
    const next = jest.fn();
    errorHandler(err, req, res, next);
    return { res, next };
  }

  function logged() {
    return [...warn.mock.calls, ...error.mock.calls].map((args) => args.join(' ')).join('\n');
  }

  it('maps a JSON parse failure to 400 body_invalid', () => {
    const { res } = run(bodyParserError('entity.parse.failed', 400, '{"code":"secret-code",}'));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String), code: 'body_invalid', details: expect.any(Array) });
  });

  it('maps an oversized body to 413 body_too_large', () => {
    const { res } = run(bodyParserError('entity.too.large', 413, undefined));
    expect(res.statusCode).toBe(413);
    expect(res.body.code).toBe('body_too_large');
  });

  it('never logs or returns the raw body or the parse message', () => {
    const { res } = run(bodyParserError('entity.parse.failed', 400, '{"code":"secret-code",}'));
    expect(JSON.stringify(res.body)).not.toContain('secret-code');
    expect(logged()).not.toContain('secret-code');
    expect(logged()).toContain('entity.parse.failed');
  });

  it('hides the message of other body-parser 4xx errors', () => {
    const { res } = run(bodyParserError('charset.unsupported', 415, 'secret-code'));
    expect(res.statusCode).toBe(415);
    expect(res.body.code).toBe('request_invalid');
    expect(JSON.stringify(res.body)).not.toContain('secret-code');
    expect(logged()).not.toContain('secret-code');
  });

  it('keeps the status of other client errors', () => {
    const err = Object.assign(new Error('Not acceptable'), { status: 406, expose: true });
    const { res } = run(err);
    expect(res.statusCode).toBe(406);
    expect(res.body).toEqual({ error: 'Invalid request', code: 'request_invalid', details: ['Not acceptable'] });
  });

  it('does not expose messages of client errors not marked safe', () => {
    const err = Object.assign(new Error('internal detail'), { status: 409 });
    expect(describeError(err).details).toEqual(['The request could not be processed']);
  });

  it('maps everything else to 500 internal_error with no message or stack', () => {
    const { res } = run(new Error('db password is hunter2'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', code: 'internal_error', details: [] });
    expect(error).toHaveBeenCalled();
  });

  it.each([undefined, 302, 500, 503, 'oops'])('treats status %p as a server error', (status) => {
    expect(describeError(Object.assign(new Error('x'), { status })).status).toBe(500);
  });

  it('hands over to Express if the response has started', () => {
    const err = new Error('late');
    const { res, next } = run(err, fakeRes({ headersSent: true }));
    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined();
  });
});
