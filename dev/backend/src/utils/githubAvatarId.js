// The GitHub account id inside a legacy dev's avatar_url (dev/docs/04-legacy-merge-spec.md,
// section 2 and AC-6).
//
// Before sign-in existed, POST /devs looked the login up with GitHub's public
// GET https://api.github.com/users/<login> and stored the avatar_url GitHub answered with, e.g.
// https://avatars.githubusercontent.com/u/810438?v=4 (older API generations used the sharded
// hosts avatars0..3). The number is the id of the account that held the login AT REGISTRATION
// TIME: stable across renames, never reused. So, for a dev created before sign-in, it is evidence
// of who the login belonged to. It is only a hint (an anonymous registrant could type any login),
// and it is evidence only for legacy devs: since sign-in, avatar_url comes from the session's
// GitHub profile, which accepts any https URL (utils/githubProfile.js), so a dev with a github_id
// proves nothing through its avatar. legacyAvatarEvidence() enforces that.
//
// Parsing is strict on purpose: exactly https, one of GitHub's avatar hosts, no credentials, no
// port, the path /u/<id> and at most the `v`/`s` query parameters GitHub adds. Anything else
// (Gravatar, /in/<app id> for GitHub Apps, other hosts, look-alike hosts, seed data) carries no
// evidence. Used by the operator CLI (scripts/legacy-devs.js) and by the server-side claim guard
// (services/devOwnership.js, dev/docs/05-claim-guard-spec.md, B1).
const { isValidGithubId, isLegacyDoc } = require('./githubId');

// GitHub's avatar hosts: the current one and the older sharded ones (avatars0..avatars3).
const AVATAR_HOST_PATTERN = '(avatars[0-3]?\\.githubusercontent\\.com)';
// A user id: decimal, no sign, no leading zero (so never 0). The length cap keeps Number() exact
// enough for isValidGithubId to reject anything above MAX_SAFE_INTEGER.
const USER_ID_PATTERN = '([1-9]\\d{0,15})';
// GitHub's cache-busting version (?v=4) and size (?s=460) parameters, nothing else.
const QUERY_PARAM = '(?:v=\\d{1,3}|s=\\d{1,4})';
const AVATAR_URL_PATTERN = new RegExp(
  `^https://${AVATAR_HOST_PATTERN}/u/${USER_ID_PATTERN}(?:\\?${QUERY_PARAM}(?:&${QUERY_PARAM})?)?$`
);

// Longer values are not GitHub avatar URLs (cleanAvatarUrl caps stored ones at 300 bytes too).
const MAX_AVATAR_URL_LENGTH = 300;

const AVATAR_ID_STATUS = Object.freeze({
  PARSED: 'parsed', // a GitHub user id was found
  UNPARSEABLE: 'unparseable', // a value, but not a GitHub user avatar URL: no evidence
  NONE: 'none', // no value (missing, null, or empty): no evidence
  NOT_LEGACY: 'not_legacy', // the dev has a github_id: its avatar is never evidence (AC-6b)
});

/**
 * @typedef {{ status: 'parsed', id: number, host: string }
 *   | { status: 'unparseable', id: null, host: string | null }
 *   | { status: 'none', id: null, host: null }} AvatarId
 * `host`: the URL's host name (lower case, never credentials) when it is a URL at all, for
 * reporting which forms occur; null otherwise.
 */

/**
 * @param {string} value
 * @returns {string | null} the host name of `value` if it parses as a URL with one
 */
function hostOf(value) {
  if (!URL.canParse(value)) return null;
  return new URL(value).hostname || null;
}

/**
 * Derives the GitHub user id from an avatar URL as GitHub's API returns it.
 * @param {unknown} avatarUrl
 * @returns {AvatarId}
 */
function parseGithubAvatarId(avatarUrl) {
  if (avatarUrl === undefined || avatarUrl === null) return { status: AVATAR_ID_STATUS.NONE, id: null, host: null };
  if (typeof avatarUrl !== 'string') return { status: AVATAR_ID_STATUS.UNPARSEABLE, id: null, host: null };
  if (avatarUrl.trim() === '') return { status: AVATAR_ID_STATUS.NONE, id: null, host: null };
  const unparseable = () => ({
    status: AVATAR_ID_STATUS.UNPARSEABLE,
    id: null,
    host: avatarUrl.length <= MAX_AVATAR_URL_LENGTH ? hostOf(avatarUrl) : null,
  });
  if (avatarUrl.length > MAX_AVATAR_URL_LENGTH) return unparseable();

  const match = AVATAR_URL_PATTERN.exec(avatarUrl);
  if (!match) return unparseable();
  const id = Number(match[2]);
  if (!isValidGithubId(id)) return unparseable();
  return { status: AVATAR_ID_STATUS.PARSED, id, host: match[1] };
}

/**
 * The avatar evidence for a dev: parsed only for a legacy dev (its stored github_id names no
 * account, utils/githubId.js isLegacyDoc, the one rule the API and the CLI share). A dev whose
 * github_id names an account is `not_legacy`, whatever its avatar_url says (AC-6b).
 * @param {{ github_id?: unknown, avatar_url?: unknown }} dev - as stored
 * @returns {AvatarId | { status: 'not_legacy', id: null, host: null }}
 */
function legacyAvatarEvidence(dev) {
  if (!isLegacyDoc(dev)) {
    return { status: AVATAR_ID_STATUS.NOT_LEGACY, id: null, host: null };
  }
  return parseGithubAvatarId(dev.avatar_url);
}

module.exports = {
  AVATAR_ID_STATUS,
  MAX_AVATAR_URL_LENGTH,
  parseGithubAvatarId,
  legacyAvatarEvidence,
};
