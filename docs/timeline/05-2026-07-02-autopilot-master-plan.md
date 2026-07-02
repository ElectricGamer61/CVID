# Session — 2026-07-02: Autopilot master plan + create-a-reel flow redesign

Branch: `session/handoff-and-record-trim-fix`. Two deliverables: the **Autopilot master plan**
(docs) and a **full-page redesign of the create-a-reel flow** (code, verified live).

## 1. Autopilot master plan — written & locked

Full doc: [../autopilot/master-plan.md](../autopilot/master-plan.md) (supersedes the "parked
ideas" status of `content-engine.md`). Decisions locked with Dennis this session:

1. **Editor first, Autopilot planned now** — the editor phases in
   [04-2026-07-02-next-steps.md](04-2026-07-02-next-steps.md) remain the immediate build;
   Autopilot phases A–D start after editor Phase 4.
2. **Both content paths from day one** — one path-agnostic orchestrator; native tickets pause
   at an `awaiting_footage` ("film these scenes") gate.
3. **Me first, sellable-shaped** — brands become data cartridges (`backend/brands/*.json`),
   zero hardcoding, so a future wedge customer = one cartridge file.
4. **Upload-Post is the publishing layer** — go live with the existing `poster.py` wiring;
   Postiz stays a future swap behind the same interface.

Architecture (6 components): brand cartridges · orchestrator tick loop (`jobs.py` pattern,
state on the Ticket row) · approval-queue screen with an autonomy dial · ideation engine
(hook library + topic rotation + outlier spin) · fail-closed quality gates · per-brand
learning-loop deepening. Build phases A–D, one per session.

## 2. Create-a-reel flow redesigned (shipped this session)

**Problem:** the whole journey lived in a 620px modal + 560px right drawer — cramped, and the
flow had a broken seam (create → dumped back on the board → find your own card → click it).

**Fix:**
- `NewTicketModal` slimmed to 3 choices (topic, brand, how) + two CTAs: **✨ Write it with AI**
  / **Start writing myself**. The paste-script textarea moved to the workspace empty state
  (`ReimportBox`). On create you land **directly in the workspace** — no bounce.
- New full-page **`VideoWorkspace`** (route `{name:"video", tid}`) replaces the `TicketDetail`
  drawer: header band (big hook input + angle + brand chip + capture-mode select), clickable
  4-step **stage stepper**, scenes in a roomy main column (spoken full-width, detail fields in
  a 3-col grid), and a **sticky right rail** with the AI writer panel (hook suggestions render
  there) and the Make-the-video panel (editor / assemble / result + save).
- Board cards route to the workspace; back-from-editor returns to the workspace
  (`from:"video"`). Drawer CSS removed; `backend` server added to `.claude/launch.json`.

**Files:** `frontend/src/App.tsx`, `frontend/src/index.css`, `.claude/launch.json`.

**Verified live** (preview MCP, DOM reads — screenshots hang on this machine): build 0 TS
errors; card → workspace renders (830px main + 340px sticky rail at 1440px); scene edit
persists via PATCH; stepper click moves stage (board lane agrees); new-video → lands in
workspace with empty-state paste box; test ticket deleted; console/network/backend logs clean.

## Next
1. **Editor Phase 1** (shelve FreeCut, restore old editor) per
   [04-2026-07-02-next-steps.md](04-2026-07-02-next-steps.md) — unchanged.
2. Editor Phases 2–4, then **Autopilot Phase A** (cartridges + one real Upload-Post post).
