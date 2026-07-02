# FreeCut editor — integration plan & status

The vendored FreeCut editor replaces Cvideo's janky in-app editor with a polished,
OpusClip-style timeline. Lives at `editor/` (see [../../editor/VENDOR.md](../../editor/VENDOR.md)).

## What it is
- MIT-licensed. React 19 + Vite + TypeScript, TanStack Router SPA. Own toolchain (`vp`/Vite+,
  oxlint, router codegen) — treat as a **whole sub-app**, do not merge its source into `frontend/`.
- Runtime: WebGPU + WebCodecs + OPFS. **Requires cross-origin isolation** (`COOP: same-origin`
  + `COEP: require-corp`). Chromium only (Chrome/Edge/Brave/Arc 113+).
- Ships a **headless renderer** (`editor/headless/render.mjs`, `edit.mjs`) — drives the real
  export engine in headless Chrome (Playwright) → full-fidelity MP4.

## The integration contract: a workspace folder on disk
```
workspace/
├── projects/<projectId>/project.json   # timeline (compositions, items → media ids), metadata
└── media/<id>/                          # source blob + metadata.json (from probing) + thumbnail
```
- UI reads/writes this via File System Access API + OPFS.
- Headless reads it with plain fs. `render.mjs` range-streams media (a 5s slice of a 3GB source
  renders without loading the whole file).

## Two seams over that contract
1. **Editor UI** — serve FreeCut's built SPA (with the isolation headers), open `/editor/$projectId`.
   Cvideo seeds a project from a source clip; user edits; save writes `project.json`.
2. **Render** — Cvideo backend shells out:
   `node editor/headless/render.mjs --workspace <ws> --project <id> --out out.mp4`.

## Phased plan
- **Phase 0 — Bare boot.** ✅ DONE. Vendored, `npm install` clean, dev server runs on :5173 with
  correct COOP/COEP. Recolored to Cvideo purple. (Verify visually in Chrome — needs WebGPU.)
- **Phase 1a — Headless engine proven.** ✅ DONE (2026-07-01). `dist` built; `node headless/test.mjs`
  passes every check on this machine (Playwright 1.60 + Chrome): render path (video, ~3s, real
  bytes), edit path (ops + round-trip captions/transform/keyframes), and edited-project render.
  The automatable server-side render path works — no UI, no human.
- **Phase 2 — Embed the editor UI.** ✅ DONE (2026-07-01). FreeCut runs same-origin at
  `/editor/` (proxied from Cvideo's frontend dev server to FreeCut's dev server, both on their
  own ports), so the File System Access workspace picker works (it's blocked cross-origin).
  Cvideo serves cross-origin-isolated (`COOP: same-origin` / `COEP: credentialless`); the
  FreeCut frame keeps `COEP: require-corp` — no conflict, verified via curl. Backend tags
  responses `Cross-Origin-Resource-Policy: cross-origin` so thumbnails/video still load under
  isolation. New **Editor** tab in the sidebar renders FreeCut in an iframe. Still feels
  "bolted on" — it opens FreeCut's raw workspace picker, not a Cvideo video. Phase 2b (below)
  fixes that.
- **Phase 2b — First-run workspace + auto-open with scenes.** ← NEXT (this is the real ask:
  "make a video" should land you IN the editor with the scenes already there, and the Editor
  tab shouldn't feel like a separate app). Plan:
  1. **First run**: Cvideo asks for a folder once, creates `Cvideo/{projects,media,reels}/`
     inside it. That folder becomes both the FreeCut workspace AND where Cvideo's backend
     writes. No more raw FreeCut picker.
  2. **Seeder — reframed, much smaller than first thought.** FreeCut already has the hard
     parts: real scene detection (`infrastructure/analysis/scene-detection.ts`), captioning
     (`infrastructure/analysis/captioning`), and — critically — a **programmatic edit API**
     proven by the headless test: `addItem`, `addText`, `split`, `trimStart/End`, `moveItem`,
     `addTransition` (see `headless/edit.mjs` header comment for the full op list). So the
     seeder is NOT "invent a timeline schema" — it's "emit an `ops.json` from Cvideo's scene
     markers/captions and hand it to the proven `edit.mjs` CLI." Cvideo's voice-first timing
     is already baked into each rendered scene clip's duration/audio by the time it gets here —
     nothing to re-derive, FreeCut just places already-timed clips.
  3. **Auto-open**: after "make a video," navigate straight to `/editor/<project>` with the
     scenes already on the timeline (no separate "go to Editor tab" step).
- **Phase 3 — Close the loop.** Export routes render via the headless renderer into
  Downloads/publish; retire the old editor (keep as fallback during transition).

## Gotchas to design around
- **Cross-origin isolation** headers must be scoped to the editor, not slapped app-wide (would
  break other cross-origin embeds like YouTube thumbnails).
- **Chrome + Playwright** on the render box for headless (Playwright `channel: chrome`).
- **Voice-first magic stays in Cvideo.** Our per-scene recorded VO + voice-first re-timing +
  teleprompter don't map to FreeCut's timeline model. Split: FreeCut = visual/timeline/caption
  editing; Cvideo keeps scene-VO reel assembly. Don't force our reel logic into FreeCut.
- Vendored fork: `editor/` carries FreeCut's own `CLAUDE.md` + `.claude/skills` (harmless).

## Done so far
- Vendored at upstream `db6edeb` (2026-07-01); `.gitignore` excludes `editor/node_modules`,
  `dist`, `.vite`, `headless/output`.
- Recolor: `editor/src/index.css` (primary/ring/sidebar) + `editor/src/features/timeline/theme.css`
  (playhead) → purple.
- `.claude/launch.json` has an `editor` config (`npm run dev --prefix editor`, `--base=/editor/`).
- Headless render+edit engine proven (`node headless/test.mjs` — all checks pass).
- Same-origin embed: `editor/src/app.tsx` router basepath follows `BASE_URL`;
  `frontend/vite.config.ts` proxies `/editor` → FreeCut's dev server + sets isolation headers;
  `backend/app/main.py` adds `Cross-Origin-Resource-Policy: cross-origin`; `Sidebar.tsx` +
  `App.tsx` add an **Editor** nav item rendering FreeCut in an iframe at `/editor/`.

## Open UX gap (flagged by Dennis, not yet fixed)
The Editor tab currently feels bolted-on — it drops into FreeCut's raw workspace picker
instead of the video you were just working on. Fix is Phase 2b above: first-run folder setup
+ auto-open into the editor with scenes loaded when you "make a video," rather than a
separate tab you have to navigate to and re-pick a workspace in.
