## Summary

<!-- What changed and why, in 1-3 bullets. -->

## Layer(s) touched

- [ ] Backend (`dev/backend`)
- [ ] Web (`dev/web`)
- [ ] Mobile (`dev/mobile`)
- [ ] QA (`qa`)

## Testing

<!-- What did you run locally, and what does CI run automatically on this PR
(see .github/workflows/pr.yml)? -->

- [ ] Added or updated a `.feature` scenario for this change (tagged `@smoke`/`@regression`/`@edge` per `qa/docs/04-qa-process.md`)
- [ ] `cd qa && npm run test:backend` passes locally
- [ ] `cd qa && npm run test:web` passes locally
- [ ] If this fixes a tracked bug: added a `@regression` scenario so it can't silently reoccur (`qa/docs/05-bug-tracker.md`)

## Related issues

<!-- Closes #123 -->
