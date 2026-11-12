// QA review of the Dependabot/security dependency change (QA-DEPS-1, QA-DEPS-2).
//
// QA-DEPS-1: the security `overrides` of the qa/*-tests packages only apply to a standalone
// install inside that directory (`npm install --workspaces=false`), which is what Dependabot
// scans through the tracked per-suite lockfiles. Every real install of the qa workspace runs
// from qa/ (`.github/workflows/pr.yml` and regression.yml run `npm install` in qa/, and so does
// the setup in CLAUDE.md), and npm ignores `overrides` declared in workspace members: only the
// workspace root's apply. So CI resolves jest-cucumber's glob 10 -> minimatch 9 (GHSA-g3hv-75wg-m249)
// and uuid < 11.1.1 (GHSA-w5hq-g745-h8pq) although the alerts read "resolved". Verified with
// `npm install --package-lock-only` in a copy of qa/: `npm audit` 17 findings; with the same
// overrides added to qa/package.json, 11 (only deepmerge and stream-json, which have no usable fix).
//
// QA-DEPS-2: qa/backend-tests declares dev/backend's runtime dependencies as its own
// `dependencies` (the tests load dev/backend's copies). That mirror is the only place Dependabot
// sees the backend's runtime tree (its alerts are the "runtime"-scope ones), so a mirror floor
// below dev/backend's floor scans a version the backend can no longer install.
const fs = require('fs');
const path = require('path');

const QA = path.join(__dirname, '..', '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** `^1.2.3` / `~1.2.3` / `1.2.3` -> [1, 2, 3]; anything else -> null (not compared). */
function floorOf(range) {
  const match = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
  return match ? match.slice(1).map(Number) : null;
}

function isBelow(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

describe('dependency overrides and floors (QA review, QA-DEPS)', () => {
  it('QA-DEPS-1: every qa/*-tests override is also declared in qa/package.json, so the install CI runs from qa/ applies it', () => {
    const rootOverrides = readJson(path.join(QA, 'package.json')).overrides || {};
    const missing = [];
    for (const suite of ['backend-tests', 'web-tests', 'mobile-tests']) {
      const overrides = readJson(path.join(QA, suite, 'package.json')).overrides || {};
      for (const [name, spec] of Object.entries(overrides)) {
        if (JSON.stringify(rootOverrides[name]) !== JSON.stringify(spec)) {
          missing.push(`${suite}: "${name}": ${JSON.stringify(spec)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('QA-DEPS-2: the dev/backend runtime mirror in qa/backend-tests has no floor below dev/backend\'s', () => {
    const backend = readJson(path.join(QA, '..', 'dev', 'backend', 'package.json')).dependencies;
    const mirror = readJson(path.join(QA, 'backend-tests', 'package.json')).dependencies;
    const lagging = [];
    for (const [name, mirrorRange] of Object.entries(mirror)) {
      if (!backend[name]) continue;
      const mirrorFloor = floorOf(mirrorRange);
      const backendFloor = floorOf(backend[name]);
      if (mirrorFloor && backendFloor && isBelow(mirrorFloor, backendFloor)) {
        lagging.push(`${name}: qa/backend-tests ${mirrorRange} < dev/backend ${backend[name]}`);
      }
    }
    expect(lagging).toEqual([]);
  });

  // QA-DEPS-5 (re-check): 04-qa-process.md §9 now says the mirror "is the backend scan" and is
  // "the only place Dependabot sees the backend's runtime tree", but it lists 5 of dev/backend's
  // 8 runtime dependencies. jsonwebtoken (the session tokens), express-rate-limit and dotenv, and
  // their subtrees (jws, jwa, ...), are in none of the tracked lockfiles, so no alert can ever
  // be raised for them. The test harnesses load dev/backend's own jsonwebtoken
  // (features/support/session.js, web-tests auth-fixtures.js), so the mirror entries are scan-only.
  it('QA-DEPS-5: every dev/backend runtime dependency is in the qa/backend-tests mirror', () => {
    const backend = readJson(path.join(QA, '..', 'dev', 'backend', 'package.json')).dependencies;
    const mirror = readJson(path.join(QA, 'backend-tests', 'package.json')).dependencies;
    const unscanned = Object.keys(backend).filter((name) => !mirror[name]);
    expect(unscanned).toEqual([]);
  });
});
