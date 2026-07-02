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
1. **Editor — DONE (P1–P4).** FreeCut shelved; rebuild/voiced-trim/splits fixed; Descript-style
   transcript editor; Submagic-style AI auto-effects (emphasis/emoji/zoom/SFX, opt-in). See
   [timeline/06](timeline/06-2026-07-02-editor-and-autopilot-build.md). Open: eyeball the ffmpeg
   zoom/SFX render quality on a real export.
2. **Autopilot — A–D shipped** (cartridges, orchestrator, gates, ideation feeder, per-brand
   learning, control-room UI). Open: set Upload-Post creds for the first live post (deferred by
   Dennis until ship); D polish (day-7 perf cards, in-UI autonomy dial).
3. **Model:** default Ollama brain is now `qwen3.5:9b`.
