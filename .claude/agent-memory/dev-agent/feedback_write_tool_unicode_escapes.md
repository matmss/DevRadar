---
name: write-tool-unicode-escapes
description: The Write/Edit tools may turn \uXXXX escapes in file content into raw characters (U+2028 broke a JS regex; U+202E planted a bidi override); check new files for non-ASCII
metadata:
  type: feedback
---

When writing source with ` `, `‮` and similar escapes through Write/Edit, some came out as the raw characters (2026-11-08, auth slice 2). U+2028 inside a regex literal is a JS line terminator ("Invalid regular expression: missing /"), and a raw U+202E in a .feature file is a Trojan-Source-style bidi override. `\u0000`-`\u009f` escapes survived.

**Why:** silent corruption that only shows up at runtime or in review.

**How to apply:** for code points, build strings/regexes from numbers (`String.fromCodePoint`, `new RegExp` with escapes generated from hex) instead of literal escapes. After writing, run `LC_ALL=C grep -rnP '[^\x00-\x7e]' <paths>` and fix with `perl -CSD -pi -e 's/\x{202e}/\\u202e/g' <file>`. See [[worktree-bash-compound-commands]].
