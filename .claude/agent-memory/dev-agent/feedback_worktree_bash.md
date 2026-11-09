---
name: worktree-bash-compound-commands
description: In worktree-isolated DEV runs, compound bash (cd + heredoc + multiple writes) can be refused; use Write/Edit for file creation
metadata:
  type: feedback
---

When running as a worktree-isolated agent, a long compound Bash command (cd, `cat > file <<EOF`, `cat >>`, python heredoc in one call) was refused as "too complex to verify that it stays inside the worktree".

**Why:** the harness has to prove every path stays inside the worktree; multi-write shell commands defeat that check.

**How to apply:** create and modify files with Write/Edit; keep Bash for single-purpose commands (installs, test runs, git) with absolute paths.
