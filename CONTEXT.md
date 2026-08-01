# Cvideo — Project Context

A local, free clone of wayinvideo / OpusClip. Two creation paths, one editor:
1. **Long-form → shorts:** paste a YouTube URL (or upload), transcribe → AI picks viral moments →
   9:16 reframe → TikTok captions → editor → export.
2. **Native reels:** write a script (scenes), film/upload a clip per scene, **record a voiceover per
   scene**, and assemble into a 9:16 reel — edited in the **same clip editor**.

Runs entirely on this machine. Built to replace a paid wayinvideo sub.

> This file is the single source of truth for *how Cvideo works today*. `GOAL.md`/`SPEC.md` are the
> original spec; `README.md` is setup. When in doubt, trust this file + the code.

---

## 1. How to run

Two servers. **Every shell must refresh PATH first** (winget installed ffmpeg/ollama into the
registry PATH, but already-running shells have a stale env):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
```

- **Backend** (FastAPI, port 8000):
  `cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`
- **Frontend** (Vite, port 3000 per `vite.config.ts`, proxies `/api` → 8000): `cd frontend; npm run dev`
- One-click: **double-click `start.cmd`** (repo root) → `scripts\start.ps1` launches both + opens
  http://localhost:3000. (`start.ps1` is ASCII-only — em-dash/`…` chars broke PowerShell 5.1 parsing.)
  **The backend runs in a supervised restart loop** (auto-restarts in ~2 s if uvicorn dies) with all
  output tee'd to **`data/backend.log`**, in a **minimized** window (dodges the QuickEdit-freeze trap
  where a click in the console pauses stdout and hangs the server).
- The backend reads `backend/.env` (gitignored) for API keys. **No `--reload`** — the supervised loop
  restarts on crash, but you still restart manually after changing `.env` or backend code.
- **One-click launch:** the **Cvideo desktop shortcut** (and `open-cvideo.cmd`) runs
  `scripts\open-cvideo.ps1` — starts the server only if it isn't already up (supervised, minimized,
  local `127.0.0.1`), waits for `/api/health`, then opens the app in a **Chrome/Edge `--app` window**
  (no tabs, looks native). ~3 s when the server's already running. Icon: `assets\cvideo.ico` (Pillow-
  generated). **Health checks MUST use `127.0.0.1`, never `localhost`** — Windows resolves `localhost`
  to IPv6 `::1` first but uvicorn listens on IPv4, so a `localhost` probe hangs ~2 s/try (this bit the
  launcher: a 60 s hang + failed launch until switched to `127.0.0.1`).
- **Server mode (one port, multi-device):** `scripts\serve.ps1` builds the UI and lets the **backend
  serve it**, so the whole app is a single url on **port 8000 bound to `0.0.0.0`** — no Vite server,
  no CORS. `main.py` mounts `frontend/dist` at `/` (StaticFiles, **only when `dist/` exists**, mounted
  LAST so it never shadows `/api`; absent → dev falls back to the two-server Vite flow). Reach it from
  another device on the same wifi at `http://<pc-ip>:8000`, or **from anywhere via Tailscale** (install
  on both devices → `http://<tailscale-name>:8000`; the desktop keeps doing the GPU work, the other
  device is just a screen). The React client already uses **relative `/api` paths**, so same-origin
  serving needs zero code changes on the frontend. **`allow-network.cmd`** (self-elevating
  `scripts\allow-network.ps1`) adds the one-time Windows Firewall rule (inbound TCP 8000, **Private
  profile only**) so phone/laptop can connect. Same-wifi URL prints from the machine's LAN IP
  (e.g. `http://192.168.12.110:8000`); "from anywhere" = install Tailscale on each device. The app is
  mobile-usable (no horizontal overflow; Shoot Drop's drop zone is tappable → upload from the phone's
  camera roll straight to the desktop engine), though heavy editing is best on a laptop/desktop.

**Repo is under git** (branch `main`); `.gitignore` covers `data/`, `backend/.venv/`,
`frontend/node_modules/`, `.env`, `*.log`, `*.tsbuildinfo`. Stack = FastAPI + SQLite + React with
Claude Code — **NOT Lovable/Supabase** (see `SPEC.md`'s stack-override header).

---

## 2. Machine / environment (verified)

- **GPU:** RTX 5070 (Blackwell, `sm_120`, 12 GB). Transcription runs **on GPU** via
  faster-whisper / CTranslate2 (no PyTorch). **Do NOT add PyTorch/mediapipe.**
- **Python:** 3.11 venv at `backend/.venv` (system `py` is 3.13, too new for the ML stack).
- **Tools:** ffmpeg 8.x, Ollama (qwen2.5:7b), Node 24, yt-dlp (keep updated: `pip install -U yt-dlp`).
- **CUDA DLL gotcha:** `transcribe.py::_register_cuda_dlls()` adds the pip `nvidia/*/bin` dirs via
  `os.add_dll_directory` at import, else CTranslate2 errors "cublas64_12.dll not found".

---

## 3. Pipeline (backend/app/pipeline/)

Long-form: `ingest → transcribe → brain → (reframe + captions) → render`.
Native reel: scenes (Beats) → `build_edit_video` (stitch to one editable video) → editor → export
via `render_scene_reel` (voice-first) or `assemble_ticket`.

- **ingest.py** — URL downloads: `download_audio()` (analysis), `download_proxy()` (360p preview),
  `download_full()` (full video, fetched **once** on first export, cached `source.mp4`). Uploads use
  `save_upload`. **Two audio extractors:** `extract_audio()` = 16 kHz mono (for Whisper);
  **`extract_voiceover()` = 48 kHz stereo** (for recorded voice that ends up in the export — do NOT
  run voiceovers through the 16 kHz Whisper path or they sound bad).
- **transcribe.py** — `local` faster-whisper (GPU→CPU fallback) / `elevenlabs` Scribe. Output → `words.json`.
  **Runs in a subprocess** via `transcribe_worker.py` (`jobs._transcribe_subprocess` spawns
  `python -m app.pipeline.transcribe_worker`): a native cuBLAS/cuDNN crash on the Blackwell GPU kills
  only the child (non-zero exit → project marked errored), never the API. Progress streams back as
  `PROGRESS <pct> <msg>` stdout lines. Trade-off: the whisper model reloads per analyze (no in-process cache).
- **brain.py** — viral-moment picker: `claude`/`ollama`/`gemini`/`heuristic`. Virality-framework prompt,
  chunking + cross-chunk de-dupe, sentence-boundary snapping. Fields must be in `_CLIPS_SCHEMA` required.
- **reframe.py** — 9:16 crop center via OpenCV **YuNet DNN** (+ Haar fallback). `crop_filter()` builds
  the ffmpeg crop+scale. **No MediaPipe.** **Detection never fails the export:** an OpenCV build
  without the Haar XML raises `!empty()` out of `detectMultiScale` (it doesn't just find nothing),
  which used to kill the render and dump a raw C++ assertion into the editor. `_haar_cascade()`
  checks `cascade.empty()` up front and `detect_center()` catches anything else, falling back to a
  mid-frame crop — the behavior the docstring always promised. Covered by `backend/test_reframe.py`.
- **captions.py** — word-synced ASS. `PRESETS` capcut/hormozi/beasty/clean (mirrored in
  `captionStyles.ts`). `build_ass(words, clip_start, clip_end, preset, overrides, out_w, out_h)`.
  **Inline color must be `{\1c&HBBGGRR&}`** (6-digit + trailing &). ASS keeps a 1080×1920 PlayRes
  baseline; libass scales it to the real frame — **don't pass real out_w/out_h to `write_ass`** for
  hi-res, only to the render's crop/scale.
- **render.py** — clip export. Three paths, chosen in `main._render_clip_job`:
  - **plain** `render_clip(... voiceover=?)` — cut [start,end] → crop → burn ASS. If the clip has a
    `voiceover`, it's muxed as the audio (`-map 1:a:0 -shortest`).
  - **middle-cuts** `kept_segments()` + `render_clip_segments()` — when `cuts_json` removes inner
    ranges: trim+concat the kept pieces (filter_complex) and **re-time captions** onto the compressed
    timeline (`remap_words_for_cuts`).
  - **per-scene reel** → delegates to `assemble.render_scene_reel` when a reel clip has scene voices.
  - Output dims from `settings.output_dims(aspect, resolution)` (1080p/1440p/4k tier).
- **assemble.py** — reel building (local ffmpeg). All joins go through **`_concat_segments()` which
  uses the ffmpeg concat *FILTER*** (normalizes size/fps/SAR, resets PTS, gapless audio) — this is
  what keeps clip-to-clip joins **stutter-free** (the old concat *demuxer* left timestamp + AAC
  encoder-priming gaps at every boundary). Functions:
  - **`build_edit_video(ticket_id, project_dir)`** — stitch a ticket's Beat clips (natural length,
    9:16) into one `source.mp4`, returning scene **markers** `[{start,end,label}]` and caption
    **words** (each Beat's `caption` text `_even_split` across its length — no transcription). Backs
    the "edit a reel in the normal editor" flow.
  - **`render_scene_reel(source, out, markers, words, scene_vos, preset, style)`** — **voice-first
    export:** per scene, cut [s,e] from source, loop/hold to that scene's voiceover duration, even-
    split its caption words across the voice, mux the voice, then `_concat_segments`. So each scene
    takes exactly as long as you spoke (readable + natural). Scenes with no voice keep natural length.
  - **`assemble_ticket(ticket_id)`** — original native path (per-Beat render via `_render_beat` +
    concat) → `data/tickets/{id}/reel.mp4`. Proof-guard on number-claim beats.
- **ai.py** — Script Factory + Hook Forge + **`post_copy(brand, hook, script)`** (fills
  `Ticket.post_meta` from the ticket's own script; reuse brain clients; heuristic fallbacks).
- **shootdrop.py** — **Shoot Drop batch intake** (record → dump files → done): each raw clip is
  transcribed (`jobs.transcribe_subprocess`, ElevenLabs when key set else local) then **matched by
  what was said** (deterministic `match_score` = max(difflib ratio, 0.9·vocab-containment),
  threshold 0.55) against open native tickets' unfilled beats → auto-attached
  (`attach_clip_to_beat`, same write as the manual upload) + auto-named
  `{ticket}_scene{N}.mp4`. Leftovers become a NEW ticket whose script is reverse-generated from
  the transcripts (one beat per clip, mtime order). When a ticket's scenes all fill,
  `after_footage` bumps stage→sourced + auto-fills `post_meta`. Rows persist in **`IngestClip`**.
  Two entry points: `POST /api/shootdrop` (in-app drop zone) + a **watched folder**
  (`SHOOT_DROP_DIR` in `backend/.env`; `jobs.start_shootdrop_watcher` polls every 10 s,
  size-stable pickup, moves files out; unset = off).
  **Silent B-roll is first-class:** `_transcript_for` returns `""` when a clip has no audio track
  (extract_audio fails) or transcription hiccups — the clip becomes `unmatched` (waits in the board),
  never errors. Only clips with `>= MIN_SPEECH_WORDS` (4) real words can auto-invent a reverse ticket,
  so the common "I voice it over later" workflow leaves clips for manual drag-placement.

`jobs.py` runs long-form analysis in a background thread. **`Project.mode`**: `moments` (default,
run the brain) or `caption` (skip brain, make ONE full-length clip — used by "Just caption my clip"
uploads AND by `build-edit` reels).

---

## 4. Data model (backend/app/db.py, SQLite via SQLModel)

- **Project**: name, source_type (url|file), source_url, brain, transcribe_backend, aspect,
  caption_preset, **mode (moments|caption)**, status, stage, progress, error, duration.
- **Clip**: project_id, idx, start, end, title, score, hook, reason, aspect, caption_preset,
  resolution (1080p|1440p|4k), crop_center, status, stage, output_path, error, **style_json**
  (caption style), **words_json** (edited caption words), **cuts_json** (removed middle ranges
  `[[a,b],…]`), **markers_json** (scene boundaries when stitched from a reel), **voiceover_path**
  (whole-clip recorded voice), **scene_vo_json** (per-scene voices, aligned to markers). Additive
  columns added by `_migrate()` on startup.

**Pipeline lifecycle tables:**
- **Ticket** (spine): brand, stage (outlier→posted), angle, outlier_id, format, capture_mode
  (longform-clip|native-short|repurpose), **project_id** (set by `build-edit`/`use-clip`), source_ref,
  hook_text, clip_url, platforms (JSON), scheduled_at/posted_at, folder (Downloads override).
  **`post_meta`** (JSON) = per-platform PUBLISH copy `{tt:{caption,hashtags}, ig:{caption,hashtags},
  yt:{title,description,tags}}` — the "post box" text, **distinct from `Beat.caption`** (on-screen
  karaoke). `captions {tt,ig,yt}` is **DEPRECATED** — migrated into `post_meta` by
  `db._backfill_post_meta`; new code should read `post_meta` (wired in the P6 publisher rebuild).
- **Beat** (script-as-timeline): ticket_id, order_index, spoken_line, on_screen_text, caption,
  shot_cue, clip_path?, voiceover_path?, is_proof_beat, **`caption_timings`** (JSON, nullable —
  per-word VO timing, filled in P4 for karaoke captions; words are known, audio only times them).
- **Outlier** (swipe file), **Perf** (per-platform stats), **Angle** (`avg_score` = avg of
  `learn.perf_score` — see §7 scoring note; no longer a raw saves+follows sum).
- **IngestClip** (Shoot Drop): batch_id, filename, path, mtime, transcript, status
  (pending|transcribing|matched|unmatched|assigned|discarded|error), ticket_id?, beat_id?,
  confidence (matcher score; 0 = manual/new-ticket), error.

---

## 5. API (backend/app/main.py)

- **Projects:** `POST /api/projects` (url) · `POST /api/projects/upload` (file) — both take brain,
  transcribe_backend, aspect, caption_preset, **mode**. `GET /api/projects` · `GET /{pid}` ·
  `DELETE /{pid}` · `/{pid}/source` · `/{pid}/thumb` · `/{pid}/frame?t=`.
- **Clips:** `PATCH /api/clips/{cid}` (start/end/title/caption_preset/aspect/crop_center/style/words/
  **cuts**) · `POST /{cid}/render` · `GET /{cid}/download|/preview|/thumb` · `DELETE /{cid}` ·
  `POST /{cid}/auto-center`.
  - **Clip voiceover (whole-clip):** `POST /{cid}/voiceover` (48 kHz via `extract_voiceover`) ·
    `GET /{cid}/voiceover-file` · `DELETE /{cid}/voiceover` · **`POST /{cid}/tts-voiceover`** (ElevenLabs AI voice).
  - **Per-scene voiceover (reels):** `POST/GET/DELETE /api/clips/{cid}/scene-voiceover/{idx}` +
    **`POST /{cid}/scene-tts/{idx}`** (ElevenLabs AI voice for ONE scene; text defaults to that scene's
    caption words). So "record it or generate it" is one flow — per-scene for reels, whole-clip for long-form.
- **Tickets:** `POST /api/tickets` · `/from-script` · `/{tid}/import-script` · `GET /api/tickets` ·
  `GET /{tid}` · `PATCH /{tid}` · `DELETE /{tid}` · `GET /{tid}/thumb` (reel poster) ·
  **`POST /{tid}/build-edit`** (stitch a native reel's scenes into one caption-mode Project+Clip with
  markers+words, then open it in the editor) · `/{tid}/script-factory` · `/{tid}/hook-forge` ·
  `/{tid}/assemble` (+ `/assemble-status`) · `/{tid}/use-clip/{cid}` · `/{tid}/download`.
- **Beats:** `PATCH /api/beats/{bid}` · add/`DELETE`/reorder · `POST /{bid}/clip` · `/{bid}/voiceover`.
- **Schedule/post (P6):** **`GET /api/queue`** → `{dry_run, platforms, ready[], scheduled[], posted[]}`
  (each card carries `has_video`). **`POST /api/tickets/{tid}/schedule`** (set `scheduled_at`/`platforms`/
  `captions`, stage→`scheduled`; null `scheduled_at` clears → back to `ready`). **`POST /{tid}/post`**
  (body: `platforms`, `caption`, optional **`scheduled_at`**) → `pipeline/poster.post_reel` against the
  Upload-Post API (dry-run unless key set); `scheduled_at` set → stage `scheduled`, else stage `posted`.
- **Outliers:** CRUD + `POST /api/tickets/from-outlier/{oid}`.
- **Insights:** `POST /api/perf` · `GET /api/insights` (now also returns **`by_platform`**
  per-channel views/follows/saves/sends/score + **`trend`** totals-per-capture-day). **`GET /api/exports`** — all rendered clips +
  reels, each with folder metadata: `group` (brand for reels / project for clips), `subgroup`
  ("Reels"/"Clips"), `hook`, `filename` (hook-based).
- **Presets:** `GET /api/presets` — captions, caption_styles, aspects, brains, transcribe,
  resolutions, stages, formats, capture_modes.
- **Script import:** `intake.parse_script(text)` → `{hook, beats[]}` (deterministic, no LLM).
- **Shoot Drop:** `POST /api/shootdrop` (multipart multi-file → batch → queued on the jobs worker) ·
  `GET /api/shootdrop` → `{clips[] (+ticket_label/scene_index), watch_dir, open_scenes[]}` ·
  `POST /api/shootdrop/clips/{icid}/assign` (`{beat_id}` or `{new_ticket:true}`; clears the old
  beat's footage on re-assign) · `DELETE /api/shootdrop/clips/{icid}` (discard → scene needs
  footage again) · `GET /api/shootdrop/clips/{icid}/file` (stream the raw take → the review card's
  ▶ preview lightbox, so a match can be eyeballed; supports range requests). **`POST /api/tickets/{tid}/post-copy`** → `ai.post_copy` fills `post_meta`
  (also auto-runs when Shoot Drop fills a ticket's last scene); `PATCH /api/tickets/{tid}` now
  accepts `post_meta` for hand edits.

---

## 6. Frontend (frontend/src/, React + Vite + TS, plain CSS)

Light "Soft-UI" theme (Plus Jakarta Sans). **Sidebar:** **Create videos** · **Ideas** · Projects ·
**Schedule** · Results · Downloads (internal routes: board/intake/home/queue/insights/library).
**The app opens on Create videos** — making a video is the daily loop; the long-form clipper and
its library live one click away under **Projects** (the old "Home", renamed so the label matches
its own heading and breadcrumb; the logo button goes to the board too).
**There is no Autopilot tab** — autopilot is a per-video *mode*, not a place (see below),
and by default it isn't visible at all (see **Advanced mode**).
Plain-language UI: a ticket = "video", a beat = "scene", an outlier = an "idea".
`sidebarViewFor(route)` maps a route to the lit sidebar item — a video **and the editor opened from
it** both stay under Create videos, so the sidebar never disagrees with where you came from.

- **Advanced mode** (`frontend/src/advanced.ts`) — one flag that separates the daily loop from the
  launch-gated machinery. **Off by default.** Turn it on with `?advanced=1` or the ⚙ **Advanced**
  button at the bottom of the sidebar (`?advanced=0` / clicking again turns it off; the choice is
  kept in `localStorage["cv.advanced"]`). OFF hides: the board's Autopilot strip + "Needs you"
  filter, card 🤖/gate badges, the per-video Autopilot toggle and the Approve/Regenerate/Kill gate
  panel, and every multi-brand picker (everything uses `ACTIVE_BRAND` = NoCrapDiet, the only loaded
  cartridge). Nothing is deleted and no backend behavior changed — `useAutopilot` simply stops
  polling `/api/autopilot/state` when the flag is off, and new videos are created with
  `autopilot: false` so the loop can't quietly drive a video whose controls are hidden.

- **App.tsx** — routes (home | board | intake | insights | library | project | **editor** with an
  optional `from:"board"`), shell, and all screens + the **ClipEditor** workspace. A top **backend-offline
  banner** polls `GET /api/health` every 5 s and warns "edits are NOT saving" the instant the server dies.
- **Autopilot = a mode, folded into the board, behind Advanced mode** (`useAutopilot(enabled)` hook +
  `GATE_LABEL`/`isGated`/`GATE_POINTS`).
  In Advanced mode the board header has an **Autopilot strip** (Start / Pause / Run once) and a **"Needs you (N)" filter**
  that shows only gated videos. Cards carry a 🤖 badge + a "⏸ Needs your OK" gate badge. The
  Approve / Regenerate / Kill actions live in the video workspace (`VideoWorkspace`), which also shows the
  gate points ("Pauses for you at: script · reel · post") whenever a video is on autopilot. Backend
  autopilot state is unchanged — this was a pure frontend re-home of the old separate tab.
- **Projects / NewProject** ("Clip a long video") — paste URL or upload. A **mode toggle**: "Find
  viral moments" (default) vs **"Just caption my clip"** (caption mode → one full-length clip →
  auto-opens the editor). Brain / transcription / aspect / caption style are folded into an
  **`<details>` "Options"** disclosure whose summary lists the current picks (`optionsSummary`), so
  four technical menus aren't the loudest thing on the screen while the defaults are nearly always right.
- **Ideas (Intake) — 📼 Shoot drop card** (`ShootDrop`): drag a whole shoot in (or the watched
  folder); live per-clip list (⏳/👂 listening/→ matched chip with ticket · scene · confidence),
  an **editor-style drag-and-drop sorting board** (`.sd-board`): left = clip **thumbnail cards**
  (`.sd-clip`, `draggable`; thumb via `/api/shootdrop/clips/{id}/thumb`, click to watch via
  `VideoModal`); right = each open video's empty scenes as **drop slots** (`.sd-slot`, grouped by
  ticket) + a "✨ new video from this clip" drop zone. Drag a clip onto a slot → `shootdropAssign`.
  Auto-matched (talking) clips show as placed/green; **silent B-roll waits in the bin** to be dragged.
  Polls 2.5 s while working, 10 s idle.
- **Video workspace — 📣 Post copy card** (`PostCopyCard`, in the vw-rail): "🪄 Write my post copy"
  → editable per-platform fields (TT/IG caption+hashtags, YT title/description/tags) saved via
  `patchTicket({post_meta})` on blur, "↻ Rewrite it" regenerates.
- **Create videos** (Board) — redesigned: the 8 DB stages collapse to **4 phase lanes** (`PHASES`:
  Idea / Make it / Ready / Posted) with accent colors; cards show a reel thumbnail, the hook, mode
  badge, ◀▶ phase move. **+ New video** modal is **paste-first**: angle + a always-open "Paste your
  script" box (→ `intake.parse_script`, deterministic, no LLM) as the primary action, with "write it
  in the workspace" and "✨ Let AI draft one" (create + script-factory) demoted to link-sized
  fallbacks underneath. A scene-less video workspace opens the same paste box expanded. Clicking a card opens **TicketDetail**; a native reel's
  **"✏️ Open in editor"** calls `build-edit` and routes into the clip editor.
  An **empty board** replaces the four blank lanes with one "Make your first video" panel + CTA.
- **Video workspace guidance** — a **Next line** under the stage stepper says what to do now
  (`nextStepFor` → `NEXT_STEP_HINT`): the same rule the board groups "Make it" by, so the two can't
  disagree. `makeStepOf` short-circuits to `footage` for every non-`native-short` capture mode (they
  come from footage you already have, ingested and exported on **Projects**, so the scene checklist
  would name controls neither screen renders) and otherwise walks script → clips → voice → build;
  the workspace re-runs it against the scenes actually loaded (`makeStepOfBeats`) and adds a `done`
  step once `clip_url` exists. Every key `makeStepOf` returns needs a `MAKE_STEPS` lane heading or
  the board drops those cards silently. The rail is ordered by use — **🎬 Make the video** (the only primary button) ·
  **📣 Post copy** · **✨ AI draft** collapsed into a `<details>`, since pasting a script is the
  normal path and the AI draft is the blank-day fallback. Scene rows show only "what you say" +
  "what to film"; the on-screen-text and caption fields sit behind **More options**
  (`beatHasCustomDetails` keeps them open when they hold something other than an echo of the spoken
  line, which is what `intake.parse_script` writes into `caption`).
  **"Make my video" is disabled while a proof scene has no clip** — that's the same precondition
  `POST /api/tickets/{id}/assemble` enforces with a 400, said before the click instead of after.
  With AI voice on and no `ELEVENLABS_API_KEY`, the card warns up front (`GET /api/presets`
  → `tts_available`, the key check only — `GET /api/tts/voices` also calls ElevenLabs and is
  reserved for the editor's voice picker) rather than letting the build run and fail partway.
- **TicketDetail** drawer — edit ticket + per-beat fields, add/reorder/delete scenes, proof toggle,
  AI buttons, per-beat clip/voiceover upload, "Open in editor" + "Make my video" (assemble).
- **Downloads (Library)** — **collapsible folders**, each listing its videos as **draggable rows**
  (`.exp-rows`/`.exp-row`, not a grid). **Drag a video onto another folder to move it** (HTML5 DnD;
  folders highlight on drag-over) or onto the **"＋ new folder"** drop zone (prompts a name). The move
  persists via **`PATCH /api/exports/{kind}/{id}/folder`** → `Clip.folder`/`Ticket.folder` override
  (empty clears → back to the default group = brand for reels / project for clips). **Rename a folder**
  via the ✏️ button (or double-click its name) — re-tags every video in it (loops the same PATCH per
  item). **Click a row's thumb → `VideoModal`** preview. `downloadFile()` saves to a remembered folder (Chromium
  `showDirectoryPicker` persisted in IndexedDB via `exportDir.ts`); Firefox/Safari fall back.
- **ClipEditor** (`.ed2`) — wayin-style workspace: top bar (title · undo/redo · **⟲ Revert to opened** ·
  autosave indicator · Export) · **tool rail** · 9:16 preview (`<video>` CSS-crop + live `CaptionOverlay`,
  + `<audio>` for voice) · contextual panel · **FilmstripTimeline** (one continuous track of frames).
  Tools: **Trim** · **Cut** · **Reframe** · **Subtitles** · **Voice** (Text/B-roll/Music/Transitions/AI Hook = coming soon).
  - **Autosave is still silent + debounced**, but now has an escape hatch: **⟲ Revert to opened**
    (`useHistory.reset(openedDoc.current)` — `openedDoc` is a ref snapshot of the doc at mount, immune to
    the poll) restores the clip to how it opened and clears history. The **save indicator shows ⚠ Not saved**
    (red) when a `patchClip` fails, so a dead backend no longer silently eats edits.
  - **FilmstripTimeline** = continuous scrubbing track: **drag ANYWHERE to move the playhead** (no
    selection/highlight — this is the familiar behavior; a CapCut-style per-clip-block timeline was
    tried and reverted because it hijacked the playhead). Dim outside the trim, start/end **trim
    handles**, a grabbable playhead knob, scene markers. The window spans the whole source (`win` = 0..
    duration) so trimming reaches any part. Cut ranges show as a **subtle grey band** (`.fs-cut`, not a
    loud red bar); `seek()` skips past a cut.
  - **Cut** = mark a middle range to remove (Cut tool: set cut start → cut to here); export via
    `render_clip_segments` (`kept_segments` drops the gap from the VIDEO).
  - **A cut removes VIDEO, not caption words.** `remapWords` (preview overlay, via `srcToEdited(time)`)
    and backend `remap_words_for_cuts` (export) **keep EVERY word**, retimed onto the edited timeline —
    words inside a removed gap collapse to the seam but stay in sequence (captions read
    "word4 5 6 → cut → 7 8", never dropping words). Preview == export. Captions also **STAY** on any
    trim/cut (no auto-resync); **"↻ Match captions to this part"** (Subtitles → Edit words, shown when a
    transcript exists) pulls the section's transcript on demand. It now **confirms first** when it would
    overwrite hand-edited captions and commits through `useHistory` (Ctrl+Z undoes it).
  - **Voice** — two modes, each with **record OR generate (ElevenLabs AI voice)**:
    - **Reel clips (have scene markers): per-scene.** `SceneVoicePanel` — ◀ Scene N/M ▶ selector,
      a **karaoke `Teleprompter`** scoped to the scene, a **reading-speed** control (0.5/0.75/1×, slows
      record playback only — mic stays natural), **Record this scene** (rolls that scene looping +
      mic via `useRecorder`) → preview → Save, **🔊 Generate AI voice for this scene** (`scene-tts/{idx}`),
      **"▶ Hear this scene with voice"**, and **"▶ Play whole video with voice"** (chains all scenes for a
      full pre-export preview). Export = voice-first per scene.
    - **Long-form clips: whole-clip voice** (single `VoicePanel`, record or 🔊 Generate AI voice).
  - **`useHistory`** undo/redo, **autosave** debounced `patchClip`.
- **New components:** `Teleprompter` (karaoke, reuses `captionAt`/`groupLines`), `useRecorder.ts`
  (MediaRecorder → webm blob), `VideoModal.tsx` (lightbox). `CaptionOverlay.tsx`/`captionStyles.ts`
  mirror `captions.py`. `Toast.tsx` notifications.

---

## 7. Key decisions & gotchas (don't relearn these)

- **No PyTorch, no MediaPipe.** faster-whisper + YuNet.
- **Concat the reel with the FILTER, not the demuxer.** `_concat_segments` (concat filter, reset PTS,
  gapless audio) — the demuxer left timestamp + AAC-priming gaps at each join = **inter-clip stutter**.
  Verified fix: frame deltas are a uniform 1/30 s with no >50 ms gaps.
- **Voiceovers are 48 kHz stereo** (`extract_voiceover`), not the 16 kHz mono Whisper path — using the
  Whisper path made recorded voice sound bad.
- **Voice-first timing:** the recorded voice is the master; the scene's video is looped/held to it.
- **Forced caption alignment** (`assemble.align_known_words` / `timings_from_voiceover`): captions get
  REAL per-word timings by transcribing the voiceover and aligning the KNOWN script words to it
  (difflib anchor + interpolation; transcript words are discarded, only their timing is borrowed).
  Wired into BOTH export paths — native `assemble_ticket` (caches `Beat.caption_timings`, transcribes
  once) and editor `render_scene_reel` (per-scene, recomputed per export, no cache field yet). **Safe
  opt-in upgrade:** any failure (no key, no speech, bad audio) falls back to the old **even-split**, so
  output is byte-identical when a beat/scene has no usable voiceover transcript. NOTE: the editor
  *preview* still shows even-split words (built by `build_edit_video`); the EXPORT is the aligned one,
  so preview ≠ export for voiced captions (approx preview, accurate export).
- **Editor reuse for reels:** `build-edit` turns a reel into a caption-mode Project+Clip so the normal
  editor (preview/captions/trim/cut/voice) applies; scene boundaries ride along as `markers_json`.
  `MomentsGrid` auto-opens a caption-mode project's editor once (module-level `autoOpenedPids` guard
  prevents a back-navigation loop).
- **Captions burn fine** only with `{\1c&H..&}` color + libass `fontsdir` → `C:\Windows\Fonts`.
  **Emoji caveat:** libass renders Segoe UI Emoji as monochrome outlines at best (no color glyphs), so
  AI-Effects emoji in a burned caption may look flat or tofu. Not yet proven on a real export — decide
  after watching one whether to keep them preview-only or overlay as PNGs.
- **One ranking score:** `learn.perf_score(views, follows, saves, sends)` is the single in-app score
  (saves·3 + follows·5 + sends·2 + views·0.001), used by Results top-videos / per-video / per-platform /
  trend and `Angle.avg_score`. The **Google Sheet still owns its own scoring** (`sheets.py` sends raw
  metrics, no score) for the content engine. Tune weights in `perf_score` and every ranking moves together.
- **Transcription is subprocess-isolated** (`transcribe_worker.py`) so a GPU crash can't kill the API;
  the backend also runs in a supervised auto-restart loop (§1). If the API ever 000s, check `data/backend.log`.
- **Export 403s:** `ingest._ydl()` retries transient YouTube 403/timeout on `download_full`. URL projects
  also **prefetch the full video in the background** right after analysis (`jobs._prefetch_full`), so the
  first export is usually instant instead of waiting on a download.
- **PATH refresh** mandatory in every new shell (§1).
- **Opt-in API auth** (`settings.API_TOKEN` / `CVIDEO_API_TOKEN`): empty (default) = no auth, solo/local
  use unchanged. Set it and `main._require_api_token` guards every `/api/*` call (health exempt);
  accepts `X-API-Token` or `Bearer`. Frontend `apiToken.ts` patches `fetch` to attach the stored token
  and `req()` prompts for it on 401. The lock to turn on before exposing the app to anyone else.
- **Upload-Post `job_id`/`request_id`** are persisted on the Ticket at post time (`Ticket.job_id`,
  `Ticket.request_id`; None in dry-run) so a scheduled post can be cancelled + per-video stats matched
  later. The cancel-via-API call itself is a `# FUTURE:` marker.
- **Whole-clip voiceover no longer truncates:** `render._voice_pad_suffix` holds the last frame (tpad)
  when a voiceover overruns the clip, so `-shortest` can't cut the voice tail. Byte-identical when the
  voice fits (common case). The freeze-frame still wants a watched export to confirm it feels right.

---

## 8. Known limitations / next ideas (next-steps backlog)

- **Pipeline P6 (schedule/post) BUILT + REAL POSTING WIRED** (2026-06-27) — `pipeline/poster.py` calls
  the **Upload-Post REST API** (`POST https://api.upload-post.com/api/upload`, header
  `Authorization: Apikey <key>`, multipart `user`/`title`/`platform[]`/`video`, `scheduled_date`+
  `timezone` for scheduling) behind a **dry-run guard** (`is_live()` = `bool(UPLOAD_POST_API_KEY)`; no
  key → logs only). Platform map tt→tiktok/ig→instagram/yt→youtube. Needs `UPLOAD_POST_API_KEY` +
  `UPLOAD_POST_USER` (profile from the Upload-Post dashboard, social accounts connected) +
  `UPLOAD_POST_TIMEZONE` (IANA) in `backend/.env`. `/api/queue` returns `config{live,user_set,user}`;
  **`/post`** takes optional `scheduled_at` → schedule (stage `scheduled`) vs post-now (stage `posted`).
  **Schedule** screen: practice/almost-live/live banner, ready cards (datetime + platform pick →
  Schedule or Post-now), the queue (status + Remove), recently-posted. Verified: dry-run flow green +
  real request validated against the live endpoint (bogus key → 401, proves request shape). All P1–P6 done.
- **P6 PUBLISHER — Postiz CUT (decided 2026-06-28).** Postiz was trialled (self-hosted Docker) and
  dropped: it only worked for YouTube; Instagram is permanently blocked (disabled Facebook → no Meta
  dev app) and TikTok can't post from localhost (needs public-HTTPS media + a TikTok audit). It was
  never written into Cvideo code — only ever a roadmap plan — so nothing was removed. **Publisher
  layer stays a thin interface with two real adapters: Upload-Post (`pipeline/poster.py`, the audited
  broker that dodges the Meta/TikTok dev-app pain) + manual.** Remaining P6 polish = wire post copy
  from `Ticket.post_meta` + per-ticket TikTok trending-audio mode. See the `cvideo-postiz-licensing`
  + `dennis-facebook-banned` memories for the full why.
- **Metrics — Results upgraded** (2026-06-27): `/api/insights` adds `by_platform` + `trend`; the
  Results screen now shows a **Momentum** day-by-day bar chart + a **By platform** breakdown table.
- **Fast bulk logger** (`BulkLogger`, default mode in `VideoTracker`): pick ONE platform tab
  (TikTok/IG/YouTube), every posted video is a row with 4 inline number fields (views/follows/saves/
  shares) — tab down the columns, one **Save N** button batches `POST /api/perf` for every changed
  row (brand omitted so it's never overwritten). Switching platform clears in-progress edits and
  shows that platform's saved numbers. The old per-video expander is still there under
  "🔍 One at a time". **Auto-pull** (still the next refinement) is viable via the **Upload-Post
  analytics API** (`GET /api/analytics/{user}` returns views/likes/saves/shares/followers for
  tt/ig/yt) — dodges the Meta-ban/TikTok-audit walls since Upload-Post already brokers the accounts;
  needs `UPLOAD_POST_API_KEY` set (same key that makes posting live). Account-level is easy; per-video
  needs matching each post's `job_id`/`request_id` captured at post time.
- ~~**Forced caption alignment**~~ DONE (2026-07-07) — `assemble.align_known_words` /
  `timings_from_voiceover`; both export paths, even-split fallback. Still unproven on a watched export
  (timing correctness needs eyes). Preview stays even-split; export is aligned.
- **Long-form whole-clip voice** — `-shortest` tail-clip FIXED (2026-07-07, holds last frame when the
  voice overruns; see §7). Still lacks the record-time reading-speed control the per-scene panel has.
- **Middle-cut (Cut) + per-scene voice are mutually exclusive** — the per-scene export path ignores
  `cuts_json`.
- **Reel render is fixed 1080×1920** (no 1440p/4k tier; long-form clips already support tiers).
- Reframe is a static smoothed center (no per-frame panning). 4K is upscale-bound by source.
- Advanced editor tools deferred: Text overlays, B-roll, Music, Transitions, AI Hook.

---

## 9. Verify quickly

- `cd frontend && npm run build` → 0 TS errors.
- `cd frontend && npm test` (vitest) — unit tests for App.tsx's pure UI logic in
  `frontend/src/App.test.ts`: which sidebar item a route lights up, what a video needs next, when a
  scene's extra fields open, the New-project options summary. No DOM, no server.
- `cd backend && .\.venv\Scripts\python.exe test_reframe.py` — crop math + the face-detection
  fallbacks. Standalone (no pytest, no ffmpeg, no test asset).
- `cd backend && .\.venv\Scripts\python.exe -c "import app.main; print('OK')"` (imports + would migrate).
- Schema check: `PRAGMA table_info(clip)` should include cuts_json/markers_json/voiceover_path/scene_vo_json.
- Reel smoothness: probe an exported reel's `v:0` `pts_time` deltas — uniform ~0.0333 s, no >50 ms gaps.
- `backend/verify_render.py`, `backend/test_api2.py`, `backend/verify_pt4.py`.
