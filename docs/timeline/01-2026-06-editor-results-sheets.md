# Cvideo — Session Context (editor fixes · reels · results · sheets)

> Snapshot of everything done this session. Pairs with `NEXT-SESSION.md` (handoff) and
> `CONTEXT.md` (how the app works). Branch: `session/handoff-and-record-trim-fix`.
> Working tree clean — all of the below is committed.

## Commits this session (newest → oldest)
- `03ac010` Editor: fix caption/teleprompter glitching on cuts & trims (ROOT CAUSE)
- `8a520c2` fix(sheets): Apps Script must loop the JSON array Cvideo posts
- `253d03c` Results: Brand column in the videos table
- `baf31b4` Results: brand picker on the perf logger (no silent NoCrapDiet)
- `2c01580` Results: track every reel/clip across TikTok, Instagram & YouTube
- `cd9e7ce` Reels: edit each scene as its own clip on the timeline
- `28be421` Multi-clip Clips editor + trim & cuts honored everywhere (incl. reels)
- `f1d623d` Compact board cards + Cut removes the cut region's captions
- `ce363f3` Fix clips cutting off the last word's audio + caption
- `2643285` Fix recording to start exactly at the trim point
- (`b4853c1` handoff doc refresh)

## 1. Editor — the big one (recording, trim, cut, captions)
- **Recording starts at the trim.** Recorder does **seek → mic → roll**; for reels the
  scene's record range is clamped to the trim. Preview re-parks to the first kept frame.
- **Cut genuinely removes the section** everywhere: captions (`remapWords`), teleprompter,
  preview video, and the scene-reel export (`render_scene_reel` splices cut ranges per scene,
  drops their words, compresses captions). Trim clamps each scene marker to `[start,end]`.
- **Multi-clip "Clips" tool.** Each kept segment is an editable block (trim/add/delete/split),
  built on the existing `start/end/cuts` storage.
- **Reels = each scene is its own clip.** The Clips timeline splits at persistent scene
  markers → 3 blocks not one; trim/split/delete each scene; "Add clip" hidden for reels.
- **Caption/teleprompter glitch — ROOT CAUSE fixed (`03ac010`).** The rAF loop seeked over a
  cut then did `setTime(v.currentTime)` — a STALE post-seek read — so the clock driving the
  overlays flashed the wrong word at every seam; `+0.12` also ate kept content. Now: ONE
  logical playhead computed per frame (seek only on drift, no overshoot), and ONE
  `editedTime = srcToEdited(time, segments)` clock drives BOTH captions and teleprompter with
  edited-time words (was a dual clock: captions edited-time, teleprompter source-time).
  Pattern lifted from OpenCut/Creatomate's program-clock model.
- **Clips no longer cut off the last word** (brain MIN/MAX re-snap to word boundary;
  `snapTrim` on the handles).

## 2. Results — per-video, per-platform tracking + brand
- `/api/insights` returns `videos[]` = every reel (any Clip with markers) + rendered clip +
  ticket-reel, each with `tt/ig/yt` metrics, `totals`, `brand`, `is_reel`.
- `log_perf` **UPSERTS** by `(video_kind, video_id, platform)` — re-logging updates, never
  double-counts.
- **VideoTracker UI**: one table of all videos (with a **Brand** column, TikTok/IG/YouTube
  columns, total). Pick one → 3-platform editor (prefilled) → save all three at once.
- **Brand picker (`baf31b4`).** New `Clip.brand` (+ migration). Dropdown: *— select brand —,
  NoCrapDiet, SemSeo, Real Dennis, Missedyu*. Pre-fills the resolved brand, blank when
  unknown. `_video_brand` **no longer falls back to NoCrapDiet** — returns `""` when unknown,
  so unlinked/long-form clips log blank (not mislabeled). Chosen brand persists on the
  clip/ticket and is used by the Sync backfill. NOTE: this means most existing reels now show
  a blank brand (they were silently NoCrapDiet before) — pick each once and it sticks.

## 3. Google Sheet bridge — LIVE (with one fix)
- `PERF_SHEET_WEBHOOK_URL` is set in `backend/.env` (gitignored) →
  `https://script.google.com/macros/s/AKfycbz…/exec`. `sheets.is_live()` = True. Verified a
  real push returned `{pushed}` OK.
- **BUG FOUND + FIXED (`8a520c2`):** Cvideo POSTs a JSON **array** `[{...}]`, but the pasted
  Apps Script read a single object → every text field (post_id/brand/platform/hook/…) landed
  BLANK while date fell back to today and numbers to 0. The repo's
  `docs/perf-sheet-AppsScript.gs` now normalizes to an array and loops.
  **ACTION PENDING (Dennis):** re-paste the corrected `.gs` into Apps Script → **Deploy a NEW
  VERSION** (URL unchanged) → re-test. Then delete the stray test rows (`clip_18`, `clip_1`,
  and any `__CVIDEO TEST__` row).
- Contract unchanged (A–M, no score — the Sheet computes Score/Verdict). One-way Cvideo→Sheet.

## Gotchas (carry forward)
- **Rebuilding a reel wipes its edits** — "Make my video"/`build-edit` resets `start=0`,
  `cuts=null`, fresh markers. Trim AFTER building. (Candidate task: preserve trim/cuts on rebuild.)
- **Voiced scenes are VO-duration-locked** — trimming a voiced scene changes which frames
  show, not the output length. Shortening is clean for scenes without a voice.
- **Backend crashed twice this session** — if Results/Home 500s, it's just down; restart it
  (`cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`).

## Open / next
- **Finish the Sheet** — re-deploy the fixed Apps Script + confirm a real branded row lands.
- **Preserve trim/cuts on reel rebuild** (small `build-edit` change).
- **Editor: user still calls it the weak spot.** Root-cause caption fix shipped; if it still
  feels rough, the bounded option discussed is lifting OpenCut's timeline+playback layer as a
  "view" over the existing `start/end/cuts/markers/scene_vos` model + server ffmpeg render
  (NOT a full migration — data model + export must stay ours; verify OpenCut's license first
  re: sellability). Offered to recon OpenCut's engine for real liftability numbers.
- **Hook library** (requested, not built): seed proven hook formulas → AI-expand to ~1000
  brand-tagged → inject into `ai.py` → "Pick a hook" picker. Open Q: niche-locked vs general.
- **Posting** still Upload-Post dry-run (`poster.py`); needs `UPLOAD_POST_USER` to go live.

## Run / verify
- Backend: `cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000` (no --reload).
- Frontend: `cd frontend; npm run dev`. Verify: `npm run build` → 0 TS errors; `python -c "import app.main"` clean.
- Preview MCP note: the headless preview can't actually DECODE/PLAY video, so playback
  smoothness must be eyeballed on a real machine; screenshots can hang — use DOM reads.
