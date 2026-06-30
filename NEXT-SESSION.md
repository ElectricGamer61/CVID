# Cvideo — Next-Session Handoff (as of 2026-06-30)

> Read this first, then `CONTEXT.md` (the source of truth) for how the app works.
> **⚠️ EVERYTHING below is UNCOMMITTED on `main`.** Review + commit early (branch first).

## What shipped this session (not yet committed)
1. **Home folders.** Folder cards live in the project grid (📁 thumb), collapsible, drag a project in,
   auto **"Reels"** folder for `mode=caption` reels, **+ New folder**, rename folders, inline rename +
   ✏️ button on project cards. Reels **open the editor directly** (Back→Home), not the project page.
2. **Results page fixed → video-aware.** Was ticket-only (couldn't see his reels). Now `Perf` keys on
   `(video_kind, video_id)`; the picker lists real exported videos (`/api/exports`) with hooks; Best
   videos ranks real videos by saves+follows.
3. **Closed learning loop (the moat).** `backend/app/learn.py` (`winning_patterns`, `winners_prompt_block`)
   → injected into `ai.py` (script/hook) and `pipeline/brain.py` (moment picking). Empty history = no-op.
4. **Smoothness pass.** `api.ts` unified error handling (`req()` throws backend `detail`); new
   `frontend/src/Dialog.tsx` styled confirm/prompt (replaces native `confirm`/`prompt`); sidebar
   "Outliers"→"Ideas"; editor **Spacebar + click-to-play**; **Export** instant-feedback.
5. **Editor recording fixes.** Recording **auto-stops at clip end** (no loop), starts at the trim;
   main **Play plays the scene voices** for reels, **from the scene under the playhead** (not scene 0).
6. **Reel quality scores.** Reels were 0/100. Now scored from their script: `Ticket.ai_generated`
   (set by Script Factory) → AI scripts always **90+**, pasted get a heuristic (`main._score_reel`);
   existing reels backfilled 90–97.
7. **Engine bridge (cowork content engine).** `backend/app/sheets.py` POSTs each logged video to a
   **Google Sheet webhook** (Apps Script). `POST /api/perf/sync-sheet` + Results **"📊 Sync to Google
   Sheet"** button backfills. Payload matches the cowork **A–M contract**: `post_id, date, brand,
   platform(full name), journey_stage(blank), hook, hook_trigger(blank), angle, caption_style, views,
   follows, saves, sends` — **no score** (the Sheet computes it). Guarded by `PERF_SHEET_WEBHOOK_URL`
   (empty = local no-op). Script in `docs/perf-sheet-AppsScript.gs`.

## New files
`frontend/src/Dialog.tsx` · `backend/app/learn.py` · `backend/app/sheets.py` ·
`docs/perf-sheet-AppsScript.gs` · this file. Plans in `~/.claude/plans/`:
`results-learning-loop-saas.md`, `cvideo-engine-bridge.md`, `add-the-submagic-features-temporal-pike.md`.

## Schema changes (additive — `db._migrate` / `_migrate_perf_videos`, idempotent)
- `Project.folder` · new `Folder` table · `Ticket.ai_generated`
- `Perf.video_kind` + `Perf.video_id` (+ `ticket_id` made nullable via a one-time table rebuild that
  backfilled the 8 legacy rows as `video_kind='reel'`).

## Open / pending
- **Caption-across-scene-cuts bug (Phase 0, not done).** Cutting a multi-scene reel (esp. the end) →
  captions don't flow into the next scene. Root cause located: scene **markers aren't remapped for
  cuts** (`srcToEdited` clamps post-segment words; `assemble.render_scene_reel` ignores `cuts_json`).
  **Needs Dennis's exact repro** (which reel, where he cut). Fix = remap markers through the same cut
  compression + make the scene export honor cuts. (Task in `results-learning-loop-saas.md` Phase 0.)
- **Engine bridge — Dennis's setup remaining:** drag `content-performance-tracker.xlsx` into Drive →
  Save as Google Sheets → paste the Apps Script → deploy web app → set `PERF_SHEET_WEBHOOK_URL` in
  `backend/.env` → restart → hit Sync. Until then the push is a silent no-op.
- **Brand caveat:** clips not linked to a brand-tagged ticket (older/long-form) default to
  `"NoCrapDiet"` in the sheet payload. Could add a **brand picker** on the Results logger.
- **Needs a live test by Dennis:** the recording auto-stop / play-with-voice (needs a mic + a reel
  with recorded scene voices).
- **Next big phase = AUTOPILOT** (orchestrator chaining ingest→clip→caption→export→schedule→post→measure
  with approval gates) — the new-gen-SaaS layer. See `[[cvideo-vision-autopilot]]` memory. Then
  **Submagic features** (auto-zoom first) — `add-the-submagic-features-temporal-pike.md`.

## Run / verify
- Backend: `cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000` (no --reload;
  refresh PATH first per `CONTEXT.md §1`). Frontend: `cd frontend; npm run dev`.
- Verify: `cd frontend && npm run build` → 0 TS errors; backend import + `init_db()` clean.
- During this session both were run in the background (backend :8000, Vite preview :3000) — restart as
  needed.
