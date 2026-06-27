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
- **Frontend** (Vite, port 5173, proxies `/api` → 8000): `cd frontend; npm run dev`
- One-click: **double-click `start.cmd`** (repo root) → `scripts\start.ps1` launches both + opens
  http://localhost:5173. (`start.ps1` is ASCII-only — em-dash/`…` chars broke PowerShell 5.1 parsing.)
- The backend reads `backend/.env` (gitignored) for API keys. **No `--reload`** — restart after
  changing `.env` or backend code.

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
- **brain.py** — viral-moment picker: `ollama`/`gemini`/`heuristic`. Virality-framework prompt,
  chunking + cross-chunk de-dupe, sentence-boundary snapping. Fields must be in `_CLIPS_SCHEMA` required.
- **reframe.py** — 9:16 crop center via OpenCV **YuNet DNN** (+ Haar fallback). `crop_filter()` builds
  the ffmpeg crop+scale. **No MediaPipe.**
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
- **ai.py** — Script Factory + Hook Forge (reuse brain clients; heuristic fallbacks).

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
  hook_text, clip_url, captions/platforms (JSON), scheduled_at/posted_at.
- **Beat** (script-as-timeline): ticket_id, order_index, spoken_line, on_screen_text, caption,
  shot_cue, clip_path?, voiceover_path?, is_proof_beat.
- **Outlier** (swipe file), **Perf** (per-platform stats), **Angle** (`avg_score = avg(saves+follows)`).

---

## 5. API (backend/app/main.py)

- **Projects:** `POST /api/projects` (url) · `POST /api/projects/upload` (file) — both take brain,
  transcribe_backend, aspect, caption_preset, **mode**. `GET /api/projects` · `GET /{pid}` ·
  `DELETE /{pid}` · `/{pid}/source` · `/{pid}/thumb` · `/{pid}/frame?t=`.
- **Clips:** `PATCH /api/clips/{cid}` (start/end/title/caption_preset/aspect/crop_center/style/words/
  **cuts**) · `POST /{cid}/render` · `GET /{cid}/download|/preview|/thumb` · `DELETE /{cid}` ·
  `POST /{cid}/auto-center`.
  - **Clip voiceover (whole-clip):** `POST /{cid}/voiceover` (48 kHz via `extract_voiceover`) ·
    `GET /{cid}/voiceover-file` · `DELETE /{cid}/voiceover`.
  - **Per-scene voiceover (reels):** `POST/GET/DELETE /api/clips/{cid}/scene-voiceover/{idx}`.
- **Tickets:** `POST /api/tickets` · `/from-script` · `/{tid}/import-script` · `GET /api/tickets` ·
  `GET /{tid}` · `PATCH /{tid}` · `DELETE /{tid}` · `GET /{tid}/thumb` (reel poster) ·
  **`POST /{tid}/build-edit`** (stitch a native reel's scenes into one caption-mode Project+Clip with
  markers+words, then open it in the editor) · `/{tid}/script-factory` · `/{tid}/hook-forge` ·
  `/{tid}/assemble` (+ `/assemble-status`) · `/{tid}/use-clip/{cid}` · `/{tid}/download`.
- **Beats:** `PATCH /api/beats/{bid}` · add/`DELETE`/reorder · `POST /{bid}/clip` · `/{bid}/voiceover`.
- **Schedule/post (P6):** **`GET /api/queue`** → `{dry_run, platforms, ready[], scheduled[], posted[]}`
  (each card carries `has_video`). **`POST /api/tickets/{tid}/schedule`** (set `scheduled_at`/`platforms`/
  `captions`, stage→`scheduled`; null `scheduled_at` clears → back to `ready`). **`POST /{tid}/post`**
  → calls `pipeline/poster.post_reel` (dry-run unless `UPLOAD_POST_API_KEY` set), stage→`posted`.
- **Outliers:** CRUD + `POST /api/tickets/from-outlier/{oid}`.
- **Insights:** `POST /api/perf` · `GET /api/insights` (now also returns **`by_platform`**
  per-channel views/follows/saves/sends/score + **`trend`** totals-per-capture-day). **`GET /api/exports`** — all rendered clips +
  reels, each with folder metadata: `group` (brand for reels / project for clips), `subgroup`
  ("Reels"/"Clips"), `hook`, `filename` (hook-based).
- **Presets:** `GET /api/presets` — captions, caption_styles, aspects, brains, transcribe,
  resolutions, stages, formats, capture_modes.
- **Script import:** `intake.parse_script(text)` → `{hook, beats[]}` (deterministic, no LLM).

---

## 6. Frontend (frontend/src/, React + Vite + TS, plain CSS)

Light "Soft-UI" theme (Plus Jakarta Sans). **Sidebar:** Home · **Outliers** · **Create videos** ·
**Schedule** · Results · Downloads (internal routes: home/intake/board/queue/insights/library).
Plain-language UI: a ticket = "video", a beat = "scene", an outlier = an "idea".

- **App.tsx** — routes (home | board | intake | insights | library | project | **editor** with an
  optional `from:"board"`), shell, and all screens + the **ClipEditor** workspace.
- **Home / NewProject** — paste URL or upload. A **mode toggle**: "Find viral moments" (default) vs
  **"Just caption my clip"** (caption mode → one full-length clip → auto-opens the editor).
- **Create videos** (Board) — redesigned: the 8 DB stages collapse to **4 phase lanes** (`PHASES`:
  Idea / Make it / Ready / Posted) with accent colors; cards show a reel thumbnail, the hook, mode
  badge, ◀▶ phase move. **+ New video** modal: angle + **✨ Generate with AI** (create + script-
  factory in one step) or paste/blank. Clicking a card opens **TicketDetail**; a native reel's
  **"✏️ Open in editor"** calls `build-edit` and routes into the clip editor.
- **TicketDetail** drawer — edit ticket + per-beat fields, add/reorder/delete scenes, proof toggle,
  AI buttons, per-beat clip/voiceover upload, "Open in editor" + "Make my video" (assemble).
- **Downloads (Library)** — **collapsible folders**: group (brand→Reels / project→Clips) → cards
  named by hook. **Click a card → `VideoModal`** lightbox preview (play + download). `downloadFile()`
  saves to a remembered folder (Chromium `showDirectoryPicker` persisted in IndexedDB via
  `exportDir.ts`); Firefox/Safari fall back to a normal download.
- **ClipEditor** (`.ed2`) — wayin-style workspace: top bar (title · undo/redo · autosave · Export) ·
  **tool rail** · 9:16 preview (`<video>` CSS-crop + live `CaptionOverlay`, + `<audio>` for voice) ·
  contextual panel · **FilmstripTimeline** (frames, zoom, drag-trim, scrub, cut bands, scene markers).
  Tools: **Trim** · **Cut** · **Reframe** · **Subtitles** · **Voice** (Text/B-roll/Music/Transitions/
  AI Hook = coming soon).
  - **Cut** = remove a middle chunk (red bands on the timeline; preview skips them; export via
    `render_clip_segments`). **Captions resync** to the transcript when you trim to a new section
    (until you hand-edit words).
  - **Voice** — two modes:
    - **Reel clips (have scene markers): per-scene.** `SceneVoicePanel` — ◀ Scene N/M ▶ selector,
      a **karaoke `Teleprompter`** scoped to the scene, a **reading-speed** control (0.5/0.75/1×, slows
      record playback only — mic stays natural), **Record this scene** (rolls that scene looping +
      mic via `useRecorder`) → preview → Save, **"▶ Hear this scene with voice"**, and **"▶ Play whole
      video with voice"** (chains all scenes for a full pre-export preview). Export = voice-first per
      scene.
    - **Long-form clips: whole-clip voice** (single `VoicePanel`, record over the clip).
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
  Captions are **even-split** across the voice (forced alignment is a future refinement).
- **Editor reuse for reels:** `build-edit` turns a reel into a caption-mode Project+Clip so the normal
  editor (preview/captions/trim/cut/voice) applies; scene boundaries ride along as `markers_json`.
  `MomentsGrid` auto-opens a caption-mode project's editor once (module-level `autoOpenedPids` guard
  prevents a back-navigation loop).
- **Captions burn fine** only with `{\1c&H..&}` color + libass `fontsdir` → `C:\Windows\Fonts`.
- **Export 403s:** `ingest._ydl()` retries transient YouTube 403/timeout on `download_full`.
- **PATH refresh** mandatory in every new shell (§1).

---

## 8. Known limitations / next ideas (next-steps backlog)

- **Pipeline P6 (schedule/post) BUILT** (2026-06-27) — `pipeline/poster.py` Upload-Post **dry-run
  adapter** (`is_live()` = `bool(UPLOAD_POST_API_KEY)`; no key → logs only, returns synthetic result;
  real SDK path gated behind the key with a `# FUTURE` wire-up) + `/api/queue` + `/schedule` + `/post`
  + a **Schedule** screen (ready-to-schedule cards w/ datetime + platform pick + Schedule/Post-now,
  the queue, recently-posted). All P1–P6 done.
- **Metrics — Results upgraded** (2026-06-27): `/api/insights` adds `by_platform` + `trend`; the
  Results screen now shows a **Momentum** day-by-day bar chart + a **By platform** breakdown table.
  Still manual entry — **auto-pull stats** remains the next refinement.
- **Forced caption alignment** to the actual recorded speech (currently even-split across the voice).
- **Long-form whole-clip voice** lacks the reading-speed control + uses `-shortest` (can clip the
  tail); the per-scene reel path has the full voice-first treatment.
- **Middle-cut (Cut) + per-scene voice are mutually exclusive** — the per-scene export path ignores
  `cuts_json`.
- **Reel render is fixed 1080×1920** (no 1440p/4k tier; long-form clips already support tiers).
- Reframe is a static smoothed center (no per-frame panning). 4K is upscale-bound by source.
- Advanced editor tools deferred: Text overlays, B-roll, Music, Transitions, AI Hook.

---

## 9. Verify quickly

- `cd frontend && npm run build` → 0 TS errors.
- `cd backend && .\.venv\Scripts\python.exe -c "import app.main; print('OK')"` (imports + would migrate).
- Schema check: `PRAGMA table_info(clip)` should include cuts_json/markers_json/voiceover_path/scene_vo_json.
- Reel smoothness: probe an exported reel's `v:0` `pts_time` deltas — uniform ~0.0333 s, no >50 ms gaps.
- `backend/verify_render.py`, `backend/test_api2.py`, `backend/verify_pt4.py`.
