// The operator CLI for legacy profiles (dev/backend/scripts/legacy-devs.js, spec
// dev/docs/04-legacy-merge-spec.md): the parts that need no database. Its commands against
// MongoDB are covered by features/legacy-merge.feature.
const fs = require('fs');
const path = require('path');
const {
  describeMongoTarget,
  formatMongoTarget,
  redactMongoUri,
} = require('../../../dev/backend/scripts/lib/mongoTarget');
const { EXIT, HELP, parseArgs, escapeUnsafe, preflight } = require('../../../dev/backend/scripts/lib/legacyDevs');

const BACKEND = path.resolve(__dirname, '../../../dev/backend');

describe('describeMongoTarget / formatMongoTarget (AC-25: hosts and database, never credentials)', () => {
  it.each([
    ['mongodb://127.0.0.1:27017/devradar', 'mongodb://127.0.0.1:27017, database "devradar"'],
    ['mongodb://localhost', 'mongodb://localhost, the default database'],
    ['mongodb://user:pw@h1:27017,h2:27018/devradar?replicaSet=rs0', 'mongodb://h1:27017,h2:27018, database "devradar"'],
    ['mongodb+srv://user:p%40ss@cluster0.abcde.mongodb.net/devradar?retryWrites=true&w=majority',
      'mongodb+srv://cluster0.abcde.mongodb.net, database "devradar"'],
    ['mongodb://user:pa@ss@db.example.com/devradar', 'mongodb://db.example.com, database "devradar"'],
    ['mongodb://[::1]:27017/devradar', 'mongodb://[::1]:27017, database "devradar"'],
  ])('%s -> %s', (uri, line) => {
    expect(formatMongoTarget(uri)).toBe(line);
  });

  it.each([
    ['a password with an unencoded slash', 'mongodb://user:pa/ss@db.example.com/devradar'],
    ['a password with an unencoded question mark', 'mongodb://user:pa?ss@db.example.com/devradar'],
    ['a numeric password with an unencoded question mark', 'mongodb://user:1234?5@db.example.com/devradar'],
    ['an "@" in the query', 'mongodb://db.example.com/devradar?tlsCertificateKeyFilePassword=pa@ss'],
    ['another scheme', 'postgres://user:pw@db.example.com/devradar'],
    ['not a URI', 'devradar'],
    ['empty', ''],
  ])('prints nothing from the URI when it cannot be read safely (%s)', (_case, uri) => {
    expect(describeMongoTarget(uri)).toBeNull();
    const line = formatMongoTarget(uri);
    expect(line).toBe('(could not read the host from MONGO_URI; not shown)');
    expect(line).not.toMatch(/pa|ss|user|pw/);
  });

  it('never shows query options (they can hold a key password)', () => {
    const line = formatMongoTarget('mongodb://h/devradar?tlsCertificateKeyFilePassword=k3y');
    expect(line).not.toContain('k3y');
    expect(line).not.toContain('tls');
  });
});

describe('redactMongoUri', () => {
  const uri = 'mongodb+srv://operator:p%40ss-w0rd@cluster0.example.net/devradar';

  it('removes the URI, the user info and the password (raw and decoded) from a message', () => {
    const message = `failed for ${uri}; user operator:p%40ss-w0rd; password p@ss-w0rd; raw p%40ss-w0rd`;
    const redacted = redactMongoUri(message, uri);
    expect(redacted).not.toContain('p@ss-w0rd');
    expect(redacted).not.toContain('p%40ss-w0rd');
    expect(redacted).not.toContain(uri);
    expect(redacted).toContain('***');
  });

  it('leaves messages alone without a URI', () => {
    expect(redactMongoUri('connect ECONNREFUSED 127.0.0.1:27017', undefined)).toBe('connect ECONNREFUSED 127.0.0.1:27017');
  });
});

describe('parseArgs', () => {
  it.each([
    [['list'], { command: 'list', positionals: [], options: {} }],
    [['list', '--json'], { command: 'list', positionals: [], options: { json: true } }],
    [['assign', 'abc', '--github-id', '501'], { command: 'assign', positionals: ['abc'], options: { 'github-id': '501' } }],
    [['assign', 'abc', '--github-id=501', '--force', '--apply'],
      { command: 'assign', positionals: ['abc'], options: { 'github-id': '501', force: true, apply: true } }],
    [['merge', 'abc', '--into', 'def', '--apply'], { command: 'merge', positionals: ['abc'], options: { into: 'def', apply: true } }],
    [['restore', 'record.json'], { command: 'restore', positionals: ['record.json'], options: {} }],
  ])('%p', (argv, parsed) => {
    expect(parseArgs(argv)).toEqual(parsed);
  });

  it.each([[[]], [['help']], [['--help']], [['-h']], [['merge', '--help']]])('%p is help', (argv) => {
    expect(parseArgs(argv).command).toBe('help');
  });

  it.each([
    ['an unknown command', ['adopt', 'x']],
    ['an unknown option', ['list', '--all']],
    ['an option of another command', ['list', '--apply']],
    ['a single-dash option', ['list', '-j']],
    ['a value for a switch', ['assign', 'x', '--apply=yes', '--github-id', '1']],
    ['a missing value', ['assign', 'x', '--github-id']],
    ['an empty value', ['assign', 'x', '--github-id=']],
    ['a flag instead of a value', ['merge', 'x', '--into', '--apply']],
    ['an option twice', ['assign', 'x', '--apply', '--apply', '--from-avatar']],
    ['a missing _id', ['assign', '--github-id', '1']],
    ['two _ids', ['merge', 'x', 'y', '--into', 'z']],
    ['an argument to list', ['list', 'extra']],
  ])('rejects %s as invalid usage', (_case, argv) => {
    expect(() => parseArgs(argv)).toThrow(expect.objectContaining({ exitCode: EXIT.USAGE }));
  });

  it.each([
    ['--mongo-uri', ['list', '--mongo-uri=mongodb://operator:hunter2@db.example.com/devradar']],
    ['--uri', ['list', '--uri', 'mongodb://operator:hunter2@db.example.com/devradar']],
    ['a positional', ['list', 'mongodb://operator:hunter2@db.example.com/devradar']],
  ])('takes no connection string (%s) and never echoes it', (_case, argv) => {
    let error;
    try {
      parseArgs(argv);
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect(error.exitCode).toBe(EXIT.USAGE);
    expect(error.message).not.toMatch(/hunter2|operator|db\.example\.com|mongodb:/);
  });
});

describe('escapeUnsafe: database text cannot drive the terminal', () => {
  const char = (codePoint) => String.fromCodePoint(codePoint);
  const backslashU = (hex) => `${String.fromCharCode(0x5c)}u${hex}`;

  it.each([
    [0x00, '0000'], [0x07, '0007'], [0x0a, '000a'], [0x1b, '001b'], [0x7f, '007f'], [0x9b, '009b'],
    [0x061c, '061c'], [0x200e, '200e'], [0x200f, '200f'], [0x2028, '2028'], [0x2029, '2029'],
    [0x202a, '202a'], [0x202e, '202e'], [0x2066, '2066'], [0x2069, '2069'],
  ])('escapes U+%s', (codePoint, hex) => {
    expect(escapeUnsafe(`a${char(codePoint)}b`)).toBe(`a${backslashU(hex)}b`);
  });

  it('keeps ordinary text, including accents and emoji-free non-Latin scripts', () => {
    expect(escapeUnsafe('Perfil do GitHub indisponível, Ação, 東京')).toBe('Perfil do GitHub indisponível, Ação, 東京');
  });

  it('keeps JSON valid', () => {
    const value = { name: `x${char(0x202e)}y${char(0x9b)}z` };
    const line = escapeUnsafe(JSON.stringify(value));
    expect(JSON.parse(line)).toEqual(value);
    expect([...line].every((c) => c.codePointAt(0) >= 0x20 && c.codePointAt(0) < 0x7f)).toBe(true);
  });
});

describe('help (AC-22)', () => {
  it('states that no live event is sent and when clients see the change', () => {
    expect(HELP).toContain('No Socket.io event is ever sent: connected clients see changes on their next search, reload or');
    expect(HELP).toContain('Dry run by default');
    expect(HELP).toContain('never from an\noption');
  });
});

/** @param {string} dir @returns {string[]} every .js file under `dir` */
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** @param {string} file @returns {string[]} the module ids it requires */
function requiresOf(file) {
  return [...fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
}

describe('preflight: restore checks its file before any connection', () => {
  const collect = () => {
    const lines = [];
    return { lines, out: { log: (line) => lines.push(line), error: (line) => lines.push(line) } };
  };

  it('stops a missing file as invalid usage', () => {
    const { lines, out } = collect();
    expect(preflight({ command: 'restore', positionals: ['/nonexistent/devradar-record.json'] }, out)).toBe(EXIT.USAGE);
    expect(lines.join('\n')).toContain('Cannot read the recovery file');
  });

  it('refuses a record with a github_id', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'devradar-preflight-'));
    const file = path.join(dir, 'record.json');
    fs.writeFileSync(file, '{"_id":{"$oid":"0123456789abcdef01234567"},"github_id":{"$numberInt":"7"},"github_username":"x","techs":[]}');
    const { lines, out } = collect();
    try {
      expect(preflight({ command: 'restore', positionals: [file] }, out)).toBe(EXIT.REFUSED);
      expect(lines.join('\n')).toContain('the record has a github_id');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets every other command through', () => {
    const { out } = collect();
    expect(preflight({ command: 'list', positionals: [] }, out)).toBeNull();
  });
});

describe('isolation from the API (AC-23, AC-24, AC-25)', () => {
  const scriptFiles = jsFiles(path.join(BACKEND, 'scripts'));

  it('finds the tool', () => {
    expect(scriptFiles.map((file) => path.relative(BACKEND, file)).sort())
      .toEqual(['scripts/legacy-devs.js', 'scripts/lib/legacyDevs.js', 'scripts/lib/mongoTarget.js']);
  });

  it('the API never loads the tool', () => {
    jsFiles(path.join(BACKEND, 'src')).forEach((file) => {
      requiresOf(file).forEach((id) => expect(`${path.relative(BACKEND, file)}: ${id}`).not.toMatch(/scripts\//));
    });
  });

  it('the tool makes no HTTP call and takes no API lock or socket', () => {
    const forbidden = /^(node:)?(https?|http2|net|tls|dgram)$|axios|socket\.io|websocket|devEvents|devOwnership|keyedQueue/;
    scriptFiles.forEach((file) => {
      requiresOf(file).forEach((id) => expect(`${path.relative(BACKEND, file)}: ${id}`).not.toMatch(forbidden));
    });
  });
});
