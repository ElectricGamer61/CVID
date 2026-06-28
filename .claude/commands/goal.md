---
description: Autonomously finish the Cvideo pipeline build (P2→P6), verifying & committing each phase, stopping only at zero errors.
---

# /goal — finish the Cvideo build, no errors at the end

You are completing the Cvideo content-pipeline build. Cvideo is **FastAPI + SQLite (SQLModel) +
React/Vite** — **Claude Code, NOT Lovable/Supabase**. The clip engine + pipeline schema + Board
already exist (see `CONTEXT.md` and the plan in `~/.claude/plans/`). Your job: build the remaining
phases to completion, **checking for issues after every change and not stopping until the build is
clean with zero errors.**

## Operating rules (non-negotiable)
1. **Work phase by phase, in order.** Finish and verify one before starting the next.
2. **Verify after every change.** A phase is not done until ALL pass:
   - `cd frontend && npm run build` → **0 TS errors**.
   - `cd backend && .venv/Scripts/python.exe -c "import sys;sys.path.insert(0,'.');import app.main;from app.db import init_db;init_db();print('OK')"` → clean.
   - A **smoke script** (Python `requests` against a freshly-restarted backend) exercises the new
     endpoints and **asserts** the expected results.
   - Restart the backend after backend changes (it has no `--reload`).
3. **Never advance on red.** If build/smoke fails, fix the root cause and re-verify. Do not paper over.
4. **Commit each phase** with a clear message once it's green (`Phase N: …`). Per-phase commits make
   the run resumable across context windows — on resume, check `git log`/`CONTEXT.md` for the last
   green phase and continue.
5. **Reuse existing code, match the surrounding style.** Don't reinvent: `render.render_clip`,
   `reframe.crop_filter`, `captions.write_ass`, `ingest.save_upload/extract_audio/probe_duration`,
   the `_render_pool` ThreadPool + background-job pattern in `main.py`, `intake.parse_script`,
   `downloadClip` (frontend), moment-card/grid CSS.
6. **Localhost-first.** ffmpeg as a local subprocess; no queues/workers/serverless. Mark each
   disk-I/O boundary and the job dispatch with a one-line `# FUTURE:` storage/worker-swap comment.
7. **Update `CONTEXT.md`** (source of truth) and the memory file as you finish phases.

## Polish first (quick)
- **Library = Home bug:** in `Sidebar.tsx`, "Library" calls `onHome` (duplicate). Repurpose Library
  into an **Exports** view: a grid of every rendered output (project clips `status=rendered` + ticket
  reels with `clip_url`), each with the existing `downloadClip` button. Add `Route "library"` +
  `onLibrary` + a `Library` component reusing grid/card styles. Sweep for other dead nav/stubs.

## Phases
**P2 — Ticket detail editor + Intake.** Beat add/delete/reorder (`POST /tickets/{tid}/beats`,
`DELETE /beats/{bid}`, reorder by `order_index`); `Outlier` CRUD + `POST /tickets/from-outlier/{oid}`.
Frontend: turn the `TicketDetail` drawer into a full editor (every beat + ticket field, add/delete/
reorder); new **Intake** screen (paste outliers → swipe file → spin tickets pre-tagged with the angle).

**P3 — AI buttons.** `POST /tickets/{tid}/script-factory` (LLM → script → beats via
`intake.parse_script`) and `POST /tickets/{tid}/hook-forge` (LLM → hook options). **Reuse the
`brain.py` Ollama/Gemini client; rely on its heuristic fallback so endpoints never hard-fail.**
Frontend: the two buttons in `TicketDetail`. Smoke asserts structure, not LLM quality.

**P4a — long-form hookup.** Attach a `Project` to a `longform-clip` ticket (`project_id`), pick a
rendered clip, copy `output_path` → `Ticket.clip_url`, advance to `assembled`.

**P4b — native beat-slot editor + assemble.** Per-beat uploads `POST /beats/{bid}/clip` (video) +
`POST /beats/{bid}/voiceover` (audio → wav via `ingest.extract_audio`) under
`data/tickets/{tid}/beats/{bid}/`. New `backend/app/pipeline/assemble.py::assemble_ticket(ticket_id)`
— pure, ids-in/path-out: **proof-guard** (any `is_proof_beat` with no `clip_path` → raise) → per beat
9:16-render the clip + **even-split the known `beat.caption` words across the VO duration**
(`ingest.probe_duration`) + burn ASS (`captions.write_ass`) + overlay `on_screen_text` + mux VO audio
→ ffmpeg `concat` in `order_index` → `data/tickets/{tid}/reel.mp4` → set `clip_url`, stage `assembled`.
Dispatch via `_render_pool`. `GET /tickets/{tid}/download`. Frontend: native beat-slot editor (upload
clip + VO per beat, teleprompter = `spoken_line`, proof warnings) + **Assemble** → poll → player +
download. **Smoke with generated sample media** (ffmpeg `testsrc` + `sine`) → assert `reel.mp4` is
1080×1920.

**P5 — Insights = Signal Reader.** `POST /perf` (insert `Perf`, recompute `Angle.avg_score =
avg(saves+follows)` + `posts_count`); `GET /insights` (KPIs, top performers, angle ranking **by
saves+follows, NOT views**). Frontend: **Insights** screen + a perf-logging form on posted tickets.
Add Sidebar items for Intake + Insights.

**P6 — RUN LATER (do NOT run unless explicitly asked).** Upload-Post SDK schedule/post behind a
**dry-run adapter** (logs instead of sends; real posting gated on `UPLOAD_POST_API_KEY` in `.env`)
+ a Queue screen. Keep the build green without external creds.

## FINAL ACCEPTANCE — stop only when ALL pass
1. `cd frontend && npm run build` → 0 TS errors.
2. Backend imports + `init_db()` clean; both servers respond (`/api/health` 200, `:5173` 200).
3. Scripted end-to-end smoke, green: ticket-from-script → edit/reorder beat + toggle proof →
   (native) upload sample clip+VO → **assemble → `reel.mp4` exists, `ffprobe` = 1080×1920** → log
   perf → `GET /insights` ranks the angle by saves+follows → Library/Exports lists outputs.
4. UI pass: Board, Intake, Ticket editor, Insights, Library load with no console errors.
5. All phases committed; tree clean; `CONTEXT.md` + memory updated.

Then report what shipped, the commit list, and anything deferred (P6). Do not stop before step 5 is green.

---

## REVISED ROADMAP & STATUS (updated 2026-06-28 — decisions made after P1–P6 were built)

**Status:** P1–P6 are all built & committed on `main` (Phase 1 Board `1961554` → P6 real
Upload-Post posting `80618fb`), plus the wayin-style editor, voice recording, and Downloads
(folders/drag/rename). The items below are **refinements** to layer on, **one phase per
session, review + commit each**. Build nothing ahead.

### Schema (DONE 2026-06-28 — additive via `db._migrate` + backfill)
- `Ticket.post_meta` (JSON) — per-platform PUBLISH copy
  `{tt:{caption,hashtags}, ig:{caption,hashtags}, yt:{title,description,tags}}`. Canonical
  "post box" copy, **distinct from `Beat.caption`** (on-screen karaoke text). Legacy
  `Ticket.captions {tt,ig,yt}` is migrated into `post_meta` (`_backfill_post_meta`) and is now
  DEPRECATED (kept only because SQLite can't drop a column; new code reads `post_meta`).
- `Beat.caption_timings` (JSON, nullable) — per-word VO timing, filled in P4.
- Proof flag stays per-beat toggleable (`Beat.is_proof_beat` + `PATCH /api/beats/{id}`).

### P4 — Assemble (refinements; base built `6be7100`)
- One assembler, BOTH intakes (long-form→clip 4a + native beat-slots 4b — both built).
- ffmpeg LOCAL subprocess; isolate ALL file I/O behind ONE service with
  `# FUTURE: cloud-worker swap` markers. No serverless.
- **Karaoke captions timed from the VOICEOVER** via `Beat.caption_timings` (NOT transcribed —
  words are known input, audio only times them). Current build even-splits; upgrade to real
  per-word timing. Submagic-style animated word highlight, brand font/colors.
- DO NOT add auto B-roll / auto emoji / auto SFX (break proof rule + brand voice).
- Proof guardrail must survive assemble (already blocks an empty proof-beat clip slot).

### P5 — Insights (refinements; base built `1261046`)
- Rank by SAVES + FOLLOWS, NOT views (done). One perf log per video at ~day 7 (not day 1).
- Add a **"Friday batch"** view: videos now 7+ days old, ready to log together.
- Saves often missing from APIs → MANUAL saves entry in the Perf editor (fallback).

### P6 — Publish — **FULL REBUILD (separate session)**; older Upload-Post version is being replaced
Current P6 = single provider hard-wired to Upload-Post (`pipeline/poster.py`), copy from the
legacy `Ticket.captions`, no abstraction / no Postiz / no per-ticket TikTok mode / no analytics.
Rebuild:
- **Publisher INTERFACE** so providers swap without a rewrite. Two adapters: **Postiz** (default,
  self-hosted Docker, own dashboard + API) and **Upload-Post** (fallback — refactor today's
  `poster.py` into this adapter).
- Push finished reel + `Ticket.post_meta` to a running, account-connected Postiz via its API;
  surface post status on the ticket (stay on the Cvideo board). Postiz dashboard stays available.
- **Per-ticket TikTok mode:** default (original audio) → auto-post; **"add trending audio" flag
  ON** → do NOT auto-post TikTok, route to draft / "finish in TikTok app". IG Reels + YT Shorts
  always auto-post. Verify Postiz TikTok draft mode; else flag the ticket + skip TikTok auto-post.
- Post copy reads from `Ticket.post_meta`.
- Process: first explain what current P6 does, rebuild, then **test ONE real post end-to-end
  before commit.**

### Measure (stats back)
- Pull metrics back through the same publisher adapter (Postiz/Upload-Post analytics) into `Perf`
  where available; fall back to manual entry (especially saves). One log ~day 7.
