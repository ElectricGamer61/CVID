# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Where the real docs are

`CONTEXT.md` is the source of truth for **how CVideo works today** (pipeline, API, frontend,
gotchas, and a "Verify quickly" checklist). `README.md` is Windows setup, `SPEC.md`/`GOAL.md` are
the original spec, `docs/` holds the session timeline. Read `CONTEXT.md` before changing anything.

## Validating a change

- Frontend: `cd frontend && npm run build` (tsc + vite) and `npm test` (vitest; pure UI logic in
  `src/App.test.ts` — no DOM, no server). There is no jsdom/testing-library here: to pin something
  about a *screen*, either extract the rule into a pure module (`scriptPrompt.ts`, `looks.ts`) or
  assert against `import appSource from "./App.tsx?raw"`, which is how the copy guards work.
- Backend: `cd backend && <venv python> test_reframe.py`, `test_look.py` (Cinematic Look /
  big title) and `test_transcribe.py` (transcription fallback + failure reporting + secret
  hygiene). The other `backend/test_*.py` and `verify_*.py` scripts need a **running server**
  and real media; these three do not.

## Running it on WSL/Linux (the docs assume Windows)

The app runs fine on Linux for verification, but nothing in-repo sets that up:

- **No `python3.11`, no `ensurepip`, no `pip`.** Create the venv with
  `python3 -m venv --without-pip .venv`, then bootstrap pip into it with `get-pip.py`.
  `backend/requirements-bare.txt` pins versions that predate the system Python; installing
  `fastapi uvicorn sqlmodel python-multipart python-dotenv requests numpy
  opencv-contrib-python-headless` unpinned works and is enough to import `app.main`.
- **ffmpeg is not installed.** Every render/assemble path shells out to it and dies with
  `FileNotFoundError: 'ffmpeg'` without it. A static build (johnvansickle) on `PATH` works and has
  the libx264 + libass that caption burn-in needs.
- **Browser checks:** there is no Chrome, but Playwright's chromium is usually cached at
  `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`. Launch it with
  `--remote-debugging-port` and point `chrome-devtools-axi` at it via
  `CHROME_DEVTOOLS_AXI_BROWSER_URL`. Emoji render as tofu in that headless build — **not** an app bug.
- Vite dev serves on **port 3000** (`vite.config.ts`), not 5173 as some older docs say, and proxies
  `/api` to `127.0.0.1:8000`. Two checkouts can't both use those ports: run the second one as
  `PORT=3100 API_PORT=8010 npm run dev` with its backend on `--port 8010`, so you never smoke-test
  against another worktree's database.

## Sharp edges found the hard way

- **The headless OpenCV wheel has no Haar cascade data.** `CascadeClassifier` loads empty and
  `detectMultiScale` then raises `!empty()` instead of finding nothing. `reframe.py` guards this
  now, but the shape generalises: treat every optional CV/ML asset as absent and keep the render
  alive without it.
- **Anything that changes the picture must be provable as a no-op when it's off.** The Look /
  big-title feature is the pattern: the opt-in path returns `""`/`None`, the ffmpeg command and
  the `.ass` come out byte-identical, and a test asserts exactly that. Users' existing exports
  must never move because a new feature exists.
- **Never pipe a native command's stderr with PowerShell's own `2>&1` in `scripts/*.ps1`.**
  uvicorn logs everything to stderr; under Windows PowerShell 5.1 the `2>&1` merge turns each
  stderr line into a `NativeCommandError` **error record**, so with `$ErrorActionPreference =
  "Stop"` the launcher died on uvicorn's first INFO line — before the port bound and before
  `Tee-Object` created `data\backend.log`, which is why it looked like a silent no-op. Let `cmd`
  do the merge instead (`cmd /c "... 2>&1" | Tee-Object ...`) so PowerShell only ever sees plain
  stdout; `serve.ps1`, `open-cvideo.ps1` and `start.ps1` all use that form. Test any launcher
  change by actually double-clicking the `.cmd` (`cmd.exe /c serve.cmd`) and then checking both
  `/api/health` and that `backend.log` holds plain `INFO:` lines.
- **The laptop build is a real target, and an exit code is not a diagnosis.** Every upload on the
  Windows install failed with "exit 1 — likely a GPU/CUDA fault" on a machine with no GPU in
  play at all: the bare-bones install shipped no faster-whisper, the ElevenLabs key was blank,
  and `jobs.transcribe_subprocess` discarded the child's traceback and guessed CUDA for *any*
  non-zero exit. Two rules came out of it. (1) A subprocess must report its own reason
  (`ERROR <reason>` on stdout) and the parent must relay it — guessing from an exit code sends
  people to debug hardware they never used. (2) The default install has **no API keys and no
  GPU**; a feature whose only path needs either is broken by default, so keep a keyless CPU
  path and gate the key on the feature that truly needs it (voiceover), not the one that
  doesn't (transcription). See `CONTEXT.md` §3 transcribe.py and `backend/test_transcribe.py`.
- **A screen that fetches must tell "gone" apart from "offline".** Anything that restores
  remembered state (the editor start screen's "pick up where you left off", built from
  `cv.lastEdit`) can point at a row that has since been deleted. Swallowing the error left the editor on its loading skeleton
  forever, so the button looked dead. Use `isNotFound` from `api.ts` (404 → forget it and fall
  back to the section's own empty screen); a network failure must keep waiting, because the
  offline banner already explains that one and bailing out would lose the user's place.
- **Remembered state is an offer, never an action.** The sidebar's Editor button used to route
  straight back into `cv.lastEdit`, so opening the editor silently reloaded the video you had
  already finished and there was no way to reach an empty editor at all. Persisting where
  someone was is fine; *acting* on it without them asking is the bug. Restore it as a labelled,
  one-click offer on the section's own empty screen instead.
- **A first-run download is a UX problem, not a detail.** faster-whisper fetches its weights
  inside `WhisperModel()`, so the first upload on a fresh install spent minutes in a constructor
  that emitted nothing — the project row froze on "Transcribing" 20%, the frontend polled it
  forever, and when the connection dropped at 2.68 of 3.09 GB the reason arrived as a raw
  `WinError 10054` blob. Three rules came out of it, and they generalise past Whisper. (1) Any
  step that can take minutes must **narrate itself** before it starts, not after; the parent's
  stall timeout is only meaningful once silence is unambiguous. (2) A *default* must never
  commit the user to a multi-GB download — cap it (`WHISPER_MAX_AUTO_DOWNLOAD_MB`), use what's
  already cached at any size, and make the big model an explicit opt-in. (3) Probe the
  **runtime**, not the device: `get_cuda_device_count()` returns 1 on a bare-bones install with
  no cuBLAS, and "just try it and see" cost a 3.1 GB download to learn that. Every failure a
  user can hit needs a visible way forward — here `POST /api/projects/{pid}/retry` plus a ↻ Retry
  on the card, because the media is still on disk and deleting the project to re-upload was the
  only previous escape.
- **A Windows launcher must hand the backend its config, not hope it inherits it.** A user
  had `CVIDEO_YOUTUBE_COOKIE_BROWSERS` set in the Windows *user* environment and the backend
  still reported "No browser-cookie fallback is enabled": `HKCU\Environment` (what `setx` and
  the System Properties dialog write) does not reach a process whose ancestor started before
  the value was set, and the launchers only ever forwarded that stale block. `scripts/cvideo-env.ps1`
  now resolves such settings from the registry + `backend\.env`, sets them in the launcher's own
  process, injects them into the child window's `-Command` string, and logs the decision to
  `data\backend.log`; `backend/test_launcher_env.py` pins both the source wiring and - on any
  machine where a real PowerShell is reachable, WSL included - the registry-to-child-process
  chain. Same shape for anything else the backend reads from the environment.
- **The signed-in-browser path can only be checked so far from here.** A bot-challenge recovery
  is testable end to end with stubs (`backend/test_ingest_auth.py`,
  `backend/test_youtube_job_recovery.py`) and the launcher chain is testable on real PowerShell,
  but a *live* YouTube challenge answered by a real signed-in Chrome/Edge/Firefox profile needs
  the Windows machine. Say which half you actually exercised; never claim "YouTube works now".
- **A merged fix is not an installed fix.** A user kept hitting a YouTube failure hours after its
  fix was merged because nothing on the normal path (Desktop icon -> `open-cvideo.ps1`) pulls
  code or reinstalls dependencies — only `install.cmd` does, and that only ran once. Every
  launcher now dot-sources `scripts/cvideo-update.ps1` and fast-forwards the checkout plus
  re-syncs `backend/requirements-bare.txt` (via a SHA256 stamp, so it is a no-op once caught up)
  before starting anything; `update.cmd` runs the same update by hand. Any future fix to this repo
  is worthless on a laptop until that laptop's checkout and venv actually move — assume they
  haven't and check, don't assume a merge is the end of the job.
- **yt-dlp is not an ordinary dependency: never pin it, and never install it bare.** Two separate
  traps, and each one hides the other (they cost four merged "fixes" — PRs #15/#17/#18/#20 — that
  all left the clipper broken):
  1. *Pinning.* YouTube rewrites its player every few weeks, so an exact pin guarantees the app
     rots. Worse, the launcher's dependency sync only runs pip when `requirements-bare.txt`
     *changes*, so a pin is not merely stale, it is unreachable — the "self-updating" install
     could never move yt-dlp at all. It is now a floor (`>=`), refreshed on its own cadence by
     `Sync-CvideoYtDlp` (launchers, daily) and by `backend/app/ytdlp_health.py` (the backend
     itself, at startup — so an install whose checkout is too old to have the launcher change
     still repairs itself).
  2. *The extras.* yt-dlp no longer descrambles YouTube's player itself; it runs YouTube's own
     JavaScript challenge in an EXTERNAL runtime using solver scripts from `yt-dlp-ejs`. Both are
     extras: `yt-dlp[default]` for the solver, `yt-dlp[deno]` for a Deno binary (there is a
     Windows wheel, so it lands inside `backend/.venv` with nothing to install by hand). yt-dlp
     only ever looks for `deno` on PATH, and the launchers run `.venv\Scripts\python.exe`
     directly — so the runtime must be passed explicitly (`settings.resolve_js_runtimes` ->
     `js_runtimes`), never left to PATH discovery.
  `GET /api/health` reports `youtube: {ytdlp, js_runtimes, ejs, ready}` — check that first when a
  YouTube URL fails, before touching cookies.
- **Never pass `no_warnings: True` to yt-dlp.** yt-dlp says *why* YouTube is refusing in warnings,
  not errors — "No supported JavaScript runtime could be found", "Unable to fetch GVS PO Token",
  `HTTP 429`. Suppressing them is the single reason a missing JS runtime looked like a cookie
  problem through three rounds of fixes: what surfaced was YouTube's "Sign in to confirm you're
  not a bot", which reads exactly like a cookie problem and is not one. `ingest.py` routes them
  to `data/backend.log` via `_YdlLog`.
- **A bot challenge is per-video, per-IP and time-varying, so one probe proves nothing.** The same
  URL can 403 on every player client and download cleanly ten minutes later; a hammered IP starts
  getting `HTTP 429` and challenges everything. When testing a YouTube fix, use several real URLs,
  space the attempts out, and drive the *app's* full ladder rather than a single bare yt-dlp call —
  a single-client probe reports "blocked" for videos the app ingests fine.
- **Windows browser cookies are a dead end more often than not, so don't lean on them as the only
  fallback.** Chrome/Edge 127+ seal cookies with App-Bound Encryption yt-dlp cannot read
  (yt-dlp#10927), and a running Chrome/Edge locks its cookie DB (yt-dlp#7271) — "sign in to a
  browser and retry" can be structurally impossible on a given machine. `ingest.py` now sweeps
  anonymous yt-dlp player clients (`android`, `tv_simply`, `web_embedded`, `mweb`, `ios`, `tv`)
  first — that alone clears most `403`/format refusals with no cookies at all — then falls back to
  a `cookies.txt` file (`CVIDEO_YOUTUBE_COOKIES_FILE`), then to browsers, and every failure names
  the actual store-specific cause plus the installed yt-dlp version instead of one generic
  "sign in" message.
- **Exercise the flow, don't trust the API.** Several problems here were only visible in the browser
  — a 500 whose toast had already faded, a raw C++ assertion rendered into the editor, a button
  whose only possible outcome was a 400. Drive the real UI when changing the creation path.
- **The product is a local video editor, and the backend is much bigger than it.** The UI is four
  stops — Clipping · Create · Editor · Downloads — and that is the whole app. A large second
  product (autopilot, approval gates, multi-brand cartridges, scheduling/posting, performance
  metrics, the shoot-drop bin) still lives in `backend/app/` and still answers on its routes, but
  **nothing in `frontend/` calls it** and there is no flag or URL parameter that brings it back.
  `CONTEXT.md` §5 lists the dormant routes and §6 lists what was removed. Two consequences:
  (1) don't reason about a backend module's existence as evidence the feature ships — grep
  `frontend/src` before assuming; (2) `App.test.ts` › *"the app is only an editor"* asserts the
  removed vocabulary (autopilot, gate, schedule, post, brand picker, Advanced) never returns to
  the source, so re-adding any of it fails `npm test` on purpose. Deleting the dormant backend is
  a follow-up that needs the `backend/test_*.py` suites which want a running server + real media.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
