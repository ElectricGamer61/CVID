# Vendored: FreeCut editor

This directory is a **vendored fork** of FreeCut (MIT), embedded as Cvideo's polished
short-form editor. We do not upstream changes; updates come from re-pulling and merging.

- Upstream: https://github.com/walterlow/freecut
- License: MIT (see `LICENSE`)
- Vendored at commit: `db6edeb2901050f5f6d6229c801e714c5459ef5d`
- Vendored on: 2026-07-01

## How Cvideo uses it
- **Editor UI**: FreeCut's built SPA (served with COOP `same-origin` / COEP `require-corp`),
  opened at `/editor/$projectId`. Data model = a workspace folder on disk (`project.json` +
  `media/<id>/`).
- **Render/automation**: Cvideo's backend calls the headless renderer
  (`node headless/render.mjs --workspace <ws> --project <id> --out out.mp4`), which drives the
  real export engine in headless Chrome (Playwright) → full-fidelity MP4. Keeps server-side,
  batchable rendering (Autopilot).

## Requirements
- Chromium (Chrome/Edge/Brave/Arc 113+) for the editor UI; WebGPU + WebCodecs + OPFS.
- Chrome installed on the render box for the headless path (Playwright `channel: chrome`).

## Re-pulling upstream later
Clone upstream fresh, diff against this commit, and merge deliberately (its toolchain
`vp`/Vite+, oxlint, TanStack Router codegen is bespoke — treat as a whole sub-app, do not
merge its source into `frontend/`).
