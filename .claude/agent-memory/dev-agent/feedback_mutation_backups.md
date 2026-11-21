---
name: mutation-backup-timing
description: For self-mutation checks, back up the file right before each mutation (or undo with Edit); restoring an older scratchpad copy silently drops edits made after it
metadata:
  type: feedback
---

Self-mutation runs (drop a guard, run the new scenarios, restore) are a standard part of the lead's hand-off. In the claim-guard item (2026-11-20) a scratchpad backup of `devOwnership.js` taken before a later comment fix was copied back after a further mutation, which reverted that fix unnoticed until a grep.

**Why:** a stale backup restore looks like a clean revert, and the committed file would not be the one the suites ran against.

**How to apply:** undo each mutation with an Edit of the exact mutated line (marked `// MUTATION n`), or re-copy the backup right before every mutation. Afterwards `diff` the file against the backup and `grep -c MUTATION`, and make sure the last full suite ran on the final code. See [[worktree-bash-compound-commands]].
