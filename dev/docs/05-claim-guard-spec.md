# DevRadar: the avatar-id claim guard (B1), closing the Q5 risk

Status: **decided, ready for DEV.** Backlog item B1 of `dev/docs/04-legacy-merge-spec.md`
(section 3 Option B1; user decision 1 of section 8, "close Q5 as the next item"). Written by the PO
agent against `main` at `85a17c7`. This defines **what** to build and how we accept it; **how** is
DEV's. Follows `dev/docs/03-auth-spec.md` (Q5, Q10, US-8) and `dev/docs/00-architecture.md`
("Profile ownership"). The parser is already built for this: `parseGithubAvatarId` and
`legacyAvatarEvidence` in `dev/backend/src/utils/githubAvatarId.js` (reuse as is, do not loosen).

## 1. Problem

Q5 lets the holder of a login claim the legacy (pre-sign-in) dev with that login, matched
case-insensitively, on their first POST, PUT or DELETE. That trusts the **login**, and logins get
renamed and reused:

1. A registered `alice` before sign-in existed (legacy dev, no `github_id`). A renamed to `alice2` on
   GitHub and has not signed in.
2. B now holds `alice` on GitHub and **has no profile**. B signs in and writes. B claims A's
   profile: B gets A's location, techs and bio under B's GitHub link, and A can never reach it.
   (If B already had a profile, B's newer read displaces A's dev instead. That case is handled.)

Evidence exists to stop this. Every pre-sign-in `POST /devs` stored the `avatar_url` returned by
GitHub's server-side `GET /users/<login>`, and no update route existed before sign-in. So a legacy
dev's `avatars.githubusercontent.com/u/<id>` is the id of the account that held the login **at
registration** (spec 04 section 2; verified from the history by the main session). `restore` in the
operator CLI always re-inserts displaced devs, so no new claimable legacy devs can appear.

**Rule (B1):** account N may not claim a legacy dev by login when that dev's avatar parses to an id
M different from N. Nothing else about claiming changes.

## 2. Decided behaviour

Terms. **Legacy dev:** `github_id` missing or null (both identical everywhere). **Evidence:**
`legacyAvatarEvidence(dev)` is `parsed` with id M. **Guarded against N:** a legacy dev whose login
matches N's (case-insensitive) and whose evidence is `parsed` with M != N. Only legacy devs are ever
guarded: a dev with a `github_id` never has its avatar read as evidence (AC-6b of spec 04).

The guarded dev is treated exactly like another account's dev holding N's login (today's rule 3,
"conflict"): it is never N's to read, change or delete, and the existing "newest GitHub read wins"
displacement applies to it. No new error code, no new route, no new event.

Why displace instead of 409 on POST: the claimer's GitHub read says the login is N's *now*, and the
avatar says the dev belonged to someone else, so that dev is a stale entry of M (who renamed).
Displacement is the existing, non-destructive, operator-recoverable treatment of exactly that case
(spec 04 section 1): login becomes `_stale_<_id>`, `github_username_stale: true`, nothing else
changes, never deleted, `dev-updated` pushed. Refusing with 409 would block N from their own login
with no way out short of an operator, and would be wrong: logins stay unique and the newest read
wins. A legacy dev has no `github_username_seen_at`, so N's read is always newer in practice (if one
ever were not, the existing `newer` outcome applies: 409 `github_username_conflict` on POST).

| Route / moment | Account N, no own dev, legacy dev L with N's login | Result |
|---|---|---|
| `POST /devs` | L guarded against N (avatar id M != N) | L is **displaced** (N's read is newer), N registers a **fresh profile** (200, new `_id`, `new-dev` pushed as for any creation). L keeps M's data, shows no login. No 409 unless L's login state is not older than N's read (existing rule). |
| `POST /devs` | avatar id == N, unparseable, none, or L has a `github_id` rule | As today: claimed (legacy) or conflict rules unchanged. |
| `PUT /devs/me` | guarded L | **404 `dev_not_found`**, nothing written, L untouched (PUT never creates; N has no profile). |
| `DELETE /devs/me` | guarded L | **404 `dev_not_found`**, nothing deleted, L untouched. |
| `GET /devs/me` | guarded L | **404 `dev_not_found`**. A legacy dev is still shown read-only only when N *could* claim it (avatar id == N, unparseable or none). A read never displaces or writes. |
| Sign-in (`refreshLoginAtSignIn`) | guarded L | L is **displaced** at sign-in, best effort, like any other holder with an older state (`dev-updated` pushed). This extends today's rule "a legacy dev is displaced only by an account that already owns a dev" with "or one it is guarded against". Legacy devs the account may claim are still **not** claimed or displaced at sign-in. |
| Any route | N already owns a dev (`github_id` N) | Unchanged: own dev wins, legacy holder with N's login is displaced if older (already so, for any avatar). |

Other decisions:
- **Positive case:** avatar id == N and login matches: the claim proceeds exactly as today (same
  `_id`, data kept, login and `seen_at` taken). It is not required, only allowed.
- **B2 is out of scope.** A dev whose avatar id is N but whose login does **not** match N's is never
  adopted, claimed or touched by this item (user decision 1, section 8: no adoption by avatar). The
  guard only ever *refuses* a login-match claim; it never grants one. Adoption stays the operator
  CLI's job (`assign`).
- **Unparseable or missing avatar:** today's rule (claim by login). Q5 stays an accepted risk for
  those devs only; docs say so.
- **Why not leave a guarded dev in place and let N register without displacing:** impossible, since
  logins are unique (case-insensitive index); N could never take their login.
- **Concurrency.** The claim stays one conditional update; its filter additionally matches the
  `avatar_url` exactly as read (a missing or null avatar matches missing or null), so the decision
  and the write are atomic: if the avatar changed between read and write, the update misses and the
  existing "look again" loop re-evaluates (attempt cap unchanged; a write that reaches the cap
  answers 503 `profile_busy` with `Retry-After: 1`, no longer 500 `internal_error`, see
  `00-architecture.md` "App assembly and errors"). The guard displacement uses the
  existing `displace` filter (`_id`, `github_id: null`, login as read, older state), so it also
  loses cleanly to a concurrent claim by the real owner M. `keyedQueue.runAll` / `inLoginOrder`
  order is **unchanged**, no new lock or key (legacy devs still have none).
- **Errors and messages:** no new code (503 `profile_busy` at the retry cap came later, for every
  profile write, not with this item). Clients see 404 `dev_not_found` (no profile) and a normal
  200 on POST; the response never reveals that a guarded dev exists or whose avatar it has.
- **Clients:** no web or mobile change. Web already treats only 404 `dev_not_found` as "no profile"
  (`dev/web/src/App.jsx`, empty form, "Salvar"). Mobile does not register or edit. Other users see
  L as a displaced ghost ("Dev sem nome", "Perfil do GitHub indisponível", no link) until an
  operator acts, via the existing `dev-updated` push or next search.
- **Observability:** each refused claim or guard displacement logs one line at warn level: dev
  `_id`, the login, the claimer's id N and the avatar id M. Never the token, avatar URL, name, bio,
  coordinates or request body. `GET /devs/me` does not log (it is hit on every page load).
- **Operator CLI (`scripts/legacy-devs.js list`):** gains an additive, read-only field per legacy
  dev saying who can claim it by login: `claimable_by: <id>` (guarded: only account M) or
  `claimable_by: login` (no evidence) or `claimable_by: none` (its login is no GitHub login, so
  nobody can claim it by login: a displaced `_stale_…` dev, or a hand-edited login). Existing `list` output
  and ACs of spec 04 are unchanged; `assign`, `merge`, `restore` are not touched.
- **Migration / US-8:** none. The guard reads existing fields only. US-8 "No data migration
  required" stays true; no document is rewritten at deploy. Displacement happens only when an
  account signs in or writes, as today.
- **Hand-edited or seed data** with a GitHub-style avatar id will be guarded; documented.

## 3. User stories

- **US-CG-1** As the renamed owner of a legacy profile, I want a stranger who now holds my old login
  to be unable to take over my profile, so my data is not exposed under their account.
- **US-CG-2** As a new holder of a GitHub login, I want to sign in and register without being blocked
  by someone else's stale profile, so I can use DevRadar normally.
- **US-CG-3** As an operator, I want to see which legacy devs are claim-guarded, so I can tell which
  need `assign` or `merge`.
- **US-CG-4** As a product owner, I want Q5 documented as closed where the avatar gives evidence and
  accepted where it does not, so the remaining risk is explicit.

## 4. Acceptance criteria

Background for all scenarios: legacy dev L has no `github_id` (missing unless stated), techs and
location set, login "alice". Account N has id 222 and holds "alice" on GitHub, with a sign-in read
newer than any state on L. N has no own dev unless stated. "Avatar id M" means L's `avatar_url` is
`https://avatars.githubusercontent.com/u/<M>?v=4`.

**AC-1 Guarded claim refused on POST: N registers fresh, L is displaced**
```
Given L with avatar id 111
When account 222 calls POST /devs with valid techs and coordinates
Then the response is 200 and the dev has github_id 222, login "alice" and a new _id (not L's)
And L still exists with the same _id, techs, location and avatar_url, github_id still absent,
    github_username "_stale_<L._id>" and github_username_stale true
And dev-updated is pushed for L and new-dev for N's dev
And a warn log names L's _id, "alice", 222 and 111, and no token, avatar URL or body
```

**AC-2 PUT refused**
```
Given L with avatar id 111
When account 222 calls PUT /devs/me with valid input
Then the response is 404 with code dev_not_found
And L is unchanged (no github_id, login "alice", no stale flag) and no dev exists for 222
```

**AC-3 DELETE refused**
```
Given L with avatar id 111
When account 222 calls DELETE /devs/me
Then the response is 404 with code dev_not_found and L still exists, unchanged
And no dev-deleted event is pushed
```

**AC-4 GET /devs/me does not show a guarded dev**
```
Given L with avatar id 111
When account 222 calls GET /devs/me
Then the response is 404 with code dev_not_found
And nothing is written (L unchanged)
```

**AC-5 Positive case: avatar id equals N**
```
Given L with avatar id 222
When account 222 calls GET /devs/me
Then the response is 200 with L (read-only, nothing written)
When account 222 then calls PUT /devs/me
Then L is claimed: same _id, github_id 222, data kept then updated, login "alice" recorded
```
Same for POST (returns L claimed) and DELETE (deletes L), exactly as before this item.

**AC-6 Login case differs**
```
Given L with login "Alice" and avatar id 111, and account 222 signed in as "ALICE"
When 222 calls POST /devs
Then L is guarded and displaced, 222 registers fresh (case-insensitive match, as for claims)
```
and with avatar id 222 the claim succeeds for any letter case.

**AC-7 Unparseable or missing avatar keeps today's rule**
```
Scenario Outline: No usable evidence
  Given L with avatar_url "<avatar_url>"
  When account 222 calls PUT /devs/me with valid input
  Then L is claimed by 222 exactly as before this item
  Examples:
    | avatar_url                                          |
    | https://example.com/avatar.png                      |
    | https://secure.gravatar.com/avatar/0cc175b9c0f1b6a  |
    | https://avatars.githubusercontent.com/in/123?v=4    |
    | https://avatars.githubusercontent.com/u/810438?v=4&u=ab |
    | https://avatars.githubusercontent.com/u/0123?v=4    |
    | https://avatars.githubusercontent.com/u/99999999999999999?v=4 |
    | (empty string)                                      |
    | (field missing)                                     |
    | (null)                                              |
```

**AC-8 `github_id` missing versus null, and owned devs**
```
Given two devs L1 (github_id missing) and L2 (github_id null), each with avatar id 111, in turn
When account 222 holds the login of each
Then both are guarded identically (AC-1 to AC-4)
Given a dev D with github_id 111 and an avatar id 222 (or 111) holding login "alice"
Then its avatar is never read as evidence: D is another account's dev (today's conflict rules:
     displaced if 222's read is newer, else 409 github_username_conflict on POST)
```

**AC-9 Sign-in displaces a guarded dev, never claims**
```
Given L with avatar id 111 and account 222 with no dev
When 222 signs in as "alice"
Then L is displaced (stale login, flag, dev-updated) and no dev is claimed or created
Given L with avatar id 222, or unparseable
When 222 signs in
Then L is untouched (as today: not claimed or displaced at sign-in)
```
After the first scenario, GET /devs/me for 222 is 404 and POST registers fresh.

**AC-10 The same account already has its own profile**
```
Given account 222 owns dev O (github_id 222) and L (avatar id 111 or 222) holds "alice"
When 222 signs in, or calls POST or PUT
Then behaviour is exactly as today: L is displaced if older (any avatar), O is returned or updated
And the guard changes nothing on this path
```

**AC-11 Older read: 409 stays**
```
Given the (hypothetical) guarded dev's login state is at least as recent as N's read
  (github_username_seen_at >= N's login_read_at)
When 222 calls POST /devs
Then the response is 409 github_username_conflict, nothing is written, L is untouched
When 222 calls PUT or DELETE
Then 404 dev_not_found, as in AC-2 and AC-3
```

**AC-12 Race: the real owner claims while a stranger registers**
```
Given L with avatar id 111, and account 111 holds a session whose login is "alice" (an older read)
  while account 222 holds "alice" with a newer read
When 111 claims L (PUT) and 222 calls POST /devs at the same time
Then no request returns a server error
And at most one account ends up with github_id on L, and logins stay unique
And the newest GitHub read wins the login, exactly as today's QA-AUTH6-4
```

**AC-13 Race: displacement versus a concurrent registration**
```
Given L guarded against 222, and 222 sends POST /devs twice at once (double click)
Then both answer 200 with the same dev, L is displaced exactly once (one dev-updated),
     and exactly one new-dev is pushed
```

**AC-14 Race: avatar changes between read and write**
```
Given L is read as legacy with avatar id 222 and, before the claim's write, L's avatar_url
  is changed to avatar id 111 (test hook or direct DB write)
When the claim runs
Then the conditional update (which matches the avatar as read) misses, the request looks again,
     and the second pass refuses the claim as in AC-1, with no server error and no claim
```

**AC-15 Q9 and invariants unchanged**
```
Given any body, query or token claim carrying avatar_url, github_id, _id or github_username
Then ownership is never decided by it (existing Q9 scenarios stay green)
And logins remain unique, the newest GitHub read wins, no legacy dev is deleted by the server
And no new route, event, error code or middleware exists
And middleware order and lock order (keyedQueue.runAll via inLoginOrder) are unchanged
```

**AC-16 Operator CLI list shows claimability**
```
Given legacy devs: A (avatar id 111), B (unparseable avatar), C (displaced)
When the operator runs list
Then A shows claimable_by 111, B shows claimable_by login, C shows claimable_by none
And nothing is written and every spec 04 list AC still passes
```

**AC-17 Regression**
```
All existing @regression legacy and ownership scenarios
(qa/backend-tests/features/legacy-profiles.feature, ownership*, legacy-merge.feature) pass.
Existing scenarios that claim a legacy dev must give it an avatar that is missing, unparseable
or equal to the claimer's id; any that used another account's avatar id are updated to expect AC-1..4.
```

**AC-18 Web end to end (no client change)**
```
Given L guarded against 222 and 222 signed in on the web app
Then the app shows the empty form (not L's data), "Salvar" registers a fresh profile,
     and the list shows both 222's profile and L as a displaced entry
```

## 5. Docs to update (part of done)

- `dev/docs/03-auth-spec.md`: Q5 (table row, line 16) and its long note (line 21): change from
  accepted risk to "closed where the dev's avatar carries another account's id; still accepted for
  devs without a parseable avatar id". Add a US-8 scenario ("A stranger holding a renamed owner's
  old login cannot claim the profile") and amend the comment under "A renamed login does not hand
  over a profile" about devs B can claim. US-8 "No data migration" unchanged.
- `dev/docs/00-architecture.md` "Profile ownership": rule 2 (claim only if not guarded; the claim's
  filter matches the avatar as read), rule 3 (guarded legacy dev behaves as a conflict), the
  displacement paragraph (a legacy dev is displaced by an account that owns a dev **or is guarded
  against**, also at sign-in), and the runbook ("Displaced legacy devs"): guarded devs show
  `claimable_by`.
- `dev/docs/04-legacy-merge-spec.md`: status line (B1 is now `05-claim-guard-spec.md`), AC-26 note.
- `dev/backend/src/services/devOwnership.js` header comment and `utils/githubAvatarId.js` header
  ("meant to be reused by a server-side claim guard" becomes "used by").
- `CLAUDE.md`: "Profile ownership" paragraph (legacy claim is avatar-guarded, guarded devs are
  displaced like another account's, 404 on PUT/DELETE/GET) and the legacy-devs CLI note
  (`list` shows `claimable_by`).
- `qa/docs/`: `01-requirements.md` (ownership requirement), `02`/`03` scenarios and test cases for
  AC-1 to AC-18, `04-qa-process.md` tags (`@regression`, `@edge` for races, `@P1` for AC-1..4),
  `05-bug-tracker.md` (Q5 risk entry, if one exists, marked closed with a pointer), `07` live report.
- `qa/backend-tests/features/`: new scenarios (suggested `claim-guard.feature`); the avatar parse
  table already has a unit test (spec 04 AC-6).

## 6. Out of scope

B2 (adoption by avatar), any data migration or backfill (option C), automatic merge or delete,
any admin endpoint or role, GitHub API calls, client (web/mobile) changes, changes to `assign`,
`merge`, `restore`, rate limits, token claims.

## 7. Questions for the user

None. Choices made by default, all reversible by this spec's owner if the user disagrees:
displace-and-register on POST (rather than 409), displacement at sign-in too (rather than lazily
on first write), and the additive `claimable_by` field in `list`.
