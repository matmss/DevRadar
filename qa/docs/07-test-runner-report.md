---
title: Unified Test Runner — Report Artifact
description: Live link to the published "DevRadar QA Run" dashboard (the unified merged report described in 06-framework-selection.md §5)
---
 
# DevRadar — Unified Test Runner Report
 
The unified test runner (`npm run test:all` in `qa/`, see `06-framework-selection.md` §5) merges the backend (Cucumber.js), web (playwright-bdd), and mobile (Detox + jest-cucumber, Maestro fallback) suites into one Cucumber-JSON-driven HTML report.
 
A generated instance of that merged report has been published as a standalone Artifact for the team to review without pulling CI output locally:
 
**DevRadar QA Run:** https://claude.ai/code/artifact/e285c4c0-4fc3-4124-b366-d0c6f3e26df4
 
This is a point-in-time snapshot styled after the `multiple-cucumber-html-reporter` output (pass/fail/warn/skip breakdown per layer, per-scenario detail). Re-publish a fresh snapshot after each nightly `@regression` run or before a release tag so this link always reflects the latest state; update this doc's link only if a new Artifact URL is created (redeploying the same Artifact keeps the URL stable).
 
Last attached: 2026-09-01.
 