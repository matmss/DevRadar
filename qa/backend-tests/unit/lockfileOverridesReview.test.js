// QA review of the lockfile-tracking change (QA-DEPS-6).
//
// Every install root now has a committed lockfile and CI installs with `npm ci`, so what runs is
// whatever the lockfile says. dependencyOverrides.test.js checks that each lockfile "matches its
// package.json", but it only compares dependency ranges; `overrides` are not recorded in a
// lockfile and are not compared. npm does not reliably notice either: in the qa/ workspace,
// raising an existing override ("uuid": "^11.1.0" -> "^12.0.0") and running `npm install` leaves
// uuid 11.1.1 in qa/package-lock.json, and `npm ci` then passes and installs 11.1.1, although
// `npm ls` reports `uuid@11.1.1 invalid: "^12.0.0"`. So an override can be declared in a
// package.json and not be in force, which is the QA-DEPS-1 failure mode again (a fix that only
// looks applied), this time between a root's package.json and its own lockfile.
//
// The guard: for every string override in an install root's package.json, every locked copy of
// that package that the override's key selects must satisfy the override's value. A version-keyed
// override ("glob@^10": "^14.0.2") selects only the locked copies inside its key range, so a stale
// glob 10.x fails and an unrelated glob 7.x does not. Unkeyed overrides select every copy.
// Object overrides are checked through their "." value only; `$name` references are skipped.
//
// `semver` is declared in qa/backend-tests' devDependencies (it is also hoisted for jest and cucumber).
const fs = require('fs');
const path = require('path');
const semver = require('semver');

const REPO = path.join(__dirname, '..', '..', '..');
const INSTALL_ROOTS = ['dev/backend', 'dev/web', 'dev/mobile', 'qa'];
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** "glob@^10" -> { name: 'glob', range: '^10' }; "uuid" -> { name: 'uuid', range: '*' }; scoped names work too. */
function parseOverrideKey(key) {
  const at = key.lastIndexOf('@');
  if (at > 0) return { name: key.slice(0, at), range: key.slice(at + 1) };
  return { name: key, range: '*' };
}

/** The value an override forces, or null when this check can't evaluate it. */
function overrideValue(value) {
  if (typeof value === 'string') return value.startsWith('$') ? null : value;
  if (value && typeof value === 'object' && typeof value['.'] === 'string') return overrideValue(value['.']);
  return null;
}

/** Every [lockfile key, version] for a package name, at any nesting depth. */
function lockedCopies(lock, name) {
  return Object.entries(lock.packages)
    .filter(([key, meta]) => key.endsWith(`node_modules/${name}`) && !meta.link && meta.version)
    .map(([key, meta]) => [key, meta.version]);
}

/** Returns one line per locked copy that the root's overrides select but do not allow. */
function unhonoredOverrides(pkg, lock) {
  const problems = [];
  for (const [key, rawValue] of Object.entries(pkg.overrides || {})) {
    const value = overrideValue(rawValue);
    if (!value) continue;
    const { name, range } = parseOverrideKey(key);
    for (const [lockKey, version] of lockedCopies(lock, name)) {
      const selected = semver.satisfies(version, range, { includePrerelease: true });
      if (selected && !semver.satisfies(version, value, { includePrerelease: true })) {
        problems.push(`${lockKey}@${version} does not satisfy override "${key}": "${value}"`);
      }
    }
  }
  return problems;
}

describe('lockfiles honor the declared overrides (QA review, QA-DEPS-6)', () => {
  it.each(INSTALL_ROOTS)('QA-DEPS-6: every override in %s/package.json is in force in its package-lock.json', (root) => {
    const dir = path.join(REPO, root);
    const pkg = readJson(path.join(dir, 'package.json'));
    const lock = readJson(path.join(dir, 'package-lock.json'));
    expect(unhonoredOverrides(pkg, lock)).toEqual([]);
  });

  // Self-checks of the matcher, so the guard can't pass vacuously.
  it('QA-DEPS-6 matcher: a raised unkeyed override that the lockfile still predates is reported', () => {
    const lock = { packages: { '': {}, 'node_modules/uuid': { version: '11.1.1' } } };
    expect(unhonoredOverrides({ overrides: { uuid: '^12.0.0' } }, lock)).toEqual([
      'node_modules/uuid@11.1.1 does not satisfy override "uuid": "^12.0.0"',
    ]);
  });

  it('QA-DEPS-6 matcher: a version-keyed override only judges the copies inside its key range', () => {
    const lock = {
      packages: {
        '': {},
        'node_modules/glob': { version: '14.0.6' },
        'node_modules/a/node_modules/glob': { version: '7.2.3' },
        'node_modules/b/node_modules/glob': { version: '10.4.5' },
        'node_modules/@scope/glob': { version: '1.0.0' },
      },
    };
    expect(unhonoredOverrides({ overrides: { 'glob@^10': '^14.0.2' } }, lock)).toEqual([
      'node_modules/b/node_modules/glob@10.4.5 does not satisfy override "glob@^10": "^14.0.2"',
    ]);
  });
});
