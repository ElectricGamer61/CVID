# Cvideo — Project Context

A local, free clone of wayinvideo / OpusClip. Turns long-form YouTube videos into vertical
short clips: transcribe → AI picks viral moments → 9:16 reframe → TikTok-style captions →
editor → export. Runs entirely on this machine. Built to replace a paid wayinvideo sub.

> This file is the single source of truth for *how Cvideo works today*. `GOAL.md` is the
> original spec; `README.md` is setup. When in doubt, trust this file + the code.

---

## 1. How to run

Two servers. **Every shell must refresh PATH first** (winget installed ffmpeg/ollama into
the registry PATH, but already-running shells have a stale env):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
```

- **Backend** (FastAPI, port 8000):
  `cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`
- **Frontend** (Vite, port 5173, proxies `/api` → 8000):
  `cd frontend; npm run dev`
- One-click: `scripts\start.ps1` (launches both, opens http://localhost:5173).
- The backend reads `backend/.env` (gitignored) for API keys.

Restart the backend after changing `.env` or backend code (no `--reload` in the launch
scripts; it loads keys/code at startup).

---

## 2. Machine / environment (verified)

- **GPU:** RTX 5070 (Blackwell, `sm_120`, 12 GB). Transcription runs **on GPU** via
  faster-whisper / CTranslate2 4.8.0 (no PyTorch needed). **Do NOT add PyTorch/mediapipe.**
- **Python:** 3.11 venv at `backend/.venv` (system `py` is 3.13, too new for the ML stack).
- **Tools:** ffmpeg 8.1.1, Ollama (qwen2.5:7b pulled), Node 24, yt-dlp (keep it updated:
  `pip install -U yt-dlp`, or YouTube returns "Requested format is not available").
- **CUDA DLL gotcha:** the pip `nvidia-cublas/cudnn` DLLs live in `site-packages/nvidia/*/bin`,
  not on the DLL path — `transcribe.py::_register_cuda_dlls()` adds them via
  `os.add_dll_directory` at import, else CTranslate2 errors "cublas64_12.dll not found".

---

## 3. Pipeline (backend/app/pipeline/)

```
ingest → transcribe → brain → (reframe + captions) → render
```

- **ingest.py** — efficient downloads for URL projects: `download_audio()` (analysis only),
  `download_proxy()` (360p, editor preview), `download_full()` (full video, fetched **once**
  on first export, cached as `source.mp4`). Uploads use `save_upload` + `extract_audio`.
  (`download_clip_range` exists but unused — yt-dlp's force-keyframe cut is flaky on Windows.)
- **transcribe.py** — `transcribe(audio, backend, progress)`. `local` = faster-whisper
  (GPU→CPU auto-fallback). `elevenlabs` = Scribe STT (`ELEVENLABS_API_KEY`), maps `words[]`
  (type=="word") → `{start,end,word}`; falls back to local on error. Output → `words.json`.
- **brain.py** — picks viral moments. Backends: `ollama` (default), `gemini`, `heuristic`
  (no-LLM fallback so it never hard-fails). Prompt uses a **virality framework** (hooks,
  emotional peaks, opinion bombs, revelations, conflict, quotable lines, story peaks,
  practical value); each clip → `{start,end,title,score,hook_sentence,reason}`. Long
  transcripts are **chunked** (~20 min/60 s overlap) then cross-chunk de-duped (>50% overlap
  → higher score). Clips snap to **sentence boundaries**. NOTE: any field you want populated
  must be in `_CLIPS_SCHEMA["...required"]` or the model omits it.
- **reframe.py** — 9:16 crop center via **OpenCV YuNet DNN** (`cv2.FaceDetectorYN`,
  auto-downloads onnx to `data/models/`), Haar fallback, median over sampled frames.
  `crop_filter()` builds the ffmpeg crop+scale. **MediaPipe was removed** (broken wheel +
  protobuf 5.x conflict with Gemini).
- **captions.py** — word-synced ASS (the TikTok look). `PRESETS`: capcut / hormozi / beasty /
  clean (web-hex style mirrored in frontend `captionStyles.ts`). Active word gets a color +
  scale pop. **Inline color must be `{\1c&HBBGGRR&}` (6-digit + trailing &)**, not 8-digit.
- **render.py** — ffmpeg cut → crop → burn ASS. **Windows libass needs `fontsdir` pointing
  at `C:\Windows\Fonts`** or it renders no text. Subtitle path is escaped (`\` → `/`, `:` → `\:`).
  Output dims come from `settings.output_dims(aspect, resolution)` — a per-clip **resolution
  tier** (`RESOLUTIONS`: 1080p/1440p/4k, keyed by output **width**; height derived from the
  aspect so 1:1/4:5 aren't distorted). The ASS keeps its 1080×1920 `PlayRes` baseline; libass
  scales captions up to the real frame, so they stay proportional + crisp at 4K. `_FMT_FULL`
  fetches source up to **2160p** so high-res exports have real detail (4K is still a lanczos
  upscale of the 9:16 crop — see §8).

`jobs.py` runs analysis in a background thread (ingest→transcribe→brain→create clips→proxy),
writing progress onto the Project row.

---

## 4. Data model (backend/app/db.py, SQLite via SQLModel)

- **Project**: name, source_type (url|file), source_url, brain, **transcribe_backend**
  (local|elevenlabs), aspect, caption_preset, status, stage, progress, error, duration.
- **Clip**: project_id, idx, start, end, title, score, **hook**, reason, aspect,
  caption_preset, **resolution** (1080p|1440p|4k), crop_center, status
  (suggested|rendering|rendered|error), **stage**, output_path, error, **style_json**
  (per-clip caption style), **words_json** (edited caption text). Additive columns are
  added by `_migrate()` (ALTER ADD COLUMN) on startup.

**Pipeline lifecycle tables (Phase 1 — the 10-order content pipeline wrapping the clip engine):**
- **Ticket** (the spine): brand, **stage** (outlier|scripted|staged|sourced|assembled|ready|
  scheduled|posted), angle, outlier_id FK, **format** (reel|carousel), **capture_mode**
  (longform-clip|native-short|repurpose), **project_id FK → Project** (long-form path only),
  source_ref, hook_text, clip_url (assembler output, both paths), captions/platforms (JSON),
  scheduled_at/posted_at, created_at.
- **Beat** (the script-as-timeline; beats ARE the script — no duplicate script blob): ticket_id
  FK, order_index, spoken_line, on_screen_text, caption, shot_cue, clip_path?, voiceover_path?,
  **is_proof_beat** (real-number claim → clip must show product/label).
- **Outlier** (swipe file), **Perf** (per-platform stats), **Angle** (`avg_score = avg(saves+
  follows)`, the needle metric, NOT views). New tables are created by `create_all` (no `_migrate`
  needed; `_migrate` stays for Project/Clip only). JSON via `sa_column=Column(JSON)`.

---

## 5. API (backend/app/main.py)

- `POST /api/projects` (url) · `POST /api/projects/upload` (file) — accept brain,
  transcribe_backend, aspect, caption_preset.
- `GET /api/projects` · `GET /api/projects/{pid}` (project + clips) · `DELETE /api/projects/{pid}`.
- `GET /api/projects/{pid}/source` — preview video (proxy for url, source for upload).
- `GET /api/projects/{pid}/thumb` · `GET /api/clips/{cid}/thumb` — lazy cached JPGs.
- `PATCH /api/clips/{cid}` — start/end/title/caption_preset/aspect/crop_center/**style**/**words**.
- `POST /api/clips/{cid}/render` · `GET /api/clips/{cid}/download` · `/preview` · `DELETE /api/clips/{cid}`.
- `GET /api/presets` — captions, caption_styles, aspects, brains, transcribe, resolutions,
  **stages, formats, capture_modes**.
- **Tickets:** `POST /api/tickets` · `POST /api/tickets/from-script` (paste script → ticket +
  auto-split beats) · `POST /api/tickets/{tid}/import-script` (re-import, replaces beats) ·
  `GET /api/tickets` · `GET /api/tickets/{tid}` (ticket + ordered beats) · `PATCH /api/tickets/{tid}`
  (stage advance etc., validates stage/format/capture_mode) · `DELETE /api/tickets/{tid}`.
- **Beats:** `PATCH /api/beats/{bid}` — edit fields incl. **toggle `is_proof_beat`** (so heuristic
  false-flags like "3 swaps" can be turned off).
- **Script import** lives in `backend/app/intake.py::parse_script(text)` → `{hook, beats[]}`:
  deterministic (no LLM), splits on `BEAT`/`Beat N`/`## `/`---`/`1.`, reads labeled fields
  (Spoken/On-screen/Caption/Shot/Proof), defaults caption→spoken line, flags proof on an explicit
  `Proof:` **or** a real number in the text.

---

## 6. Frontend (frontend/src/, React + Vite + TS, plain CSS)

Light "Soft-UI" theme (Plus Jakarta Sans). **Layout mirrors wayin**: left **Sidebar** →
project opens a **MomentsGrid** (clip cards: thumbnail, viral score /100, hook line, actions
Edit/Download/Re-export/Delete) → click a card → **ClipEditor**.

- **App.tsx** — routes (home | **board** | project | editor), shell, Home/NewProject/ProjectCard,
  MomentsGrid/MomentCard, ClipEditor, Timeline, StyleEditor, CaptionTextEditor, **Board**.
- **Board** (Sidebar → "Board") — pipeline kanban: a column per `stage`, ticket cards (lane
  A/B/R badge from capture_mode, format, angle, hook, ◀▶ hand stage-advance, delete), Lane A/B
  hint at the Sourced column. **+ New ticket** modal pastes a Claude script → auto-split beats.
  Clicking a card opens a **TicketDetail** drawer: stage advance, the beat list with a per-beat
  **Proof** checkbox (toggle is_proof_beat) and a ⚠ warning when a proof beat has no clip, plus
  re-import. (Full ticket/beat editing + capture/assemble = later phases.)
- **ClipEditor** — 9:16 preview (`<video>` CSS-cropped via `objectPosition` = crop_center)
  with live **CaptionOverlay** (DOM, word-by-word, no re-render). Tabs: **Style** (presets +
  swatches/sliders/position/uppercase), **Text** (edit caption words — even-split timing),
  **Clip** (title/reason/crop slider + **Export resolution** dropdown 1080p/1440p/4K, from
  `/api/presets` `resolutions`). Bottom **Timeline**: drag-trim handles on a **stable
  axis** (frozen `[clipStart-margin, clipEnd+margin]` window — does NOT rescale during drag).
- **CaptionOverlay.tsx / captionStyles.ts** — shared caption logic (must match captions.py).
- **Toast.tsx** — toast notifications.
- **Download** (`downloadClip()` in App.tsx + `exportDir.ts`) — editor + moment-card ⬇ buttons.
  On Chromium (Chrome/Edge) the clip streams **straight into a remembered export folder**: the
  user picks a folder once (`showDirectoryPicker`), its `FileSystemDirectoryHandle` is persisted
  in **IndexedDB** (`exportDir.ts`), and every later download writes there with **no dialog**
  (permission may re-prompt once after a reload — must be inside the click gesture). The editor
  shows "Save folder: <name> · change". Firefox/Safari fall back to a normal browser download.
  (Earlier "export not working" was a `<button>` nested in `<a>` — invalid HTML; now a real
  `onClick`. Backend `/api/clips/{cid}/download` already serves `Content-Disposition: attachment`.)

---

## 7. Key decisions & gotchas (don't relearn these)

- **No PyTorch, no MediaPipe.** Blackwell + protobuf conflicts. Use faster-whisper + YuNet.
- **Efficient downloads:** never pull the full video for analysis — audio + 360p proxy only;
  full video once on first export.
- **Captions burn fine** — earlier "no captions" was the malformed `\1c` color + missing
  fontsdir (both fixed). If captions vanish: check the ASS color format + fontsdir.
- **Export "not working"** was (1) missing UI feedback during the one-time full-video
  download — now shows a `stage` ("Downloading video / Rendering"); and (2) **transient
  YouTube HTTP 403** on `download_full` (expired/throttled googlevideo URLs) killing the
  export and leaving the clip stuck in `status="error"`. `ingest._ydl()` now **retries**
  (up to 4 fresh `extract_info` calls with backoff, plus yt-dlp's own fragment retries)
  on 403/timeout-class errors. A stuck `error` clip just needs its render re-triggered.
- **PATH refresh** is mandatory in every new shell (see §1).

---

## 8. Known limitations / next ideas

- Reframe is a **static** smoothed center per clip (no per-frame panning yet).
- **4K is upscale-bound by source:** a 9:16 crop of a 1080p source is ~600px wide of real
  detail; even a 2160p source crops to ~1215px. 4K/1440p export (lanczos) looks crisper and
  platforms favor higher-res uploads, but it isn't native 4K detail. `_FMT_FULL` already pulls
  the best available source (≤2160p) to maximise real pixels.
- Brain quality is good but tied to qwen2.5:7b; a bigger local model or Gemini lifts it.
- ElevenLabs needs `ELEVENLABS_API_KEY` in `backend/.env`; local is the free default.
- Existing clips created before a schema change won't have new fields (e.g. hooks) until the
  project is re-analyzed.

---

## 9. Verify quickly

- `cd frontend && npm run build` → 0 TS errors.
- `cd backend && .\.venv\Scripts\python.exe -c "import sys;sys.path.insert(0,'.');import app.main;from app.db import init_db;init_db();print('OK')"`
- `backend/verify_render.py` (caption/crop render), `backend/test_api2.py` (upload/url/delete
  e2e), `backend/verify_pt4.py` (brain hooks + chunking).
