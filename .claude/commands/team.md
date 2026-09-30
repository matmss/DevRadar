---
description: Assemble the DevRadar project team (po-agent, dev-agent, qa-agent) as teammates for this session
---

Spawn three teammates for this session, one per existing project subagent definition in `.claude/agents/`, and keep them active as a standing team for the rest of the session:

- **po-agent** — Product Owner. Scopes work into User Stories with Given-When-Then acceptance criteria. Plan-only, never writes code.
- **dev-agent** — Fullstack Developer. Implements against the PO's acceptance criteria, following `CLAUDE.md`. Has edit/write access.
- **qa-agent** — QA Engineer. Writes/updates tests and hunts regressions and edge cases against dev-agent's changes, reporting defects back to dev-agent.

Coordinate them as a pipeline: po-agent scopes the task first, dev-agent implements against that scope, qa-agent verifies. Use SendMessage to relay context between them rather than re-briefing from scratch, and keep the user updated at each handoff.

Task for the team this session: $ARGUMENTS
