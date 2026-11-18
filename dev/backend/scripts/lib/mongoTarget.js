// What an operator script may print about MONGO_URI: the hosts and the database name, never the
// credentials, the query string (it can hold options such as a TLS key password) or the URI
// itself. Used by scripts/legacy-devs.js before it connects (dev/docs/04-legacy-merge-spec.md
// AC-25).

// A host as a connection string lists it: a name or IPv4 address, or a bracketed IPv6 address,
// with an optional port. Anything else (e.g. a password with an unencoded "/" or "?" that broke
// the URI apart) is never printed.
const HOST_PATTERN = /^(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;
const DATABASE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const SCHEME_PATTERN = /^(mongodb(?:\+srv)?):\/\//;

/**
 * @param {unknown} uri - a MongoDB connection string
 * @returns {{ scheme: string, hosts: string[], database: string | null } | null} its printable
 *   parts, or null if they cannot be read safely
 */
function describeMongoTarget(uri) {
  if (typeof uri !== 'string') return null;
  const scheme = SCHEME_PATTERN.exec(uri);
  if (!scheme) return null;
  const rest = uri.slice(scheme[0].length);
  const at = rest.lastIndexOf('@');
  // Before the last "@": the credentials. A "/" or "?" in them means either an unencoded password
  // character or an "@" in the path or query: ambiguous, so nothing is printed.
  if (at !== -1 && /[/?]/.test(rest.slice(0, at))) return null;
  const afterCredentials = (at === -1 ? rest : rest.slice(at + 1)).split('?')[0];
  const slash = afterCredentials.indexOf('/');
  const hostList = slash === -1 ? afterCredentials : afterCredentials.slice(0, slash);
  const path = slash === -1 ? '' : afterCredentials.slice(slash + 1);

  const hosts = hostList.split(',');
  if (hosts.length === 0 || !hosts.every((host) => HOST_PATTERN.test(host))) return null;
  let database = null;
  if (path !== '') {
    if (!DATABASE_PATTERN.test(path)) return null;
    database = path;
  }
  return { scheme: scheme[1], hosts, database };
}

/**
 * @param {unknown} uri
 * @returns {string} one line for the operator, without credentials
 */
function formatMongoTarget(uri) {
  const target = describeMongoTarget(uri);
  if (!target) return '(could not read the host from MONGO_URI; not shown)';
  const database = target.database ? `database "${target.database}"` : 'the default database';
  return `${target.scheme}://${target.hosts.join(',')}, ${database}`;
}

/**
 * Removes MONGO_URI and its credentials from a message (a driver error) before it is printed.
 * @param {string} message
 * @param {unknown} uri
 * @returns {string}
 */
function redactMongoUri(message, uri) {
  let text = String(message);
  if (typeof uri !== 'string' || uri === '') return text;
  const secrets = [uri];
  const scheme = SCHEME_PATTERN.exec(uri);
  if (scheme) {
    const rest = uri.slice(scheme[0].length);
    const at = rest.lastIndexOf('@');
    if (at !== -1) {
      const userInfo = rest.slice(0, at);
      secrets.push(userInfo);
      const colon = userInfo.indexOf(':');
      if (colon !== -1) {
        const password = userInfo.slice(colon + 1);
        secrets.push(password);
        try {
          secrets.push(decodeURIComponent(password));
        } catch {
          // Not percent-encoded: the raw form is already listed.
        }
      }
    }
  }
  secrets
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length)
    .forEach((secret) => {
      text = text.split(secret).join('***');
    });
  return text;
}

module.exports = { describeMongoTarget, formatMongoTarget, redactMongoUri };
