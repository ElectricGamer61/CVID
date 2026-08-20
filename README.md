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
- `CVIDEO_YOUTUBE_COOKIE_BROWSERS` (browser order for the YouTube sign-in fallback; on Windows it defaults to `chrome,edge,firefox`, set `off` to disable)
- `CVIDEO_YOUTUBE_COOKIES_FILE` (path to an exported `cookies.txt`; defaults to `backend\\youtube-cookies.txt` if that file exists)
- `CVIDEO_AUTO_UPDATE` (`off` stops the launchers fast-forwarding this checkout on start)

## Keeping it up to date

Double-click **`update.cmd`**. It pulls the newest version, updates the backend downloader
(**yt-dlp**) and the other Python dependencies, and rebuilds the UI.

The launchers also do this for you: `serve.cmd`, `start.cmd` and the Desktop icon fast-forward
the checkout and re-sync `backend\\.venv` to the pinned requirements *before* starting the
backend, and log what they did to `data\\backend.log`. A checkout with local changes, a
missing git, or no network is left exactly as it is and the app starts anyway; set
`CVIDEO_AUTO_UPDATE=off` to keep a machine pinned on purpose.

This matters more than it sounds: **YouTube breaks yt-dlp every few weeks**. An install that
never updates eventually gets a bot challenge or an `HTTP 403` on every YouTube URL, and that
is a stale downloader, not a broken app.

Because of that, **yt-dlp is deliberately not pinned to an exact version** and is updated on
its own schedule, separately from the other dependencies:

- the launchers run `pip install --upgrade yt-dlp[default,deno]` at most once a day;
- **the backend runs the same check itself when it starts**, so an install launched some
  other way still repairs itself. Tune with `CVIDEO_YTDLP_MAX_AGE_HOURS` (default 24).

The `[default,deno]` extras are not optional. yt-dlp no longer descrambles YouTube's player
itself: it runs YouTube's own JavaScript challenge in an external JavaScript runtime, using
solver scripts from `yt-dlp-ejs`. `[default]` installs the solver and `[deno]` installs the
runtime (a real Deno binary, straight into `backend\\.venv` - there is a Windows wheel, so
there is nothing to install by hand). Without them YouTube answers anonymous downloads with
"Sign in to confirm you're not a bot", which reads exactly like a cookie problem and is not
one.

**To see whether this install can download from YouTube at all**, open
<http://127.0.0.1:8000/api/health> and look at `youtube`:

```json
{"ok": true, "youtube": {"ytdlp": "2026.08.19", "js_runtimes": ["deno"],
                         "ejs": true, "ready": true, "last_check": "..."}}
```

`"ready": false` means the downloader is missing a prerequisite and YouTube URLs will keep
failing until it is fixed - double-click `update.cmd`.

### YouTube bot/sign-in challenges

Cvideo always downloads YouTube URLs **anonymously first**. If YouTube refuses — “Sign in to
confirm you're not a bot”, an `HTTP 403` on the media, or no usable format — it retries the
same download through YouTube's other player clients (`android`, `tv_simply`, `web_embedded`,
`mweb`, `ios`, `tv`). That recovers most refusals on its own, with no cookies and nothing for
you to do. Only if every one of those fails does it reach for local cookies: an exported
`cookies.txt` first, then each configured browser. If none works, the project stays put with
an error naming what was tried and why each failed, and ↻ Retry re-runs it.

**Windows note:** since Chrome 127, Chrome and Edge seal their cookie store with App-Bound
Encryption and yt-dlp *cannot* read it (`Failed to decrypt with DPAPI`, yt-dlp#10927) — a
running browser also locks the database (yt-dlp#7271). So on Windows the browser route only
really works with **Firefox**. The reliable route everywhere is a cookies.txt: export one from
a browser signed in to YouTube (any "Get cookies.txt" extension) and save it as
`backend\\youtube-cookies.txt`. Dropping the file in is the whole setup; it is read locally
and sent only to YouTube.

To change the order, or to turn the fallback off entirely, set the variable in `backend\\.env`
(or in your Windows user environment):

```
CVIDEO_YOUTUBE_COOKIE_BROWSERS=firefox,chrome   # your own order
CVIDEO_YOUTUBE_COOKIE_BROWSERS=off              # never touch a browser profile
```

The launcher resolves this itself — this window's environment, then your Windows user/system
environment (read from the registry, so a value set with `setx` or the System Properties
dialog applies without logging out), then `backend\\.env`, then the default — and passes the
answer to the backend process explicitly. It prints the decision and writes it to
`data\\backend.log`, e.g.
`YouTube browser-cookie fallback: chrome, edge, firefox (from Windows user environment).`
Non-Windows installs stay opt-in; use `=auto` there to get the same order.

**What this does and does not do.** yt-dlp reads the selected browser's cookie database on
this machine and sends those cookies only to the YouTube request Cvideo is already making.
Cvideo never copies them into a project, writes them to a log, or sends them anywhere else,
and local-file uploads never touch this path at all. The same is true of a `cookies.txt` you
supply. Keeping yt-dlp current is handled by `update.cmd` and the launchers (see above).

## Caption presets
`capcut` (classic TikTok), `hormozi` (uppercase pop), `beasty` (big centered),
`clean` (subtle lower-third). Pick per-project or per-clip.

## Roadmap
- **Phase B:** drag trim timeline, transcript editing that re-burns captions, smooth
  face-tracking reframe, more caption presets.
- **Phase C:** Gemini brain toggle, smarter hook detection, batch export, thumbnails.

See `GOAL.md` for the full build spec.
