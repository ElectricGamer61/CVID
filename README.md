# Cvideo

**Cvideo turns one long video into short vertical clips you can post.**

Give it a YouTube link or a video file. It listens to the whole thing, picks the strongest
moments, crops each one to a phone-shaped 9:16 video, burns in the big moving captions, and
hands you finished clips to download. It runs on your own PC and it is free.

It does the job you would pay OpusClip or wayinvideo a monthly fee for, except nothing leaves
your machine unless you ask it to, and there is nothing to subscribe to.

### How you use it

1. **Paste a link** (or drag in a video file) on the **Clipping** screen.
2. **Wait.** It writes down everything said in the video and finds the best moments.
3. **Look at what it found** - a grid of clips, each scored out of 100 with the line that makes it work.
4. **Open one in the editor.** Trim it, cut the boring middle out, change the caption style,
   move the crop onto the speaker, add a colour look.
5. **Export, then download.** The finished clip lands in the folder you choose.

That is the whole app. It does not post for you, it has no accounts, and it never asks for a
card.

### What you need

A Windows PC. That is it. A graphics card and API keys both make it better, and neither is
required: transcription runs free on your processor, and without an AI key it still finds
clips by sampling evenly through the video.

---

## Install it

### The easy way: hand it to an AI agent

If you use an AI coding agent (Claude Code, Cursor, Codex, and so on), open this folder in it
and say:

> Read INSTALL.md and install Cvideo on this machine.

**[INSTALL.md](INSTALL.md)** is written for exactly that: every command, the check that proves
each step worked, the fix for each way it can fail, and the traps that hang an agent (two of
the scripts wait for a keypress, and the server script never exits). It is also a perfectly
good checklist to follow yourself.

### Doing it yourself (Windows, about 10 minutes)

This repo is **private**, so the first step needs a one-time sign-in. A browser window pops up
on its own - there is no token to paste.

**1.** Open PowerShell and install Git (skip if you already have it):

```powershell
winget install -e --id Git.Git
```

Close and reopen PowerShell so `git` is on PATH.

**2.** Clone the repo (a browser window opens once - sign in to GitHub there):

```powershell
git clone https://github.com/ElectricGamer61/CVID.git
```

**3.** Open the new `CVID` folder and double-click **`install.cmd`**.

It installs everything else (Python, Node, ffmpeg), builds the app, offers to save your
**ElevenLabs** and **cloud categorizer** keys (press Enter twice to skip - you can add them
later in `backend\.env`), and starts it.

It also puts a **`Cvideo` icon on your Desktop**. From then on, opening the app is one
double-click: it starts the local server if it is not already running and opens Cvideo in its
own window. Missing or moved? Double-click **`install-shortcut.cmd`** to put it back, or run
**`serve.cmd`** to start the server by hand.

**Not on Windows?** Section 8 of [INSTALL.md](INSTALL.md) has the macOS and Linux commands.

<sub>If you ever make this repo public, `scripts/bootstrap.ps1` can also run as a single
`iwr -useb <raw-url> | iex` one-liner that does steps 1 to 3 in one shot.</sub>

<sub>Already cloned the repo? Just double-click **`install.cmd`**.</sub>

---

## What's in the box
- **Backend** (`backend/`) - FastAPI + SQLite pipeline:
  ingest (yt-dlp / upload) -> transcribe (faster-whisper on the CPU, or ElevenLabs with a key)
  -> clip finder (OpenAI with a key, local Ollama if it is running, otherwise an evenly
  sampled fallback) -> 9:16 reframe (OpenCV face tracking) -> captions (ffmpeg ASS) -> render.
- **Frontend** (`frontend/`) - React + Vite: paste a link or upload, review the scored
  clips, trim / cut / caption / reframe in the editor, export, download.

## What gets installed on your PC

`install.cmd` puts all of this there for you. Listed so you know what is on the machine:
- **ffmpeg** (on PATH) - `ffmpeg -version`
- **Python 3.11** - the venv lives in `backend\.venv`
- **Node 18+** - only to build the UI
- Optional keys in `backend\.env`: `ELEVENLABS_API_KEY` (cloud transcription + AI voice),
  `OPENAI_API_KEY` (AI clip picking). Without them transcription runs offline on the CPU
  and clips are sampled evenly through the video.
- Optional: **Ollama** with a chat model (`ollama pull qwen2.5:7b`) gives AI clip picking
  with no key. If it is not running the app says so and uses the basic finder.

## Starting it

Double-click the **`Cvideo`** icon on your Desktop (`install.cmd` puts it there; run
**`install-shortcut.cmd`** any time to recreate it). It starts the local app only if it isn't
already running and opens it in its own window - no terminal, nothing to type. It is a plain
Windows shortcut to `scripts\open-cvideo.ps1`; there is no desktop app to install.

Other ways in, if you want them:
- **`serve.cmd`** - one port, `http://127.0.0.1:8000`, also reachable from your phone on the
  same wifi (run `allow-network.cmd` once). It keeps the window open and restarts the backend
  if it ever crashes; everything it prints is also written to `dataackend.log`.
- **`scripts\start.ps1`** - the two-server dev setup (backend + Vite on
  http://localhost:3000), for working on the code.

If the app was closed or restarted while a video was being analyzed or exported, that item
shows an error with a **Retry** / **Export** button; nothing is lost, and a retry reuses the
audio and transcript already on disk instead of downloading or transcribing again.

## Setup by hand (developers)

### Backend
```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-bare.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```
`requirements-bare.txt` is the laptop profile (CPU transcription, no GPU libraries, ~1 GB).
`requirements.txt` adds the CUDA libraries for a desktop with an NVIDIA card.

### Frontend
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:3000. The Vite dev server proxies `/api` to the backend on :8000.
`npm run build` produces `frontend/dist`, which the backend serves itself on :8000.

### Tests
```powershell
cd frontend; npm run build; npm test
cd backend;  foreach ($t in Get-ChildItem test_*.py) { .\.venv\Scripts\python.exe $t.Name }
```
`test_api.py`, `test_api2.py`, `test_brain.py` and `test_full.py` need a running server and
real media; every other `backend	est_*.py` runs offline.

## Configuration (env vars / `backend/.env`)
- `CVIDEO_WHISPER_MODEL` (default `large-v3`) · `CVIDEO_WHISPER_DEVICE` (`auto`/`cuda`/`cpu`)
- `CVIDEO_OLLAMA_MODEL` (default `qwen3.5:9b`) · `OLLAMA_HOST` · `CVIDEO_OLLAMA_MAX_TOKENS` (default 4096) · `CVIDEO_OLLAMA_TIMEOUT_SEC` (default 600)
- `GEMINI_API_KEY` · `CVIDEO_GEMINI_MODEL` (default `gemini-1.5-flash`)
- `CVIDEO_DEFAULT_BRAIN` (`openai`/`claude`/`ollama`/`gemini`/`heuristic`); `openai` is retained as the backend compatibility id for Cloud categorizer
- `CVIDEO_TARGET_CLIPS`, `CVIDEO_MIN_CLIP`, `CVIDEO_MAX_CLIP`
- `CVIDEO_YOUTUBE_COOKIE_BROWSERS` (browser order for the YouTube sign-in fallback; on Windows it defaults to `chrome,edge,firefox`, set `off` to disable)
- `CVIDEO_YOUTUBE_COOKIES_FILE` (path to an exported `cookies.txt`; defaults to `backend\youtube-cookies.txt` if that file exists)
- `CVIDEO_AUTO_UPDATE` (`off` stops the launchers fast-forwarding this checkout on start)

## Keeping it up to date

Double-click **`update.cmd`**. It pulls the newest version, updates the backend downloader
(**yt-dlp**) and the other Python dependencies, and rebuilds the UI.

The launchers also do this for you: `serve.cmd`, `start.cmd` and the Desktop icon fast-forward
the checkout and re-sync `backend\.venv` to the pinned requirements *before* starting the
backend, and log what they did to `data\backend.log`. A checkout with local changes, a
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
runtime (a real Deno binary, straight into `backend\.venv` - there is a Windows wheel, so
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

Cvideo always downloads YouTube URLs **anonymously first**. If YouTube refuses - "Sign in to
confirm you're not a bot", an `HTTP 403` on the media, or no usable format - it retries the
same download through YouTube's other player clients (`android`, `tv_simply`, `web_embedded`,
`mweb`, `ios`, `tv`). That recovers most refusals on its own, with no cookies and nothing for
you to do. Only if every one of those fails does it reach for local cookies: an exported
`cookies.txt` first, then each configured browser. If none works, the project stays put with
an error naming what was tried and why each failed, and ↻ Retry re-runs it.

**Windows note:** since Chrome 127, Chrome and Edge seal their cookie store with App-Bound
Encryption and yt-dlp *cannot* read it (`Failed to decrypt with DPAPI`, yt-dlp#10927) - a
running browser also locks the database (yt-dlp#7271). So on Windows the browser route only
really works with **Firefox**. The reliable route everywhere is a cookies.txt: export one from
a browser signed in to YouTube (any "Get cookies.txt" extension) and save it as
`backend\youtube-cookies.txt`. Dropping the file in is the whole setup; it is read locally
and sent only to YouTube.

To change the order, or to turn the fallback off entirely, set the variable in `backend\.env`
(or in your Windows user environment):

```
CVIDEO_YOUTUBE_COOKIE_BROWSERS=firefox,chrome   # your own order
CVIDEO_YOUTUBE_COOKIE_BROWSERS=off              # never touch a browser profile
```

The launcher resolves this itself - this window's environment, then your Windows user/system
environment (read from the registry, so a value set with `setx` or the System Properties
dialog applies without logging out), then `backend\.env`, then the default - and passes the
answer to the backend process explicitly. It prints the decision and writes it to
`data\backend.log`, e.g.
`YouTube browser-cookie fallback: chrome, edge, firefox (from Windows user environment).`
Non-Windows installs stay opt-in; use `=auto` there to get the same order.

**What this does and does not do.** yt-dlp reads the selected browser's cookie database on
this machine and sends those cookies only to the YouTube request Cvideo is already making.
Cvideo never copies them into a project, writes them to a log, or sends them anywhere else,
and local-file uploads never touch this path at all. The same is true of a `cookies.txt` you
supply. Keeping yt-dlp current is handled by `update.cmd` and the launchers (see above).

## Caption styles

Picked per clip in the editor, where you can see them on your own footage:

- **cinematic** (the default) - huge, two words at a time, across the middle of the frame
- **capcut** - the classic TikTok look
- **hormozi** - uppercase, green highlight
- **beasty** - big and centered, cyan highlight
- **clean** - a subtle lower third

Size, colours, position and words-per-line are all adjustable on top of whichever you pick.

## Where to read more

- **[INSTALL.md](INSTALL.md)** - installing it, step by step, human or AI agent.
- **`CONTEXT.md`** - how the app works inside: the pipeline, the API, the editor, and the
  sharp edges. Read this before changing code.
- **`AGENTS.md`** - the working rules for anyone (or anything) editing this repo.
- **`SPEC.md`** / **`GOAL.md`** - the original build spec, kept for history.
