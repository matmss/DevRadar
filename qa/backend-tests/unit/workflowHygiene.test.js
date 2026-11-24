// CI workflow hygiene guards (.github/workflows/*.yml), from the QA review of the CI-hygiene
// change (PR #78: Node 24 actions, mongod cache, release gate on the tag's commit).
//
// QA-CI-1: no workflow declares `permissions`, and the repository's default workflow token is
// read/write (`gh api repos/<owner>/<repo>/actions/permissions/workflow` ->
// "default_workflow_permissions": "write"). So every job that runs `npm ci` (third-party install
// scripts: mongodb-memory-server's postinstall, the web build tooling, ...) holds a write token,
// and actions/checkout leaves it in .git/config (persist-credentials). In release.yml that is
// the resolve job, the regression gate and the web build; only "Publish GitHub Release" needs
// `contents: write`.
//
// QA-CI-2: inputs and tag names reach shell scripts only through `env:`, never as `${{ }}` inside
// `run:` (the old zip step interpolated the tag).
//
// QA-CI-3: the mongod cache was never saved because mongodb-memory-server's postinstall (local
// mode) downloads into qa/node_modules/.cache, not the cached ~/.cache/mongodb-binaries. Every
// job that caches it must point MONGOMS_DOWNLOAD_DIR at the cached path before any `npm ci`.
//
// QA-CI-4: release.yml's resolve job checks out `refs/tags/<tag>`, and actions/checkout trims
// surrounding ASCII whitespace from `ref` (regression.yml dispatch run 44374084783 with
// `ref="ci/hygiene-actions-node24 "` checked the branch out fine). The tag input itself is not
// trimmed, so "v1.2.3 " passes the checkout and the step publishes `tag=v1.2.3 ` to the zip name
// and the release. The step must reject or normalize a tag that isn't exactly `v<x>.<y>.<z>`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const YAML = require('yaml');

const REPO = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = path.join(REPO, '.github', 'workflows');
const FILES = ['pr.yml', 'regression.yml', 'release.yml'];

const load = (file) => YAML.parse(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8'));
const steps = (job) => (job && job.steps) || [];

/** Every permission scope a `permissions:` value grants write on. */
function writeScopes(permissions) {
  if (permissions === undefined) return [];
  if (typeof permissions === 'string') return permissions === 'read-all' ? [] : [permissions];
  return Object.entries(permissions)
    .filter(([, level]) => level === 'write')
    .map(([scope]) => scope);
}

describe('QA-CI-1: workflow token permissions are least privilege', () => {
  test.each(FILES)('%s declares a top-level `permissions` with no write scope', (file) => {
    const { permissions } = load(file);
    expect(permissions).toBeDefined();
    expect(writeScopes(permissions)).toEqual([]);
  });

  test('only release.yml "Publish GitHub Release" asks for write, and only contents', () => {
    const grants = [];
    for (const file of FILES) {
      for (const [id, job] of Object.entries(load(file).jobs)) {
        for (const scope of writeScopes(job.permissions)) grants.push(`${file}:${id}:${scope}`);
      }
    }
    expect(grants).toEqual(['release.yml:github-release:contents']);
  });
});

describe('QA-CI-2: no expressions inside run scripts', () => {
  test.each(FILES)('%s passes values to `run:` through env only', (file) => {
    const offenders = [];
    for (const [id, job] of Object.entries(load(file).jobs)) {
      for (const step of steps(job)) {
        if (typeof step.run === 'string' && step.run.includes('${{')) {
          offenders.push(`${id} / ${step.name || step.run.split('\n')[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('QA-CI-3: the mongod cache path is the directory mongodb-memory-server uses', () => {
  const CACHE_STEP = 'Cache mongodb-memory-server binaries';
  const cases = [];
  for (const file of FILES) {
    for (const [id, job] of Object.entries(load(file).jobs)) {
      if (steps(job).some((s) => s.name === CACHE_STEP)) cases.push([file, id]);
    }
  }

  test('the backend and web jobs of pr.yml and regression.yml cache mongod', () => {
    expect(cases).toEqual([
      ['pr.yml', 'backend'],
      ['pr.yml', 'web'],
      ['regression.yml', 'backend'],
      ['regression.yml', 'web'],
    ]);
  });

  test.each(cases)('%s %s sets MONGOMS_DOWNLOAD_DIR to the cached path before any npm ci', (file, id) => {
    const list = steps(load(file).jobs[id]);
    const cache = list.findIndex((s) => s.name === CACHE_STEP);
    expect(list[cache].with.path).toBe('~/.cache/mongodb-binaries');

    const setter = list.findIndex(
      (s) =>
        typeof s.run === 'string' &&
        s.run.includes('echo "MONGOMS_DOWNLOAD_DIR=$HOME/.cache/mongodb-binaries" >> "$GITHUB_ENV"')
    );
    expect(setter).toBeGreaterThanOrEqual(0);
    const firstInstall = list.findIndex((s) => typeof s.run === 'string' && /\bnpm ci\b/.test(s.run));
    expect(firstInstall).toBeGreaterThan(setter);
    expect(cache).toBeLessThan(firstInstall);
  });
});

describe('QA-CI-4: release.yml publishes only an exact release tag', () => {
  const resolveStep = steps(load('release.yml').jobs.resolve).find((s) => s.id === 'resolve');

  /** Runs the resolve step's script the way the runner does (bash -e) in a repo holding `files`. */
  function runResolve(tag, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ci-resolve-'));
    try {
      for (const f of files) {
        fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
        fs.writeFileSync(path.join(dir, f), '{}\n');
      }
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
      git('init', '-q');
      git('add', '-A');
      git('-c', 'user.name=qa', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'tag');
      const out = path.join(dir, 'github_output');
      fs.writeFileSync(out, '');
      const res = spawnSync('bash', ['-e', '-c', resolveStep.run], {
        cwd: dir,
        env: { ...process.env, TAG: tag, GITHUB_OUTPUT: out },
        encoding: 'utf8',
      });
      const outputs = {};
      for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
      }
      return { status: res.status, stdout: res.stdout, outputs };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const LOCKFILES = ['dev/backend/package-lock.json', 'dev/web/package-lock.json', 'qa/package-lock.json'];

  test('the resolve step exists and reads the tag from env', () => {
    expect(resolveStep).toBeDefined();
    expect(resolveStep.env.TAG).toBe('${{ inputs.tag || github.ref_name }}');
  });

  test('a tag with all three lockfiles resolves to itself and its commit', () => {
    const r = runResolve('v1.2.3', LOCKFILES);
    expect(r.status).toBe(0);
    expect(r.outputs.tag).toBe('v1.2.3');
    expect(r.outputs.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test('a tag without the lockfiles stops with the explanation', () => {
    const r = runResolve('v0.1.0', ['dev/backend/package.json']);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('::error title=Tag predates the committed lockfiles::');
    expect(r.outputs).toEqual({});
  });

  // actions/checkout accepts "v1.2.3 " (it trims `ref`), so this is the value the step gets.
  test.each(['v1.2.3 ', 'v1.2.3\t'])('a tag input with trailing whitespace (%j) is rejected or normalized', (tag) => {
    const r = runResolve(tag, LOCKFILES);
    if (r.status === 0) expect(r.outputs.tag).toBe('v1.2.3');
    else expect(r.outputs.tag).toBeUndefined();
  });
});
