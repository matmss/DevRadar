// Dependency hygiene guards (qa/docs/04-qa-process.md §9).
//
// Install roots: dev/backend, dev/web, dev/mobile and qa/ (the workspace root for
// qa/backend-tests, qa/web-tests, qa/mobile-tests). Each has one tracked package-lock.json;
// CI runs `npm ci` in each and Dependabot scans each. The qa/*-tests members have no lockfile
// of their own.
//
// QA-DEPS-1 (QA review of the Dependabot change): npm applies `overrides` only from the root it
// installs from, and ignores them in workspace members, so a member override silently does
// nothing (CI resolved jest-cucumber's glob 10 -> minimatch 9 and uuid < 11.1.1 while the
// alerts read "resolved"). npm 11 treats `allowScripts` the same way. Both belong in
// qa/package.json only.
//
// QA-DEPS-2/QA-DEPS-5 (retired): qa/backend-tests used to mirror dev/backend's runtime
// dependencies so that Dependabot could see them; those tests checked the mirror's floors and
// completeness. dev/backend/package-lock.json is now tracked and scanned directly, and the
// harnesses always loaded dev/backend's own copies, so the mirror is gone. The lockfile checks
// below take over: every install root has a tracked, registry-only lockfile in sync with its
// package.json.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const QA = path.join(__dirname, '..', '..');
const REPO = path.join(QA, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const INSTALL_ROOTS = ['dev/backend', 'dev/web', 'dev/mobile', 'qa'];
const QA_MEMBERS = ['backend-tests', 'web-tests', 'mobile-tests'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const REGISTRY = 'https://registry.npmjs.org/';

/** The dependency ranges a manifest (package.json or a lockfile `packages` entry) declares. */
function declared(manifest) {
  const out = {};
  for (const field of DEP_FIELDS) {
    if (manifest[field] && Object.keys(manifest[field]).length) out[field] = manifest[field];
  }
  return out;
}

/** true if .gitignore rules ignore the path (whether or not it is tracked). */
function isIgnored(relPath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', relPath], { cwd: REPO, stdio: 'ignore' });
    return true;
  } catch (err) {
    if (err.status === 1) return false; // 1 = not ignored; anything else is a real error
    throw err;
  }
}

describe('dependency hygiene (04-qa-process.md §9)', () => {
  it('QA-DEPS-1: no qa/*-tests member declares overrides or allowScripts (npm reads them from qa/package.json only)', () => {
    const misplaced = [];
    for (const member of QA_MEMBERS) {
      const pkg = readJson(path.join(QA, member, 'package.json'));
      for (const field of ['overrides', 'allowScripts']) {
        if (pkg[field] !== undefined) misplaced.push(`qa/${member}/package.json: "${field}"`);
      }
    }
    expect(misplaced).toEqual([]);
  });

  it.each(INSTALL_ROOTS)('%s has a lockfile that .gitignore does not ignore', (root) => {
    expect(fs.existsSync(path.join(REPO, root, 'package-lock.json'))).toBe(true);
    expect(isIgnored(`${root}/package-lock.json`)).toBe(false);
  });

  it.each(INSTALL_ROOTS)('%s/package-lock.json is lockfileVersion 3 and resolves only from registry.npmjs.org', (root) => {
    const lock = readJson(path.join(REPO, root, 'package-lock.json'));
    expect(lock.lockfileVersion).toBe(3);
    const foreign = Object.entries(lock.packages)
      .filter(([key, meta]) => key !== '' && !meta.link && meta.resolved && !meta.resolved.startsWith(REGISTRY))
      .map(([key, meta]) => `${key}: ${meta.resolved}`);
    expect(foreign).toEqual([]);
  });

  it.each(INSTALL_ROOTS)('%s/package-lock.json matches its package.json (and its workspaces\')', (root) => {
    const dir = path.join(REPO, root);
    const lock = readJson(path.join(dir, 'package-lock.json'));
    const pkg = readJson(path.join(dir, 'package.json'));
    expect(declared(lock.packages[''])).toEqual(declared(pkg));
    for (const member of pkg.workspaces || []) {
      expect({ [member]: declared(lock.packages[member] || {}) })
        .toEqual({ [member]: declared(readJson(path.join(dir, member, 'package.json'))) });
    }
  });
});
