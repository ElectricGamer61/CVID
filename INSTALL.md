# Installing Cvideo

This file is written **for an AI coding agent** doing the install, and it works as a plain
checklist for a person too. Hand your agent this one line:

> Read INSTALL.md and install Cvideo on this machine.

Everything below is a step, a command, and the check that proves the step worked. Do them in
order. Do not skip section 6.

---

## 0. What you are installing

Cvideo turns one long video into short vertical clips. It is a **local desktop app**: a Python
backend (FastAPI + SQLite) that does the video work, and a React UI it serves itself on
`http://127.0.0.1:8000`. There is no cloud account, no Docker, and no database to set up.

Nothing here needs a GPU. Nothing here needs an API key. Both make it better, neither is
required, and the app must finish this install working without them.

---

## 1. Check the machine first

| Need | Why |
| --- | --- |
| **Windows 10/11** | The one-click launchers are PowerShell. macOS/Linux can run the backend by hand (section 8) but have no launchers. |
| **~4 GB free disk** | Python packages, the speech model, and downloaded video. |
| **Internet** | To install packages and fetch videos. |

A GPU is optional. 8 GB of RAM is enough.

```powershell
# Where am I, and is this the repo?
Get-Location
Test-Path .\backend\requirements-bare.txt, .\frontend\package.json
```

Both must be `True`. If not, you are in the wrong folder: clone the repo first and `cd` into it.

```powershell
git clone https://github.com/ElectricGamer61/CVID.git
cd CVID
```

The repo is private, so the clone opens a browser to sign in to GitHub once. That is the only
interactive moment in the whole install.

---

## 2. Prerequisites

Four tools. Install any that are missing, then **re-read PATH in the same shell**, because
winget writes the registry and your already-running shell will not see the change.

```powershell
winget install -e --id Git.Git               --accept-package-agreements --accept-source-agreements --silent
winget install -e --id Python.Python.3.11    --accept-package-agreements --accept-source-agreements --silent
winget install -e --id OpenJS.NodeJS.LTS     --accept-package-agreements --accept-source-agreements --silent
winget install -e --id Gyan.FFmpeg           --accept-package-agreements --accept-source-agreements --silent

$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')
```

**Check (all four must answer):**

```powershell
git --version
py -3.11 -c "print('python 3.11 ok')"
node --version
ffmpeg -version | Select-Object -First 1
```

`py -3.11` specifically. The app needs 3.11; a machine whose only Python is 3.13 fails later
with confusing wheel errors, not a clear message.

If a tool installed but the check still fails, open a **new** shell and re-check. That is a
PATH refresh problem, not an install problem.

---

## 3. Build it

**Agents: run this script, not `install.cmd`.** `install.cmd` is the human path: it calls
`Read-Host` for API keys and ends in `pause`, so it will hang a non-interactive shell
forever. `setup-laptop.ps1` is the same build with no prompts.

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -File .\scripts\setup-laptop.ps1
```

It creates `backend\.venv` (Python 3.11), installs the backend dependencies, pre-downloads the
speech model, copies `backend\.env.example` to `backend\.env` if there is no `.env` yet, and
builds the UI into `frontend\dist`. Expect 5 to 15 minutes on a first run.

**Check:**

```powershell
Test-Path .\backend\.venv\Scripts\python.exe, .\frontend\dist\index.html, .\backend\.env
.\backend\.venv\Scripts\python.exe -m pip show yt-dlp | Select-String '^Version'
```

All three paths `True`, and yt-dlp present. If the UI build failed, `frontend\dist\index.html`
is missing and the app has nothing to serve: fix that before going on.

---

## 4. Keys (optional, skip freely)

Keys go in `backend\.env`, which is gitignored and never leaves the machine. **Never** put a
key in any other file, and never paste one into a commit.

| Key | Buys you | Without it |
| --- | --- | --- |
| `OPENAI_API_KEY` | AI picks the strongest moments and scores them | Clips are sampled evenly through the video |
| `ELEVENLABS_API_KEY` | Cloud transcription, and AI voiceover | Transcription runs offline on your CPU, free |

Ask the person whether they have either. If they do not, or they would rather not say, leave
both blank and move on. This is not a blocker and must not be presented as one.

If they give you a key, write it without disturbing the rest of the file:

```powershell
# example for one key; same shape for the other
(Get-Content .\backend\.env) -replace '^OPENAI_API_KEY=.*', 'OPENAI_API_KEY=sk-REPLACE' |
  Set-Content .\backend\.env
```

Then set the matching default so the app actually uses it:
`CVIDEO_DEFAULT_BRAIN=openai` with an OpenAI key, or `CVIDEO_DEFAULT_BRAIN=heuristic` with no
key and no Ollama.

**Free local alternative:** if [Ollama](https://ollama.com) is installed and running
(`ollama serve`) with a chat model pulled (`ollama pull qwen2.5:7b`), set
`CVIDEO_DEFAULT_BRAIN=ollama` for AI clip picking with no key and no cloud. If Ollama is not
answering, the app says so and falls back on its own.

---

## 5. Start it

```powershell
# Starts the backend, which serves the UI too. ONE port: http://127.0.0.1:8000
.\serve.cmd
```

**Agents: this never returns.** It is a supervised loop that restarts the backend if it dies
and prints its log forever. Start it in the background and poll the health check below.
Do not wait on it in the foreground.

For the person, the normal way in afterwards is the **Cvideo icon on the Desktop**
(`install-shortcut.cmd` creates it any time). It starts the server only if it is not already
running and opens the app in its own window.

**Check:**

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health | ConvertTo-Json -Depth 5
```

Expected, within about 30 seconds of starting:

```json
{ "ok": true,
  "youtube": { "ytdlp": "2026.08.19", "js_runtimes": ["deno"], "ejs": true, "ready": true } }
```

`"ready": true` is the one that matters. **If it is `false`, YouTube links will fail** no
matter what else is right: the downloader is missing its JavaScript challenge solver. Fix it
with `.\update.cmd`, then check again.

---

## 6. Prove it works (do not skip this)

A server that answers `/api/health` has proved nothing about clipping. Run one real video all
the way through before you tell anyone the install is done.

1. Open <http://127.0.0.1:8000>.
2. On **Clipping**, give it a project name and paste a short YouTube link (something under
   about 10 minutes for a quick first run). Press **Generate clips**.
3. Watch the card. It should move through downloading, transcribing, finding clips, and land
   on **ready** with several scored clips. Minutes, not seconds.
4. Open the project, press **Export** on one clip, wait for it to finish, then **Download**.
5. Play the downloaded file. It must be a tall 9:16 video with big captions burned in.

If any step stalls or errors, the card shows the reason and a **Retry**. Read that message
before you change anything: it names the real failure, and a retry reuses the audio and
transcript already on disk rather than starting over.

---

## 7. When something fails

| What you see | What it is | Fix |
| --- | --- | --- |
| `"ready": false` on `/api/health`, or YouTube links fail with a sign-in / bot message | The downloader is stale or missing its JS challenge solver. **This is the most common failure by far.** | `.\update.cmd`, then re-check health |
| Every YouTube video downloads tiny or blurry | Usually the source really is low resolution (old 4:3 uploads are 240p). Check the video on YouTube. | Nothing to fix if the source is small |
| A project sits on "Finding moments" for many minutes | The local Ollama model is thinking without answering | Set `CVIDEO_DEFAULT_BRAIN=heuristic` (or `openai` with a key) in `backend\.env` and restart |
| A project or export shows "Cvideo was restarted..." | The app was closed mid-job | Press **Retry** / **Export**. Nothing is lost |
| "Backend venv is missing" | Section 3 never completed | Re-run `scripts\setup-laptop.ps1` |
| "The UI could not be built" | `npm run build` failed | `cd frontend; npm install; npm run build` and read the error |
| Transcription never finishes on a laptop | A multi-GB model on a CPU | `CVIDEO_WHISPER_MODEL_CPU=small` in `backend\.env` |
| Port 8000 already in use | Cvideo is already running | Open <http://127.0.0.1:8000>, or stop the other instance |

Live log: `data\backend.log`. Everything the backend prints lands there, and it is the first
place to look for anything not in this table.

**Keeping it working:** double-click `update.cmd` any time. YouTube breaks the downloader
every few weeks, so an install that never updates eventually fails on every YouTube link. The
launchers already do this check on start; `update.cmd` forces it.

---

## 8. macOS / Linux

No launchers exist, but the app runs. Same four prerequisites (Python 3.11, Node, ffmpeg, git):

```bash
cd backend
python3.11 -m venv .venv
./.venv/bin/python -m pip install -r requirements-bare.txt
cp -n .env.example .env
cd ../frontend && npm install && npm run build
cd ../backend && ./.venv/bin/python -m uvicorn app.main:app --port 8000
```

Then sections 5 to 7 apply unchanged, minus the `.cmd` files. The browser-cookie fallback for
YouTube is opt-in off Windows: set `CVIDEO_YOUTUBE_COOKIE_BROWSERS=auto` if you want it.

---

## Notes for agents

Things that will bite you, learned the hard way:

- **Do not run `install.cmd` or `update.cmd` non-interactively.** Both block on input
  (`Read-Host`, `pause`). Use `scripts\setup-laptop.ps1` and `scripts\update.ps1`.
- **Do not wait on `serve.cmd` in the foreground.** It is an infinite supervised loop.
  Background it and poll `/api/health`.
- **Do not pin `yt-dlp` to an exact version, and never drop its `[default,deno]` extras.**
  They install the JavaScript runtime that answers YouTube's challenge. A bare `yt-dlp`
  fails every anonymous YouTube download with a message that reads like a cookie problem
  and is not one.
- **Do not add PyTorch, CUDA wheels, or MediaPipe.** Transcription uses faster-whisper
  (CTranslate2) and reframing uses OpenCV, both deliberately. `requirements-bare.txt` is the
  laptop profile and is the one the launchers install.
- **Do not put API keys anywhere but `backend\.env`.** It is gitignored on purpose.
- **A green health check is not a working install.** Section 6 is the actual test.
- **Read the on-screen error before changing code.** The app is built to say what went wrong
  and offer a Retry; today's failure is usually a stale downloader, not a bug.

Once it is installed and you are changing the code instead, the files to read are
[AGENTS.md](AGENTS.md) for the working rules and [CONTEXT.md](CONTEXT.md) for how the app
actually works.
