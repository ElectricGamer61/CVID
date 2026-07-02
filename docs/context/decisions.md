# Decision log

Newest first. Each entry: the decision, and the *why* (so future-us doesn't relitigate it).

## 2026-07-01 — Business strategy: pursuing the startup path (Game B), wedge = the unlock
Dennis chose to **pressure-test a real startup wedge** rather than keep Cvideo as an internal
service tool (see [../autopilot/content-engine.md](../autopilot/content-engine.md) note below).
Key conclusions from the strategy discussion, so we don't relitigate them:
- **The wedge is the only unlock that matters.** Moat, unit economics, retention, and the
  "why won't CapCut/TikTok just do this" question are all downstream of picking a narrow
  vertical where generic tools ($19 tools, CapCut, OpusClip, Captions.ai) produce output that's
  **actively wrong** — not just mediocre. No wedge = 21st tool on a listicle at $19.
- **Rejected as wedges:** "content creators" (the whole ocean, zero domain rules, zero
  switching cost, CapCut/Captions.ai's exact core, worst retention in the category); "brands
  who film themselves" (still horizontal — that's literally Captions.ai's positioning, who
  raised ~$100M+); one-time payment (kills recurring revenue = kills raisability; also masks
  ongoing per-user compute cost since the engine runs autonomously forever).
- **Real wedge candidates ranked:** (1) **med spas/aesthetics** — generic tools write
  claims ("permanent," "guaranteed," "FDA-approved") that risk FTC/medical-board action;
  visual-native (before/afters), reachable via SemSeo-style local outreach. Top pick. (2)
  **real estate teams** — generic copy risks Fair Housing Act violations; MLS-data →
  listing-to-reel is a real switching-cost moat. (3) **financial advisors/RIAs** — highest ACV
  (FINRA/SEC risk) but slow sales cycle, shelved for a solo founder in school.
- **The test (not yet run):** name one vertical, find 10 real businesses, ask "has your
  generic tool ever written something you had to catch/fix?" Kill criterion: fewer than 3 of
  10 treat it as real pain → wedge is dead, no motivated reasoning.
- **Corrected framing during this discussion:** CapCut is no longer free/cheap (real
  opening, but shared by every competitor, not exclusive); "fully autonomous" is becoming
  table-stakes messaging across the category, not a moat by itself — the learning loop only
  becomes a moat at real data scale (chicken-and-egg problem, openly acknowledged).
- **Standing tension, acknowledged not resolved:** Game B (raise/scale) is in direct conflict
  with the stated goal (**$100K, solo, in school, this quarter**) — a raise is runway, not
  revenue. Dennis chose to test the wedge anyway; this doesn't overrule
  [autopilot/content-engine.md](../autopilot/content-engine.md)'s "Service-as-a-Software" framing,
  it's a parallel bet being pressure-tested before committing further build time.

## 2026-07-01 — Editor: adopt FreeCut, reject Remotion & OpenCut
- **Adopt [FreeCut](https://github.com/walterlow/freecut)** as the polished editor. MIT license
  (safe to sell), React 19 + Vite (near-identical to our stack), and it ships a **headless
  renderer** so server-side/automated rendering survives.
- **Reject Remotion.** Its license forbids selling a derivative *and* needs a paid company
  license at 4+ people — a direct threat to selling Cvideo. It's also a render framework, not
  an editor UI.
- **Reject OpenCut.** Next.js monorepo (awkward graft) and it's mid–ground-up rewrite (unstable).
- **Housing:** vendored **fork in-repo** at `editor/` (own toolchain/deps; source committed,
  `node_modules`/`dist` gitignored). Updates = manual re-pull, not upstream PRs.

## 2026-07-01 — FreeCut embedded same-origin, not iframed cross-origin
FreeCut's workspace picker uses the File System Access API, which browsers **block in
cross-origin iframes**. So "feel like one app" requires serving FreeCut same-origin: proxy
`/editor` through Cvideo's frontend dev server to FreeCut's dev server (FreeCut's TanStack
Router basepath follows Vite's `--base`), and make Cvideo's own document cross-origin-isolated
(`COOP: same-origin` + `COEP: credentialless`) so the iframe's WebGPU/WebCodecs still work.
Backend adds `Cross-Origin-Resource-Policy: cross-origin` so its own thumbnails/API still load
under isolation. Verified header-clean via curl (no COEP conflict between the two documents).

**Open gap (flagged by Dennis):** the Editor tab still feels bolted on — it's a separate nav
item that opens FreeCut's raw workspace picker, not the video you were just working on. Correct
UX: first-run folder pick creates `Cvideo/{projects,media,reels}/` once; "make a video" should
land you directly in the editor with scenes already loaded, not a tab you navigate to
separately. See Phase 2b in [../editor/freecut-editor.md](../editor/freecut-editor.md).

## 2026-07-01 — Seeder is a mapping job, not a schema slog (corrected)
Initially scoped "translate Cvideo's scene model into FreeCut's timeline" as the hard part.
Corrected: FreeCut already ships scene detection, captioning, AND a **proven programmatic edit
API** (`headless/edit.mjs`: `addItem`, `addText`, `split`, `trimStart/End`, `moveItem`,
`addTransition`, driving the real engine headlessly — already passed `headless/test.mjs`).
Cvideo's voice-first per-scene timing is already baked into each rendered scene clip's
duration/audio by the time it reaches FreeCut — nothing to re-derive. So the seeder is: emit an
`ops.json` from Cvideo's scene markers/captions, hand it to `edit.mjs`. Bounded, not open-ended.

## 2026-07-01 — Keep ffmpeg authoritative; FreeCut headless for FreeCut projects
Don't swallow FreeCut's client-side WebCodecs export as the only render path — that would kill
headless/batch rendering (the Autopilot moat). Use FreeCut's headless renderer for FreeCut
projects; keep ffmpeg for everything else. The seam is a **workspace folder** (`project.json` +
`media/`) — file-based, loosely coupled.

## 2026-07-01 — Editor recolor
Swap FreeCut's orange brand accent → **Cvideo purple `#6d5efc`** (`oklch(0.588 0.22 281)`) for
primary, focus ring, sidebar, and timeline playhead. Keep the dark pro-editor look. Clip-type
colors and snap/join indicators stay (functional, not brand).

## 2026-07-01 — Reel identity = project name
One canonical `_video_name`: caption-reel clips are named by their **project**, so the Reels
folder, Results, Downloads, and the Sheet never disagree. Downloads reels group under one
**Reels** folder split into brand subfolders.

## 2026-07-01 — Brand model + one-time backfill
Reel brand persists on `Project.brand`; chosen at New-project or on Results (saves without
needing metrics). `_video_brand` never silently defaults. **One-time** migration backfilled all
existing caption reels to NoCrapDiet (user stated every existing reel is NoCrapDiet); gated on
the column being freshly added so a later-cleared brand isn't re-stamped.

## 2026-07-01 — Google Sheet bridge
One-way Cvideo→Sheet, columns A–M, **no score** (the Sheet computes Score/Verdict). Contract is
a JSON **array**. Fixed the Apps Script to loop the array (was reading a single object). New
webhook URL live in `backend/.env`.

## Standing constraints
- **Sellability first.** No AGPL/copyleft or sell-forbidding licenses at the core (why Postiz is
  REST-only and Remotion is out).
- **Automation must survive.** Any editor/render choice has to keep a headless, server-side path.
