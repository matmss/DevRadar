# DevRadar: displaced legacy profiles need a manual merge

Status: **decided (section 8); option A implemented** as `dev/backend/scripts/legacy-devs.js`
(runbook in `dev/docs/00-architecture.md`, "Displaced legacy devs"; tests in
`qa/backend-tests/features/legacy-merge.feature`). B1 is implemented as
`dev/docs/05-claim-guard-spec.md` (claim guard; `list` gained `claimable_by`). Beyond section 6 the
tool has `restore <file>`, the recovery path for `merge`. By the main session's decision of
2026-11-18 (QA review) it always restores the record as a **displaced** dev (login
`_stale_<_id>`, stale flag, original login printed) after checking it against the Dev schema (no
`github_id`, no future `github_username_seen_at`). So a restored or crafted record can never
become a dev that is claimable by login, the premise of section 2 and of B1 holds (no new legacy
devs arise), and only `assign` gives a restored dev an owner. Written by the
PO agent against `main` at `eee2d97`. This defines **what** to build and how we accept it; **how**
is DEV's. Follows `dev/docs/03-auth-spec.md` (Q5, Q10, US-8) and `dev/docs/00-architecture.md`
("Profile ownership"). Backlog item: "displaced legacy profiles need a manual merge".

## 1. Problem

### How a displaced legacy dev arises
1. Before sign-in existed, anyone could register a dev for a GitHub login. Those devs have no
   `github_id` ("legacy"). Their owner claims one on their first write, matched by login (Q5).
2. Owner A registered as `alice` (legacy). A renames on GitHub to `alice2` and does not sign in.
3. Account B now holds the login `alice` **and already owns a DevRadar profile**. When B signs in or
   saves, B's newer GitHub read **displaces** the legacy `alice` dev: login becomes
   `_stale_<_id>`, `github_username_stale: true`, a name that was only the login is cleared.
   Nothing else changes; it is never deleted. (If B had no profile, B would **claim** the legacy dev
   instead: that is the accepted Q5 risk, not this item.)
4. A can no longer claim it: its login is a placeholder, and no login match exists.

### What users see
- **A (the real owner):** signs in as `alice2`, `GET /devs/me` answers 404, the app shows an empty
  form. A registers a new profile. The old one keeps A's old techs and location and **cannot be
  edited or deleted by anyone** (no route reaches it).
- **Everyone else:** a second, ghost entry for A on the web list and the mobile map, shown as
  "Dev sem nome" with "Perfil do GitHub indisponível" and no GitHub link. It never goes away.
- **Operator:** no tool to find, attribute or retire these. `dev/docs/00-architecture.md` says
  "Merging one into its real owner's profile is a manual operation", with nothing to do it with
  (today: hand-written Mongo shell commands, with no safeguards).

### Who is affected
Legacy owners who renamed on GitHub before ever signing in, and whose old login is now held by an
account that already had a profile. Expected to be a small, one-time population (pre-auth data
only; no new legacy devs can be created). **We do not know the real count** (open question 1).

## 2. Evidence: can a legacy dev's `avatar_url` identify its owner?

Hypothesis from the main session: pre-auth `POST /devs` fetched `https://api.github.com/users/<login>`
server-side and stored GitHub's `avatar_url`, of the form
`https://avatars.githubusercontent.com/u/<numeric id>?v=4`, so the stored URL carries the GitHub
numeric id of the account that held the login **at registration time**.

### What I verified from the tree at `eee2d97`
- `qa/docs/01-requirements.md` FR-1.2 (reverse-engineered from the pre-auth code): registration
  "shall look up the given GitHub username via the GitHub public API and populate `name`,
  `avatar_url`, and `bio`", and the Overview calls the endpoint `GET https://api.github.com/users/:username`.
  Consistent with the hypothesis.
- `Dev.avatar_url` is a plain `String`. Today it is written only from the **session token's
  `profile` claim** (`DevController.profileFields`, on POST and PUT). The token profile is built by
  the backend from GitHub's authenticated `GET /user` (`utils/githubProfile.js`,
  `sanitizeGithubProfile`), signed, and re-validated on every request
  (`isSanitizedGithubProfile`). A body `avatar_url` is ignored: the Q9 scenario in
  `qa/backend-tests/features/step_definitions/profile.steps.js` sends `avatar_url:
  'https://evil.example/avatar.png'` and expects it not to be used.
- `cleanAvatarUrl` accepts **any** absolute `https` URL without credentials up to 300 bytes. It does
  not pin the host. That is fine for display, but means **today's avatar value is not by itself
  evidence of anything**: parsing must be strict and must only ever be applied to devs that have no
  `github_id`.
- Displacement (`displace()`) rewrites only login, stale flag, `seen_at` and (maybe) name. The
  avatar survives displacement. A **claim** keeps the avatar until the owner's next `PUT`, which
  overwrites it from the token (so after claim + PUT the evidence is gone; irrelevant then, the dev
  has a `github_id`).

### What I could NOT verify (needs the main session)
This agent has no shell, so I could not read git history. Please confirm before DEV relies on it:
- `git log --follow -p -- dev/backend/src/controllers/DevController.js` and
  `git log -S avatar_url --oneline -- dev/backend` : every historical version of registration, and
  that **no** version (POST, or any old update path) took `avatar_url` from the request body, or fell
  back to a client value when the GitHub lookup failed.
- Run the read-only `list` command (AC-1) against the real data first: it reports how many legacy
  avatars parse, which host/forms occur, and duplicates. That settles the form question empirically.

### Forms GitHub can return (from general knowledge; confirm against the data)
- Current API: `https://avatars.githubusercontent.com/u/<id>?v=4`. Older API generations (and the
  2020-era bootcamp template this app descends from) used sharded hosts
  `https://avatars0..3.githubusercontent.com/u/<id>?v=3|4`. The id is the **user id**, stable across
  renames and across avatar changes (only `?v=` changes). GitHub ids are never reused.
- Very old API responses used Gravatar (`https://secure.gravatar.com/avatar/<md5>`): **no id inside**.
- GitHub Apps/bots use `/in/<app id>` (a different id space): not a user id.
- GitHub Enterprise Server uses another host/path (`/avatars/u/<id>`). DevRadar's sign-in and its
  old lookup both target github.com only, so this should not occur.
- Organisations share the numeric id space with users but cannot sign in, so a legacy dev registered
  under an org login yields an id that no account will ever present.

### How trustworthy is it
- **Provenance: strong, if the hypothesis holds.** The value came from GitHub, not from the client.
- **Meaning: weaker than it looks.** It says "the login the registrant typed belonged to GitHub id N
  *when they registered*". Pre-auth, the registrant was anonymous and could type **any** login
  (this was the squatting hole closed by auth slice 2). So id N is the id of the *login holder*,
  not proof that the person who set the techs and location was N. That is exactly the trust Q5
  already extends to a login match, but **immune to renames**, which is the failure mode here.
- **Coverage: partial.** Unparseable or absent values (Gravatar, hand-edited, seed data such as
  `https://example.com/avatar.png`, null) carry no evidence.
- **Not a proof of ownership for the operator either:** the operator should still confirm with the
  owner (who can state their GitHub id / current login) before acting.

## 3. Options

Common facts used below: per-account writes run in `keyedQueue` under `github_id:<id>` keys;
`inLoginOrder` takes the account key plus, if another account's dev holds the login, that account's
key, in sorted order; **legacy devs have no key** (their claim and displacement are conditional
updates that exclude each other). The Socket.io server and `connections` live inside the API
process.

### Option A: operator CLI (`dev/backend/scripts/...`)
A script, run by an operator against the database, with `list`, `assign` and `merge`. Dry-run by
default. Ownership is decided by a **human** with the avatar id as a hint.

- **Owner already has a new profile (merge):** `merge <legacy _id> --into <own _id>` **retires** the
  legacy dev and leaves the owner's profile untouched. **Owner's data wins** (location, techs, bio,
  name, avatar, login), **owner's `_id` survives**. Printed JSON of the deleted document is the
  recovery path. (Reverse direction is open question 2.) If the owner has **no** profile, `assign`
  gives the legacy dev to the account (`github_id` set, **legacy `_id` and data kept**, login
  restored at the owner's next sign-in by existing code).
- **Duplicates (two legacy devs, same avatar id):** `list` flags both; `--from-avatar` refuses; the
  operator picks: assign one, then merge the other into it.
- **Missing/unparseable avatar id:** no hint shown; assigning needs an explicit `--github-id` and
  `--force`.
- **Live events:** **none.** A separate process cannot reach the API's sockets. Connected clients
  keep a stale marker until their next search or reconnect. Acceptable for a rare operator action;
  documented. (Pushing events would need an admin endpoint: roles/admin are out of scope in the auth
  spec.)
- **Queue / lock order:** runs outside the API's in-memory queues, so it cannot take keys. It uses
  only **single-document conditional writes** (same filters as a claim: `_id`, `github_id: null`,
  expected login), plus the existing `github_id_unique` partial index as the arbiter against a
  concurrent registration. It adds **no** lock order and does not touch `devOwnership.js`.
- Pros: no server behaviour change, no new attack surface (no HTTP route), human judgment on an
  evidence-weak decision, reversible with the printed JSON, ships small. Fits US-8.
- Cons: manual, needs someone to notice and DB access; no live push; ghost entries persist until
  acted on. Does not close the Q5 risk.
- Risk: operator error (mitigated by dry-run default, id guard, printed before/after); a write racing
  the live server (mitigated by conditional updates and the unique index).

### Option B: automatic attribution by avatar id in the API
Two variants. **B1 (claim guard):** at claim time, refuse the login-match claim if the legacy dev's
avatar id parses and differs from the claimer's id. **B2 (adoption):** when account N signs in or
writes, a legacy/displaced dev whose avatar id is N is adopted (`github_id` set).

- **Owner already has a profile:** the server must either leave both (no merge) or delete one
  automatically. Deleting on a heuristic is irreversible with no human in the loop. If it merged,
  the owner's profile and `_id` should survive and the legacy be hard-deleted (`dev-deleted`); I do
  not recommend it.
- **Duplicates:** which of two legacy devs is "theirs"? Any automatic choice (oldest, newest) is
  arbitrary; safe behaviour is to adopt none, which leaves the problem for a human anyway.
- **Missing/unparseable:** no evidence; falls back to today's rules (B1: no guard).
- **Events:** adoption pushes `dev-updated` (ownership/login changed) to sockets matching the dev's
  own location/techs; an automatic merge pushes `dev-deleted { _id, github_id: null, github_username:
  '_stale_...' }`.
- **Queue / lock order:** adoption fits one account key (`inAccountOrder`) plus a conditional update
  on the keyless legacy document, like a claim; a merge-delete likewise. Adds an avatar lookup to
  every sign-in/write (needs an anchored query and probably an index on `avatar_url`).
- Pros: no operator; B1 would **close the Q5 risk** for parseable devs (a login holder who is not the
  avatar's account can no longer claim); fixes the owner's UX automatically.
- Cons: ownership decided by a heuristic whose meaning is "login holder at registration" (section 2),
  on data we have not yet seen; new code on the hottest security path (`resolveOwnDev`); partial
  coverage means two behaviours to explain; B1 can refuse a legitimate owner of odd data.
- Risk: **high** (wrong attribution is a takeover or data loss, silently, for a one-off population).

### Option C: one-off migration backfilling `github_id` from the avatar id
A script (or startup step) that sets `github_id` on every legacy dev with a parseable avatar id.

- **Owner already has a profile:** the `github_id_unique` index rejects the second dev; those rows
  fail and still need A. Own profile and `_id` are unaffected.
- **Duplicates:** only one of the two can be written; which one is arbitrary.
- **Missing/unparseable:** left legacy (still claimable by login; Q5 risk remains for them).
- **Events:** none (script), unless run inside the API.
- **Queue / lock order:** bulk writes outside keys; conditional per-document.
- **Effect on Q5:** closes it for parseable devs (a holder of the old login can no longer claim).
  **Effect on US-8 "no data migration required":** directly contradicts it (deploy would rewrite
  existing documents); requires amending US-8 and the model comment, and is not reversible
  by a flag. It also freezes the heuristic's mistakes into permanent ownership, for owners who
  may never return, and does nothing for the displaced-with-own-profile case beyond what A does.
- Pros: closes Q5 for the covered set in one pass; no per-request code.
- Cons: bulk irreversible attribution on unverified evidence; breaks a stated principle;
  incomplete (unparseable, duplicates, owner-has-profile) so A is still needed.
- Risk: **high**, broad blast radius.

### Combinations
- **A + B1** (guard only): human merges, plus the Q5 risk closed. Plausible follow-up, see open
  question 3. B1 is independent of A and can be sequenced after it.
- **A + C:** only if Q5 closure is wanted now and US-8 is formally relaxed. Not recommended.
- **B2 + A:** automation for the easy case, human for the rest. More code for a small population.

## 4. Recommendation: Option A, with the avatar id as evidence for the operator only

Reasons:
1. The problem is a **small, closed, pre-auth population**; no new cases can arise. A tool that is
   used a handful of times does not justify new server logic on the ownership path.
2. The evidence is good but **not proof** (section 2: it names the login holder at registration, I
   could not verify history, coverage is partial). A human deciding with that evidence is the right
   level of trust; an automatic rule is not.
3. A leaves `devOwnership.js`, the lock order and every client untouched, adds no HTTP surface, and
   keeps US-8 true. Its actions are inspectable (dry-run) and recoverable (printed JSON).
4. It captures most of B's value cheaply: the avatar id is shown and used as a **guard**.
5. B1 (closing Q5) is worth considering, but it changes an accepted product risk and the claim path;
   decide it separately (open question 3), ideally after `list` shows real data.

Out of scope for this item: any HTTP/admin endpoint or role, automatic attribution, bulk
migration, GitHub API calls from the script (it works offline; ids come from the avatar or the
operator), changes to claim/displacement rules, pushing live events from the script, mobile/web UI.

## 5. User stories (recommended option)

- **US-LM-1** As an operator I want to list legacy and displaced devs with the owner hint derived
  from their avatar, so I can see who needs attention.
- **US-LM-2** As an operator I want to assign a legacy or displaced dev to its real owner's GitHub
  account when the owner has no profile, so the owner gets their original profile back.
- **US-LM-3** As an operator I want to retire a displaced duplicate into the owner's existing
  profile, so the owner appears once and the ghost entry disappears.
- **US-LM-4** As a product owner I want these actions to be impossible to trigger from any client
  input, and safe against mistakes and races.

## 6. Acceptance criteria

Terms: **legacy dev** = `github_id` missing or null. **Displaced** = legacy with
`github_username_stale: true`. **Derived id** = the id parsed from `avatar_url` per AC-6.
Commands are illustrative (`list`, `assign`, `merge`, `--apply`, `--force`, `--github-id`,
`--from-avatar`, `--into`); DEV chooses the exact interface and documents it.

### List (US-LM-1)

**AC-1 Read-only listing**
```
Given the database has legacy devs (displaced and not) and devs with a github_id
When the operator runs the list command
Then every legacy dev is shown with: _id, login shown, status (legacy | displaced), name,
     coordinates, techs, avatar_url, derived id (or "unparseable" / "none"),
     owner_has_profile (and that profile's _id) when the derived id matches an existing dev's github_id,
     and duplicate_avatar_id when another legacy dev has the same derived id
And nothing is written to the database
And the exit code is 0
```
**AC-2** Given a dev with a `github_id`, When listing, Then it is not shown.

**AC-3** Given any data, When listing, Then a summary shows counts by status and by parse result
(parsed / unparseable / none), and by avatar host seen, so we learn which forms exist.

**AC-4** Given no legacy devs, When listing, Then it says so and exits 0.

### Avatar id parsing (feeds US-LM-1..3)

**AC-6 Strict parsing**
```
Scenario Outline: Derived id
  Given a legacy dev whose avatar_url is "<avatar_url>"
  When the avatar id is derived
  Then the result is "<result>"
  Examples:
    | avatar_url                                               | result       |
    | https://avatars.githubusercontent.com/u/810438?v=4       | 810438       |
    | https://avatars0.githubusercontent.com/u/810438?v=3      | 810438       |
    | https://avatars.githubusercontent.com/u/810438           | 810438       |
    | https://avatars.githubusercontent.com/in/123?v=4         | unparseable  |
    | https://secure.gravatar.com/avatar/0cc175b9c0f1b6a831c3  | unparseable  |
    | https://avatars.githubusercontent.com/u/0?v=4            | unparseable  |
    | https://avatars.githubusercontent.com/u/12x?v=4          | unparseable  |
    | http://avatars.githubusercontent.com/u/810438?v=4        | unparseable  |
    | https://avatars.githubusercontent.com.evil.example/u/1   | unparseable  |
    | https://user:pw@avatars.githubusercontent.com/u/1        | unparseable  |
    | https://example.com/avatar.png                           | unparseable  |
    | (empty or missing)                                       | none         |
```
**AC-6b** Given a dev that has a `github_id`, When parsing is considered, Then its avatar is never
used as evidence (parsing applies only to legacy devs).

### Assign (US-LM-2)

**AC-7 Dry run by default**
```
Given a legacy dev D and an account id N with no dev
When the operator runs assign for D and N without --apply
Then the planned change is printed and nothing is written
```
**AC-8 Assign keeps everything but ownership**
```
Given a legacy or displaced dev D and an account id N that has no dev
When the operator assigns D to N with --apply
Then D.github_id is N
And D._id, location, techs, name, bio, avatar_url, login (including a "_stale_" placeholder) and
    the stale flag are unchanged
And a before and after JSON of D is printed
```
**AC-9 Owner gets the profile back**
```
Given D was displaced and assigned to N (AC-8)
When N signs in (login "alice2") and calls GET /devs/me
Then the response is 200 with D's original _id, techs and location
And D now shows "alice2", github_username_stale is not set, and no second dev exists for N
```
**AC-10 Owner already has a profile**
```
Given account N already has a dev
When the operator tries to assign any legacy dev to N
Then it is refused with a message pointing to merge, nothing is written, exit code is non-zero
```
**AC-11** Given a target that already has a `github_id`, When assign is run, Then it is refused and
nothing is written.

**AC-12 Id guard**
```
Given a legacy dev whose derived id is 111
When the operator assigns it to account 222 without --force
Then it is refused ("avatar id does not match"), nothing is written
When the derived id is "unparseable" or "none" and --force is absent
Then it is refused ("no avatar evidence"), nothing is written
When --force is given
Then the change proceeds and the output states it was forced
```
**AC-13 --from-avatar**
```
Given a legacy dev with derived id N
When the operator assigns with --from-avatar
Then N is used
But it is refused if the id is unparseable/none, or if another legacy dev has the same derived id (AC-21)
```
**AC-14 Races**
```
Given the server claims or displaces D between the operator's read and write
When the operator applies
Then the conditional update matches nothing, the tool reports "changed since read", exits
     non-zero and writes nothing
Given account N registers a dev between check and write
Then the github_id unique index rejects the write and the tool reports it as AC-10
```
**AC-15** Given an invalid N (not a positive integer) or an unknown or malformed `_id`, When run,
Then it is refused with a clear error and non-zero exit, nothing written.

### Merge (US-LM-3)

**AC-16 Dry run by default** (as AC-7).

**AC-17 Owner's data wins, owner's _id survives**
```
Given account N has a dev O (github_id N) and a displaced legacy dev D with derived id N
When the operator merges D into O with --apply
Then D is deleted
And O is byte-identical before and after (same _id, location, techs, name, bio, avatar_url, login)
And the full deleted document of D is printed as JSON, for recovery
And D no longer appears in GET /devs or GET /search
```
**AC-18** Given D still legacy and still showing the expected login (conditional delete), When
anything about D changed since read (claimed, displaced again, deleted), Then nothing is deleted and
the tool reports it.

**AC-19** Given the target O has no `github_id`, or D has one, or D == O, When merge is run, Then it
is refused, nothing written.

**AC-20** Given D's derived id differs from O.github_id (or is unparseable/none), When merge runs
without --force, Then it is refused as in AC-12.

### Duplicates

**AC-21**
```
Given two legacy devs D1 and D2 with the same derived id N and N has no dev
When listing
Then both are flagged duplicate_avatar_id
When assign --from-avatar is run for either
Then it is refused
When the operator assigns D1 to N with explicit --github-id N --apply
Then it succeeds, and D2 now shows owner_has_profile
And merging D2 into D1 succeeds
```

### Live events and queues

**AC-22** The script emits no Socket.io events. After it runs, connected clients are not notified;
a new search or reconnect reflects the change. This is stated in the script's help and in the
architecture doc.

**AC-23** The script performs only single-document conditional writes, takes no in-process keys,
and does not alter `services/devOwnership.js`, `keyedQueue` or `inLoginOrder`. All existing
`@regression` legacy/ownership scenarios (`qa/backend-tests/features/legacy-profiles.feature`,
`ownership*`) pass unchanged.

### Security (US-LM-4)

**AC-24 No client-controlled input decides ownership**
```
Given any HTTP request or socket handshake, with any body, query, header or token claim
      (github_id, _id, avatar_url, github_username, profile)
When it is handled
Then no legacy dev is attributed, merged or deleted as a result
And no new route, event or middleware exists for this feature
```
(The existing Q9 scenarios must stay green.)

**AC-25 Safe operation**
```
Given the script is run
Then it writes only with --apply, and only after printing the target database host (never
     credentials) and the exact change
And it reads the connection string only from the environment (MONGO_URI), never from a flag
And it makes no network call (no GitHub API)
```
**AC-26 Q5 unchanged:** claim-by-login, displacement and the 409 rules behave exactly as today;
this item neither closes nor widens the Q5 risk. (Superseded for parseable avatars by B1,
`05-claim-guard-spec.md`: a login-match claim of a dev whose avatar names another account is
refused and that dev is displaced instead. Four AC-14/AC-18 race rows in `legacy-merge.feature`
now seed an avatar without evidence and use `--force`, since account 502 can no longer claim a
dev whose avatar says 501.)

### Docs and QA

**AC-27** QA can run the script against the ephemeral MongoDB used by `qa/backend-tests`
(connection string by environment); new Cucumber scenarios cover AC-1 through AC-21 and AC-24, with
the AC-6 table as a unit test. AC-9 is an end-to-end scenario with the real app and a sign-in helper.

**AC-28** `dev/docs/00-architecture.md` ("Displaced legacy devs") replaces "a manual operation" with
a pointer to the tool and a short runbook: confirm the owner (their GitHub id or current login),
`list`, dry-run, apply, keep the printed JSON. `dev/docs/03-auth-spec.md` US-8 gets a one-line
reference. `CLAUDE.md` gets the command.

## 7. Open questions (only you can answer)

1. **How many legacy/displaced devs exist in the real database, and who has database access?**
   Count with `db.devs.countDocuments({ github_id: null, github_username_stale: true })` (null also
   matches missing) and the same without the stale flag.
   - (a) **Few, or no production data yet: build Option A only.** *(recommended default)*
   - (b) Dozens or more: add B2 (automatic adoption for the unambiguous case) after A.
2. **If the owner has both a new profile and a displaced legacy one, which data survives?**
   - (a) **The new profile wins, the legacy one is deleted (JSON printed).** *(recommended default:
     the owner's recent, authenticated choice; its `_id` is already what their clients use)*
   - (b) The legacy profile's location and techs win (the owner's original data), copied onto the
     new profile, then the legacy one deleted.
3. **Do you want the Q5 risk (a login holder claiming a renamed owner's legacy profile) closed?**
   - (a) **No, not in this item; Q5 stays accepted.** *(recommended default; revisit with B1 once
     `list` shows real avatar data)*
   - (b) Yes, as the next item: refuse a login-match claim when the avatar id clearly belongs to a
     different account (Option B1).

## 8. Decisions (user, 2026-11-18)

1. **Scale:** few or no real legacy data. Build **Option A only** (operator CLI); no automatic adoption (B2).
2. **Merge data:** the owner's **current profile wins** unchanged; the legacy dev is deleted after its full JSON is printed (AC for `merge` as written).
3. **Q5 risk:** **close it as the next item**, via B1 (refuse a login-match claim when the legacy dev's avatar id clearly belongs to another account; devs without a usable avatar id keep today's rule). Out of scope for this item.

Verified by the main session (closes §2 "What I could NOT verify"): every historical `POST /devs`
before sign-in (`87f83db`, `7b3527f`, `a758b49`, `2e911c9`, `6b84bb4`) took `avatar_url` only from
the server-side `GET https://api.github.com/users/<login>` response; no version read it from the
request body.
