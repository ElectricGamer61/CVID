# Cvideo

Your own free, local clone of wayinvideo / OpusClip. Turns long-form YouTube videos
into vertical shorts: auto-transcribe → AI picks the best moments → 9:16 reframe →
TikTok-style captions → editor → export. Runs entirely on your PC.

## 🚀 Dead-simple install (Windows laptop)

Open **PowerShell** and paste this one line — it installs everything (Git, Python, Node,
ffmpeg), downloads the app, builds it, asks for your keys, and launches it:

```powershell
iwr -useb https://raw.githubusercontent.com/ElectricGamer61/CVID/main/scripts/bootstrap.ps1 | iex
```

That's it. When it asks, paste your **ElevenLabs** and **OpenAI** API keys (or press Enter to
add them later in `backend\.env`). After the first run, just double-click **`serve.cmd`** to
start it again. This is the **bare-bones** build: ElevenLabs for voice/transcription + OpenAI
for writing — no local AI models, ~1 GB total, no GPU needed.

<sub>Already cloned the repo? Just double-click **`install.cmd`** instead.</sub>

---

## What's in the box
- **Backend** (`backend/`) — FastAPI + SQLite pipeline:
  ingest (yt-dlp / upload) → transcribe (faster-whisper) → brain (Ollama / Gemini /
  heuristic) → reframe (OpenCV 9:16) → captions (ffmpeg ASS) → render (ffmpeg).
- **Frontend** (`frontend/`) — React + Vite editor: create projects, review scored
  clips, trim, pick caption style, export.

## Prerequisites (installed in Phase 0)
- **ffmpeg** (on PATH) — `ffmpeg -version`
- **Python 3.11**
- **Node 18+**
- **Ollama** (for the local brain) — `ollama pull qwen2.5:7b`
- (optional) **GEMINI_API_KEY** in `backend/.env` for the cloud brain

> RTX 5070 note: the MVP uses **faster-whisper (CTranslate2)**, which needs no PyTorch,
> so the Blackwell/`sm_120` PyTorch issue does not block transcription. It uses the GPU
> if CTranslate2 supports it, otherwise falls back to CPU automatically.

## Quick start (after first-time setup below)
Double-click **`scripts\start.ps1`** (or `powershell -ExecutionPolicy Bypass -File scripts\start.ps1`).
It launches the backend + frontend and opens http://localhost:5173. Make sure Ollama is running.

> ✅ Verified on RTX 5070: transcription runs **on the GPU** (`device=cuda`, ~126 words in 5s)
> via faster-whisper / CTranslate2 4.8.0. The full pipeline (upload → transcribe → Ollama
> brain → 9:16 reframe → captions → render → download) passed end-to-end.

## Setup

### Backend
```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:5173. The Vite dev server proxies `/api` to the backend on :8000.

## Configuration (env vars / `backend/.env`)
- `CVIDEO_WHISPER_MODEL` (default `large-v3`) · `CVIDEO_WHISPER_DEVICE` (`auto`/`cuda`/`cpu`)
- `CVIDEO_OLLAMA_MODEL` (default `qwen2.5:7b`) · `OLLAMA_HOST`
- `GEMINI_API_KEY` · `CVIDEO_GEMINI_MODEL` (default `gemini-1.5-flash`)
- `CVIDEO_DEFAULT_BRAIN` (`ollama`/`gemini`/`heuristic`)
- `CVIDEO_TARGET_CLIPS`, `CVIDEO_MIN_CLIP`, `CVIDEO_MAX_CLIP`

## Caption presets
`capcut` (classic TikTok), `hormozi` (uppercase pop), `beasty` (big centered),
`clean` (subtle lower-third). Pick per-project or per-clip.

## Roadmap
- **Phase B:** drag trim timeline, transcript editing that re-burns captions, smooth
  face-tracking reframe, more caption presets.
- **Phase C:** Gemini brain toggle, smarter hook detection, batch export, thumbnails.

See `GOAL.md` for the full build spec.
