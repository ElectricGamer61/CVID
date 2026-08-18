# Cvideo

Your own free video editor. Turn long-form videos into vertical shorts: transcribe → find
strong moments → reframe to 9:16 → add captions → edit → export. Runs on your PC.

## 🚀 Dead-simple install (Windows laptop)

This repo is **private**, so the very first step needs a one-time sign-in (a browser window
pops up automatically — no token, nothing to paste). After that it's fully automated.

**1.** Open PowerShell and install Git (skip if you already have it):
```powershell
winget install -e --id Git.Git
```
Close and reopen PowerShell so `git` is on PATH.

**2.** Clone the repo (a browser window opens once — sign in to GitHub there):
```powershell
git clone https://github.com/ElectricGamer61/CVID.git
```

**3.** Open the new `CVID` folder and double-click **`install.cmd`**. It installs everything
else (Python, Node, ffmpeg), builds the app, and optionally asks for your **ElevenLabs** and
**cloud categorizer** API keys (press Enter to add them later in `backend\.env`). It then launches it.

The installer also drops a **`Cvideo` icon on your Desktop** — after that, opening the app is
one double-click (it starts the local server if it isn't already running and opens Cvideo in
its own window). Missing or moved? Double-click **`install-shortcut.cmd`** to put it back, or
run **`serve.cmd`** to start the server by hand. The default install supports local CPU
transcription and local clip finding; cloud services are optional. No GPU is required.

<sub>If you ever make this repo public, `scripts/bootstrap.ps1` can also run as a single
`iwr -useb <raw-url> | iex` one-liner that does steps 1–3 for you in one shot.</sub>

<sub>Already cloned the repo? Just double-click **`install.cmd`** instead.</sub>

---

## What's in the box
- **Backend** (`backend/`) — FastAPI + SQLite pipeline:
  ingest (yt-dlp / upload) → transcribe (faster-whisper) → brain (Ollama / Gemini /
  heuristic) → reframe (OpenCV 9:16) → captions (ffmpeg ASS) → render (ffmpeg).
- **Frontend** (`frontend/`) — React + Vite editor: create projects, review scored
  clips, trim, pick caption style, give the clip a **cinematic Look** (one colour-grade
  preset + a strength) and a **big cinematic title** beside the subject, export.

## Prerequisites (installed in Phase 0)
- **ffmpeg** (on PATH) — `ffmpeg -version`
- **Python 3.11**
- **Node 18+**
- **Ollama** (optional, for local clip finding) — `ollama pull qwen2.5:7b`
- (optional) **GEMINI_API_KEY** in `backend/.env` for Gemini clip finding
- (optional) **OPENAI_API_KEY** in `backend/.env` for the Cloud categorizer

> RTX 5070 note: the MVP uses **faster-whisper (CTranslate2)**, which needs no PyTorch,
> so the Blackwell/`sm_120` PyTorch issue does not block transcription. It uses the GPU
> if CTranslate2 supports it, otherwise falls back to CPU automatically.

## Opening it again later (one click)
Double-click the **`Cvideo`** icon on your Desktop (`install.cmd` puts it there; run
**`install-shortcut.cmd`** any time to recreate it). It starts the local app only if it isn't
already running and opens it in its own window — no terminal, nothing to type. It is a plain
Windows shortcut to `scripts\open-cvideo.ps1`; there is no desktop app to install.

Other ways in, if you want them:
- **`serve.cmd`** — one port, `http://127.0.0.1:8000`, also reachable from your phone on the
  same wifi (run `allow-network.cmd` once). It keeps the window open and restarts the backend
  if it ever crashes; everything it prints is also written to `data\backend.log`.
- **`scripts\start.ps1`** — the two-server dev setup (backend + Vite on
  http://localhost:3000), for working on the code.

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
Open http://localhost:3000. The Vite dev server proxies `/api` to the backend on :8000.

## Configuration (env vars / `backend/.env`)
- `CVIDEO_WHISPER_MODEL` (default `large-v3`) · `CVIDEO_WHISPER_DEVICE` (`auto`/`cuda`/`cpu`)
- `CVIDEO_OLLAMA_MODEL` (default `qwen2.5:7b`) · `OLLAMA_HOST`
- `GEMINI_API_KEY` · `CVIDEO_GEMINI_MODEL` (default `gemini-1.5-flash`)
- `CVIDEO_DEFAULT_BRAIN` (`openai`/`claude`/`ollama`/`gemini`/`heuristic`); `openai` is retained as the backend compatibility id for Cloud categorizer
- `CVIDEO_TARGET_CLIPS`, `CVIDEO_MIN_CLIP`, `CVIDEO_MAX_CLIP`

## Caption presets
`capcut` (classic TikTok), `hormozi` (uppercase pop), `beasty` (big centered),
`clean` (subtle lower-third). Pick per-project or per-clip.

## Roadmap
- **Phase B:** drag trim timeline, transcript editing that re-burns captions, smooth
  face-tracking reframe, more caption presets.
- **Phase C:** Gemini brain toggle, smarter hook detection, batch export, thumbnails.

See `GOAL.md` for the full build spec.
