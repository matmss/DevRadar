---
name: write-tool-unicode-escapes
description: Write/Edit (and zsh echo) turn backslash-u escapes into raw characters (NUL, U+2028, U+202E seen); never put backslash-u escapes in file content, build code points from numbers and scan afterwards
metadata:
  type: feedback
---

During auth slices 2+3 (2026-11-08) backslash-u escapes written through the Write/Edit tools came out as the raw characters: U+2028 inside a regex literal is a JS line terminator ("Invalid regular expression: missing /"), and U+202E in a .feature file is a Trojan-Source-style bidi override. QA saw a backslash-u-0000 become a NUL byte too. Separately, zsh's `echo` interprets backslash escapes, so `echo '... \uXXXX ...' >> file` wrote a NUL into MEMORY.md. QA flagged both in review.

**Why:** silent corruption that only shows up at runtime or in review, and it also hit these memory files.

**How to apply:**
- In code, build special characters from numbers: `String.fromCodePoint(0x202e)`, or regex ranges generated from hex values.
- In prose (docs, memory, commit messages) write `U+202E`, never a backslash-u escape.
- Append to files with Write/Edit or `printf '%s\n'`, never `echo`.
- After writing, scan every touched file, including `.claude/agent-memory/`, with a perl code-point check for C0/C1 controls, U+2028/U+2029, U+061C, U+200E/U+200F, U+202A-U+202E and U+2066-U+2069.

See [[worktree-bash-compound-commands]].
