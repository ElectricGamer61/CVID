# Cvideo — Next-Session Handoff (editor + reels + results)

> Read this first, then `CONTEXT.md` (source of truth for how the app works).
> Branch: `session/handoff-and-record-trim-fix`. All work below is **committed**.

## What shipped this session (committed)
1. **Recording starts exactly at the trim** (`2643285`, then refined). The voice recorder now
   **seeks → starts the mic → rolls** so a take begins on the trimmed frame, never the old
   pre-trim frame. Preview re-parks to the first kept frame after a trim. For reels, a scene's
   record range is clamped to the trim (a scene that begins before the trim records FROM it).
2. **Clips no longer cut off the last word** (`ce363f3`). Brain MIN/MAX clamps re-snap to a
   word boundary; editor trim handles snap off mid-word (`snapTrim`).
3. **Compact board cards** (`f1d623d`). "Create videos" cards are compact horizontal rows
   (~64px) instead of tall vertical cards — many fit per lane without scrolling.
4. **Cut actually removes the section** (`f1d623d`, `28be421`). Cut words are dropped from
   captions (`remapWords`/`remap_words_for_cuts`) AND the teleprompter (`keptWords`); the
   scene-reel export splices cut ranges out of each scene, drops their words, and compresses
   the captions. No more "the cut part is still there."
5. **Multi-clip "Clips" editor** (`28be421`). New **Clips** tool: each kept segment is an
   editable block on the timeline — trim each edge, add a clip from the source, delete, split.
   Built entirely on the existing `start/end/cuts` storage (no schema change); the backend
   already concatenates an arbitrary segment list.
6. **Reels = each scene is its own clip** (`cd9e7ce`). For a stitched reel the Clips timeline
   shows **3 scene blocks, not one** (split at the persistent scene markers). Trim/split/delete
   each scene independently; "Add clip" is hidden for reels. Trim/cut maps to `start/end/cuts`,
   which the scene-reel export honors (clamp each marker to the trim; drop a scene fully cut
   away). Markers stay intact.
7. **Trim honored everywhere for reels** (`28be421`). `render_scene_reel` clamps each scene
   marker to `[start,end]`, drops scenes trimmed away, keeps `scene_vos` aligned. Teleprompter,
   captions, scene preview (`runScene`/`selectScene`), and export all start at the trim.
8. **Results: per-video, per-platform tracking** (`2c01580`). `/api/insights` returns
   `videos[]` (every reel + rendered clip + ticket-reel, each with tt/ig/yt metrics + totals).
   `log_perf` now **UPSERTS** by `(video_kind, video_id, platform)` — re-logging updates the
   numbers instead of double-counting. New **VideoTracker** UI: one table of all videos with
   TikTok/Instagram/YouTube side by side; pick a reel → edit all 3 platforms (prefilled) → save.

## Key files touched
`frontend/src/App.tsx` (Clips tool, FilmstripTimeline blocks, recording, VideoTracker,
PlatformEditor), `frontend/src/api.ts` (VideoPerf type), `frontend/src/index.css`,
`backend/app/main.py` (insights `videos[]`, `log_perf` upsert, scene-reel trim clamp),
`backend/app/pipeline/assemble.py` (`render_scene_reel` honors cuts + drops deleted scenes),
`backend/app/pipeline/brain.py`.

## Important behaviors / gotchas
- **Rebuilding a reel wipes its edits.** "Make my video" / `build-edit` (`main.py:~1103`)
  regenerates the reel Clip and resets `start=0`, `cuts=null`, fresh markers. So **trim AFTER
  building**, and don't re-build after editing. *Possible next task: preserve trim/cuts on rebuild.*
- **Voiced scenes are VO-duration-locked.** Trimming a scene that has a recorded voice changes
  which frames show (video loops/stretches to the VO), not the output length. Trimming shortens
  cleanly for scenes without a voice (or before recording).
- **Record then trim is order-sensitive.** A scene voice recorded before a trim won't line up;
  re-record that scene after trimming for exact sync.
- **A scene's split with no gap is transient** (collapses on reload) — only matters as a step
  before trim/delete, which creates a real gap that persists.

## Open / pending
- **Google Sheet bridge still dormant.** `sheets.py` + `/api/perf/sync-sheet` push every logged
  video to a Google-Sheet webhook, but `PERF_SHEET_WEBHOOK_URL` isn't set. Dennis to: Drive →
  Save xlsx as Google Sheet → paste `docs/perf-sheet-AppsScript.gs` → deploy web app → set the
  env var → restart → "📊 Sync to Google Sheet". (One-way Cvideo→Sheet; the Sheet computes score.)
- **Hook library (requested, not built).** Plan agreed: a seeded bank of proven hook *formulas*
  → AI-expand to ~1000 brand-tagged hooks → inject into `ai.py` (like `learn.winners_prompt_block`)
  → "Pick a hook" picker on New video / Ideas. No scraping. Open question: niche-locked vs general.
- **Preserve trim/cuts on reel rebuild** (see gotcha above) — small `build-edit` change.
- **Posting to 3 platforms** is still the Upload-Post dry-run adapter (`poster.py`); going live
  needs `UPLOAD_POST_USER` set. The Results tracker is manual-entry today.

## Run / verify
- Backend: `cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000` (no
  --reload). **NOTE: the backend crashed mid-session once** — if Results/Home 500s, it's just
  down; restart it. Frontend: `cd frontend; npm run dev`.
- Verify: `cd frontend && npm run build` → 0 TS errors; `python -c "import app.main"` clean.
- This session was verified live via the preview MCP (Reel 10 scene editing; Results 3-platform
  tracking). Screenshots can hang on this machine — use DOM reads instead.
