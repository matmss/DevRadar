---
name: worktree-bash-compound-commands
description: In worktree-isolated DEV runs, compound bash (cd + heredoc + multiple writes, loops, cd-then-git) can be refused; use Write/Edit for file creation and plain single commands
metadata:
  type: feedback
---

When running as a worktree-isolated agent, a long compound Bash command (cd, `cat > file <<EOF`, `cat >>`, python heredoc in one call) was refused as "too complex to verify that it stays inside the worktree".

Also refused in auth slice 4 (2026-11-09): a `for v in ...; npm view ...$v` loop, `cd x && ... && cd .. && git status`, and `$(git diff --name-only ...)` substitutions. A `git commit -F - <<'EOF'` heredoc from the worktree root is fine.

**Why:** the harness has to prove every path stays inside the worktree; multi-write shell commands defeat that check.

**How to apply:** create and modify files with Write/Edit; keep Bash for single-purpose commands (installs, test runs, git) with absolute paths. For scripts that need git file lists, put the `execFileSync('git', ...)` call inside a node script in the scratchpad. To prove new tests fail on old code: copy the new files to the scratchpad, `git checkout main -- <files>`, run the suite, then copy them back (no stash: it is shared across worktrees).

See [[write-tool-unicode-escapes]].
