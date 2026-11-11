// Every HTTP server the scenarios start listens on 127.0.0.1, the address every client dials.
//
// Why: supertest (`request(app)`) starts a server with `listen(0)` and calls
// http://127.0.0.1:<port>; the realtime and CORS steps do the same with `server.listen(0)` and a
// socket.io client on 127.0.0.1. Without a host, Node listens on the dual-stack wildcard "::".
// On macOS another process may still bind 127.0.0.1 on that same port, and from then on the
// kernel delivers 127.0.0.1 connections to THAT process, not to the test server. Under machine
// load (more processes, more ports in use) a scenario then got a foreign answer: a 404 with a
// text/html body, a 400 instead of the backend's 413, a socket connect_error without `data`
// (QA re-check of auth slice 6). A port bound on 127.0.0.1 itself cannot be shared: the other
// process gets EADDRINUSE instead.
//
// Two patches, test process only:
//  - http.Server#listen: a call without a host (a port, or options without host/path) listens on
//    127.0.0.1. Listening on a host is asynchronous (address() is null until the callback), which
//    every step already waits for.
//  - supertest's Test: it read address() right after listen(0), synchronously, to build its URL.
//    It now starts listening on 127.0.0.1 and fills in the port when the request is sent.
const http = require('http');
const { Test } = require('supertest');

const LOOPBACK = '127.0.0.1';
const realListen = http.Server.prototype.listen;

/**
 * @param {unknown[]} args - the arguments of server.listen()
 * @returns {unknown[]} the same, with host 127.0.0.1 when none was given
 */
function withLoopbackHost(args) {
  const [first, second] = args;
  if (first !== null && typeof first === 'object') {
    if (first.host !== undefined || first.path !== undefined || first.fd !== undefined || first.handle !== undefined) return args;
    return [{ ...first, host: LOOPBACK }, ...args.slice(1)];
  }
  const isPort = typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first));
  if (!isPort && first !== undefined) return args; // a pipe path or a handle
  if (typeof second === 'string') return args; // host given
  return [first === undefined ? 0 : first, LOOPBACK, ...args.slice(1)];
}

http.Server.prototype.listen = function listenOnLoopback(...args) {
  return realListen.apply(this, withLoopbackHost(args));
};

const PENDING_PORT = 'pending-loopback-port';
const realEnd = Test.prototype.end;

Test.prototype.serverAddress = function loopbackServerAddress(app, path) {
  const protocol = app instanceof require('tls').Server ? 'https' : 'http';
  const addr = app.address();
  if (addr) return `${protocol}://${LOOPBACK}:${addr.port}${path}`;
  this._server = app;
  this._loopbackListening = new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, LOOPBACK, resolve);
  });
  this._loopbackUrl = (port) => `${protocol}://${LOOPBACK}:${port}${path}`;
  return `${protocol}://${LOOPBACK}:${PENDING_PORT}${path}`;
};

Test.prototype.end = function endWhenListening(fn) {
  const listening = this._loopbackListening;
  if (!listening) return realEnd.call(this, fn);
  this._loopbackListening = null;
  listening.then(
    () => {
      this.url = this._loopbackUrl(this._server.address().port);
      realEnd.call(this, fn);
    },
    (err) => fn(err)
  );
  return this;
};

module.exports = { LOOPBACK, withLoopbackHost };
