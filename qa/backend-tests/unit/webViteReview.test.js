// QA review of the move of dev/web from Create React App to Vite + Vitest (branch feat/web-vite,
// 10e0484). Static guards, no servers: they read dev/web/vite.config.js, the backend's CORS
// defaults and .env.example, and the docs.
//
// QA-VITE-1: the Vite dev server listens on 127.0.0.1:3000 only and prints
// "Local: http://127.0.0.1:3000/" (CRA printed and opened http://localhost:3000). The backend's
// default CORS_ORIGINS, and the CORS_ORIGINS line developers copy from dev/backend/.env.example,
// allow only http://localhost:3000, so the printed URL loads the page but every API call is
// refused by CORS and "Entrar com GitHub" is refused by the redirect allow-list
// (utils/redirectAllowList.js uses the same list). The documented workaround, opening
// http://localhost:3000, is the one address another server can answer: on macOS a server on the
// wildcard "::" port 3000 (any host-less Node listen) coexists with Vite's 127.0.0.1:3000, Vite
// only warns ("Port 3000 is in use on a wildcard address, but 127.0.0.1:3000 is available"),
// strictPort does not stop it, and Chromium and Node resolve localhost to ::1 first and get the
// other server (QA probe, 2026-11-23). That is BUG-013's failure mode for a developer.
//
// QA-VITE-2: renamed files (.js -> .jsx) are still named by their old paths in live docs and
// source comments.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/** The origin the Vite dev server serves (and prints), from dev/web/vite.config.js. */
function viteDevOrigin() {
  const config = read('dev/web/vite.config.js');
  const host = /host:\s*'([^']+)'/.exec(config);
  const port = /port:\s*(\d+)/.exec(config);
  if (!host || !port) throw new Error('vite.config.js: server host/port not found');
  return `http://${host[1]}:${port[1]}`;
}

describe('QA-VITE-1: the web dev server origin is allowed by the backend out of the box', () => {
  const original = process.env.CORS_ORIGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = original;
  });

  it('vite.config.js serves on 127.0.0.1:3000 (what the harness and BUG-013 rely on)', () => {
    expect(viteDevOrigin()).toBe('http://127.0.0.1:3000');
  });

  it('the default CORS_ORIGINS allows the origin the dev server prints', () => {
    delete process.env.CORS_ORIGINS;
    const { allowedOrigins } = require('../../../dev/backend/src/config/cors');
    expect(allowedOrigins()).toContain(viteDevOrigin());
  });

  it('the default sign-in redirect allow-list accepts <dev server origin>/auth/callback', () => {
    delete process.env.CORS_ORIGINS;
    const { isRedirectAllowed } = require('../../../dev/backend/src/utils/redirectAllowList');
    expect(isRedirectAllowed(`${viteDevOrigin()}/auth/callback`)).toBe(true);
  });

  it('dev/backend/.env.example (what `cp .env.example .env` gives) allows it too', () => {
    const line = read('dev/backend/.env.example').split('\n').find((l) => l.startsWith('CORS_ORIGINS='));
    expect(line).toBeDefined();
    const origins = line.slice('CORS_ORIGINS='.length).split(',').map((o) => o.trim());
    expect(origins).toContain(viteDevOrigin());
  });
});

describe('QA-VITE-2: live docs and comments name the web files that exist', () => {
  // 05-bug-tracker.md is a history log (old paths are correct there); everything else is live.
  const DOCS = [
    'CLAUDE.md',
    'README.md',
    'dev/web/README.md',
    ...fs.readdirSync(path.join(REPO, 'dev/docs')).filter((f) => f.endsWith('.md')).map((f) => `dev/docs/${f}`),
    ...fs.readdirSync(path.join(REPO, 'qa/docs')).filter((f) => f.endsWith('.md') && f !== '05-bug-tracker.md').map((f) => `qa/docs/${f}`),
  ];

  function sourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'build') continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...sourceFiles(rel));
      else if (/\.(js|jsx)$/.test(entry.name)) out.push(rel);
    }
    return out;
  }

  it('every dev/web/src/... file path mentioned in live docs and in dev/ sources exists', () => {
    const files = [...DOCS, ...sourceFiles('dev/web/src'), ...sourceFiles('dev/mobile/src')];
    const missing = [];
    for (const file of files) {
      const text = read(file);
      // "dev/web/src/x.js" anywhere, and dev/docs' own "web/src/x.js" shorthand.
      for (const m of text.matchAll(/(?<![\w/])(?:dev\/)?web\/src\/[\w./-]*\w\.(?:jsx?|css)\b/g)) {
        const rel = m[0].startsWith('dev/') ? m[0] : `dev/${m[0]}`;
        if (!fs.existsSync(path.join(REPO, rel))) missing.push(`${file}: ${m[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('dev/web sources do not refer to App.js (it is App.jsx now)', () => {
    const hits = sourceFiles('dev/web/src').filter((f) => /\bApp\.js\b/.test(read(f)));
    expect(hits).toEqual([]);
  });
});
