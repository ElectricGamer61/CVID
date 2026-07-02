# Cvideo — Docs, Context & Sessions

The single organized home for everything that isn't code: how Cvideo works, why it's
built the way it is, what happened each session, and what's parked for later.

## Folder map
```
docs/
├── README.md                  ← you are here (index)
├── context/
│   ├── overview.md            what Cvideo is (descriptive tour)
│   ├── architecture.md        stack, the "hub" model, render paths
│   └── decisions.md           the decision log (why we chose what we chose)
├── editor/
│   └── freecut-editor.md      the vendored FreeCut editor — plan, status, contract
├── autopilot/
│   ├── master-plan.md         the Autopilot master plan (locked 2026-07-02)
│   └── content-engine.md      original idea capture (superseded by master-plan.md)
├── timeline/                  numbered session logs, oldest → newest
│   ├── 01-2026-06-editor-results-sheets.md
│   ├── 02-2026-07-01-session.md
│   ├── 03-2026-07-01-next-session-handoff.md
│   ├── 04-2026-07-02-next-steps.md        ← editor pivot plan (next build)
│   └── 05-2026-07-02-autopilot-master-plan.md  ← latest session
└── reference/
    └── perf-sheet-AppsScript.gs           the Google Sheet Apps Script
```

## Canonical project docs (kept at repo root)
- [../README.md](../README.md) — how to run the app
- [../SPEC.md](../SPEC.md) — product spec
- [../CONTEXT.md](../CONTEXT.md) — how the app works (deep dive)
- [../GOAL.md](../GOAL.md) — pipeline build goal (used by the `goal` skill)

## Current focus
1. **Editor** — back to the custom ClipEditor, per [timeline/04-2026-07-02-next-steps.md](timeline/04-2026-07-02-next-steps.md). ← active
2. **Autopilot** — master plan locked in [autopilot/master-plan.md](autopilot/master-plan.md); phases A–D start after editor Phase 4.
