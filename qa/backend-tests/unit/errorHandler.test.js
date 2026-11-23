const { errorHandler, describeError } = require('../../../dev/backend/src/middleware/errorHandler');
const { ProfileBusyError } = require('../../../dev/backend/src/utils/profileBusyError');

function fakeRes({ headersSent = false } = {}) {
  const res = { statusCode: 200, body: undefined, headersSent, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = (fields) => { Object.assign(res.headers, fields); return res; };
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

  describe('profile_busy (a profile write gave up after too many concurrent changes)', () => {
    const busy = () => new ProfileBusyError('Could not take the developer login: too many concurrent changes');

    it('answers 503 profile_busy with Retry-After: 1', () => {
      const { res } = run(busy());
      expect(res.statusCode).toBe(503);
      expect(res.headers).toEqual({ 'Retry-After': '1' });
      expect(res.body).toEqual({
        error: 'Profile is busy',
        code: 'profile_busy',
        details: ['Too many concurrent changes to this profile; try again'],
      });
    });

    it('logs one warning line with the method, path and code, and no stack or message', () => {
      run(busy(), fakeRes());
      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0].join(' ');
      expect(line).toContain('POST /auth/token');
      expect(line).toContain('profile_busy');
      expect(line).not.toContain('too many concurrent changes');
      expect(line).not.toMatch(/\n|ProfileBusyError/);
    });

    it('gives every answer its own details array', () => {
      describeError(busy()).details.push('mutated');
      expect(describeError(busy()).details).toEqual(['Too many concurrent changes to this profile; try again']);
    });

    it.each([
      ['a plain Error with status 503', Object.assign(new Error('x'), { status: 503 })],
      ['a plain Error with code profile_busy', Object.assign(new Error('x'), { status: 503, code: 'profile_busy' })],
      ['an Error named ProfileBusyError', Object.assign(new Error('x'), { name: 'ProfileBusyError', status: 503 })],
    ])('is never given to %s: that stays 500 internal_error, logged as an error, no Retry-After', (_label, err) => {
      const { res } = run(err);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error', code: 'internal_error', details: [] });
      expect(res.headers).toEqual({});
      expect(error).toHaveBeenCalled();
    });
  });

  it('hands over to Express if the response has started', () => {
    const err = new Error('late');
    const { res, next } = run(err, fakeRes({ headersSent: true }));
    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined();
  });
});
