# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Where the real docs are

`CONTEXT.md` is the source of truth for **how CVideo works today** (pipeline, API, frontend,
gotchas, and a "Verify quickly" checklist). `README.md` is Windows setup, `SPEC.md`/`GOAL.md` are
the original spec, `docs/` holds the session timeline. Read `CONTEXT.md` before changing anything.

## Validating a change

- Frontend: `cd frontend && npm run build` (tsc + vite) and `npm test` (vitest; pure UI logic in
  `src/App.test.ts` — no DOM, no server).
- Backend: `cd backend && <venv python> test_reframe.py`. The other `backend/test_*.py` and
  `verify_*.py` scripts need a **running server** and real media; `test_reframe.py` does not.

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
  `/api` to `127.0.0.1:8000`.

## Sharp edges found the hard way

- **The headless OpenCV wheel has no Haar cascade data.** `CascadeClassifier` loads empty and
  `detectMultiScale` then raises `!empty()` instead of finding nothing. `reframe.py` guards this
  now, but the shape generalises: treat every optional CV/ML asset as absent and keep the render
  alive without it.
- **Exercise the flow, don't trust the API.** Several problems here were only visible in the browser
  — a 500 whose toast had already faded, a raw C++ assertion rendered into the editor, a button
  whose only possible outcome was a 400. Drive the real UI when changing the creation path.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
