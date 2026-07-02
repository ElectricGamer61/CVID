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
│   ├── 05-2026-07-02-autopilot-master-plan.md
│   └── 06-2026-07-02-editor-and-autopilot-build.md  ← latest session
└── reference/
    └── perf-sheet-AppsScript.gs           the Google Sheet Apps Script
```

## Canonical project docs (kept at repo root)
- [../README.md](../README.md) — how to run the app
- [../SPEC.md](../SPEC.md) — product spec
- [../CONTEXT.md](../CONTEXT.md) — how the app works (deep dive)
- [../GOAL.md](../GOAL.md) — pipeline build goal (used by the `goal` skill)

## Current focus
1. **Autopilot** — A–D shipped (cartridges, orchestrator, gates, ideation feeder, per-brand
   learning, control-room UI); see [timeline/06](timeline/06-2026-07-02-editor-and-autopilot-build.md).
   Remaining: set Upload-Post creds for the first live autonomous post; D polish (day-7 cards, UI autonomy dial).
2. **Editor** — P1 (FreeCut shelved) + P2 (bug fixes) done; **P3 (transcript editor)** and
   **P4 (AI auto-effects)** remain, per [timeline/04](timeline/04-2026-07-02-next-steps.md).
