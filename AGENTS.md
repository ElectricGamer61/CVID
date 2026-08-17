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
- **A screen that fetches must tell "gone" apart from "offline".** Every nav target that
  restores remembered state (the sidebar's Editor button and `cv.lastEdit`) can point at a row
  that has since been deleted. Swallowing the error left the editor on its loading skeleton
  forever, so the button looked dead. Use `isNotFound` from `api.ts` (404 → forget it and fall
  back to the section's own empty screen); a network failure must keep waiting, because the
  offline banner already explains that one and bailing out would lose the user's place.
- **Exercise the flow, don't trust the API.** Several problems here were only visible in the browser
  — a 500 whose toast had already faded, a raw C++ assertion rendered into the editor, a button
  whose only possible outcome was a 400. Drive the real UI when changing the creation path.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
