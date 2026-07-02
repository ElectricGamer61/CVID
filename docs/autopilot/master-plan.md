# Cvideo Autopilot — Master Plan

> Status: **planned & locked 2026-07-02** (was "parked ideas" in
> [content-engine.md](content-engine.md)). This is the alignment doc for the
> autonomous/agentic content creator. Build order: the editor phases in
> [../timeline/04-2026-07-02-next-steps.md](../timeline/04-2026-07-02-next-steps.md)
> ship first; Autopilot phases A–D start after editor Phase 4.

## The goal

Cvideo evolves from AI-assisted tool → **Service-as-a-Software**: the app itself mines ideas,
writes scripts, assembles reels, schedules, posts, measures, and learns — the human is reduced
to 1-click approvals, then (per brand, once trusted) to nothing but a weekly digest.

## Decisions locked 2026-07-02

1. **Editor first, Autopilot planned now.** This doc aligns all future work; editor phases
   (doc 04) remain the immediate build.
2. **Both content paths from day one.** One path-agnostic orchestrator drives long-form→clips
   AND idea→native-reel; native tickets pause at a "film these scenes" gate.
3. **Me first, sellable-shaped.** Built for Dennis's 4 brands, zero hardcoding — brands are
   data cartridges, so onboarding a wedge customer (e.g. a med spa) later = one cartridge file.
4. **Upload-Post is the publishing layer.** Already wired in `pipeline/poster.py`; needs creds +
   one live test. Postiz stays a future swap behind the same interface.

## What already exists (verified against the code graph)

The full lifecycle chain is code-complete; only the driving layer is missing:
- `create_ticket → ai.script_factory / hook_forge` (already injected with
  `learn.winners_prompt_block`) `→ assemble.build_edit_video / render → schedule_ticket /
  post_ticket` (`poster.py`, real Upload-Post REST, dry-run without creds) `→ log_perf`
  (upsert) `→ learn.winning_patterns`.
- `jobs.py` — proven single-worker background-job pattern (ThreadPoolExecutor, progress on rows).
- `Ticket` state machine (8 stages), `Beat` (script-as-timeline, proof flags), `Outlier`
  (swipe file), `Perf` (video-aware, saves+follows), `Ticket.post_meta`, live Google Sheet bridge.

**The missing piece is exactly one layer**: scheduler/state-machine driver + approval queue +
quality gates + brand cartridges as data.

## Design principles (do not violate)

- **Sellability first** — no AGPL/copyleft at the core; Postiz REST-only if/when added.
- **Automation must survive** — every step runs headless/server-side (ffmpeg authoritative).
- **Honest guardrail** — never pitch "an AI that learns your account" until the loop has real
  data. v1 = "chains your steps unattended, with approval."
- **Saves + follows is the needle metric** (not views/likes).
- **Never a silent brand default**; quality gates fail closed (park with a reason, never post junk).

## Architecture — 6 components

### 1. Brand cartridges — `backend/brands/*.json`
One JSON file per brand (NoCrapDiet, SemSeo, Real Dennis, Missedyu), loaded at runtime:
```
{ name, voice: {system_prompt, tone_rules, banned_phrases}, proof_rules,
  journey_stages: [...], hook_seeds: [...], angle_library: [...],
  cadence: {reels_per_week, preferred_slots, platforms: [tt, ig, yt]},
  caption_preset, autonomy: "off" | "supervised" | "semi" | "hands_off" }
```
- `ai.py` (`script_factory`, `hook_forge`) and `pipeline/brain.py` load the cartridge instead of
  generic prompts; `learn.py` winners become per-brand.
- New `backend/app/cartridge.py`: load/validate/list; `GET/PUT /api/brands/{name}` (a Brand
  settings screen later; file editing is fine for v1).
- The sellability move: onboarding a new customer = writing one cartridge file.

### 2. Autopilot orchestrator — `backend/app/autopilot.py`
A tick loop (background thread, same pattern as `jobs.py`; ~60s interval, on/off via env + API
toggle). Each tick, per enabled brand:
- **Feed**: if scripted-work-in-flight < cadence target, pull the next idea (§4) and create a ticket.
- **Advance**: for each autopilot-owned ticket, run the next stage's action by calling the
  *existing* functions (script_factory → hook_forge → build_edit/assemble → post_meta →
  schedule → post), then advance `Ticket.stage`.
- **Gate**: run quality gates (§5) before human-visible transitions. At approval points set
  `Ticket.gate = "awaiting_approval"` and stop until approved.
- **Native film-gate**: a native-short ticket at `sourced` with missing beat clips sets
  `gate = "awaiting_footage"` — surfaces a shot-list card (per-scene teleprompter text ready).
  Dennis films/uploads via the existing beat-clip upload; the orchestrator resumes automatically.
- New columns (additive `_migrate`): `Ticket.autopilot` (bool), `Ticket.gate` (str|null),
  `Ticket.gate_reason`, `Ticket.attempts_json` (retry log).
- Crash-safe: state lives on the Ticket row; the loop is stateless and resumable.

### 3. Approval queue — the human's entire job (new "Autopilot" screen)
One screen, three card types, 1-click actions:
- **Script approval**: hook + beats preview → Approve / Regenerate-with-note / Kill.
- **Reel approval**: rendered video inline + per-platform captions (post_meta) →
  Approve & schedule / Send to editor (opens the existing editor, resumes on save) / Kill.
- **Footage needed**: shot list per scene with teleprompter text.
Per-brand **autonomy dial** from the cartridge: *supervised* (gate script + reel + post) →
*semi* (gate post only) → *hands-off* (no gates; digest only). Everything starts supervised;
hands-off is earned per brand.
Plus a **digest strip**: "This week Autopilot drafted 6, posted 4, 2 awaiting approval; top
performer: X (saves+follows)."

### 4. Ideation engine (so it never repeats itself) — extends `intake.py`
- **Hook library** (already agreed in handoff 03): seed bank of proven hook formulas →
  AI-expand to ~1000 brand-tagged hooks → injected into `hook_forge` like `winners_prompt_block`.
- **Topic bank**: per-cartridge angle list + rotation state (recently-used tracked on `Angle`),
  so the feeder cycles angles instead of resampling the same idea.
- **Outlier spin**: the swipe file becomes a feeder source — an outlier marked "spin for brand X"
  enters the autopilot queue.
- No scraping; sources are the bank + outliers + learn.py winners.

### 5. Quality gates (machine gates before the human ever looks) — `backend/app/gates.py`
Called at stage transitions; each returns pass | fail(reason):
- **Script gate**: cartridge rules (banned phrases, proof beat present if `proof_rules` demand
  it, duration estimate in bounds) + one LLM self-critique pass (hook score floor).
- **Reel gate**: render succeeded, duration within platform bounds, captions non-empty, audio present.
- **Post gate**: post_meta complete for every target platform; schedule slot valid.
Fail → auto-retry with the failure fed back into the prompt (max 2), then `gate="parked"` with
the reason on the card. Gates fail closed.

### 6. Learning loop deepening — `learn.py`
Already wired v1 (winners → prompts). Deepen:
- **Per-brand + per-journey-stage** `winning_patterns()`.
- **Signal gating**: only count videos past a minimum-signal threshold (the 200-view rule).
- **Close the cadence loop**: day-7 perf-log reminder cards in the queue until metrics
  auto-pull exists; Sheet push stays as-is.
- Cold-start honesty: empty history = heuristics, and the UI says so.

## The two flows, end to end

**Long-form → clips (fully autonomous):** drop a YouTube URL/podcast tagged with a brand →
existing `jobs.py` analyze (transcribe, brain finds moments — already biased by winners) →
orchestrator renders top-N clips (reframe + captions) → reel gate → approval card → approve →
schedule via cadence slots → Upload-Post posts → day-7 perf card → learn.

**Idea → native reel (supervised by nature):** cadence feeder pulls an angle/hook →
script_factory writes beats (cartridge voice + winners) → script gate → script approval card →
`awaiting_footage` shot-list card → Dennis films in the editor → assemble (voice-first timing) →
reel gate → reel approval → schedule → post → measure → learn.

## Build phases (one per session; implement → verify → commit → handoff)

- **Phase A — Cartridges + go live posting.** `backend/brands/*.json` + `cartridge.py`;
  refactor `ai.py`/`brain.py`/`learn.py` to load cartridges (behavior identical when cartridge =
  current defaults); set `UPLOAD_POST_API_KEY`/`UPLOAD_POST_USER`, run **one real post**
  end-to-end. Verify: same script quality with cartridge on; live post visible; Perf logs against it.
- **Phase B — Orchestrator + Autopilot queue (supervised, both paths).** `autopilot.py` tick
  loop + Ticket gate columns + the Autopilot screen with all three card types + film-gate.
  Verify: a URL and an idea both travel to `posted` with every gate stopping where it should;
  kill/regenerate work; restart mid-flight resumes.
- **Phase C — Quality gates + ideation engine.** `gates.py`; hook library seed+expand; topic
  bank rotation; outlier spin feeder. Verify: a rule-violating script auto-retries then parks
  with a visible reason; the feeder produces N distinct ideas without repeats.
- **Phase D — Learning deepening + autonomy dial.** Per-brand/per-stage winners, 200-view
  gating, day-7 perf cards, digest strip, per-brand hands-off flip. Verify: winners block
  differs per brand; a hands-off brand schedules+posts with zero cards (digest only).

## Critical files
- **[NEW]** `backend/brands/*.json`, `backend/app/cartridge.py`, `backend/app/autopilot.py`,
  `backend/app/gates.py`
- **[MODIFY]** `backend/app/ai.py`, `backend/app/pipeline/brain.py`, `backend/app/learn.py`,
  `backend/app/intake.py`, `backend/app/db.py` (`_migrate`: Ticket autopilot/gate cols),
  `backend/app/main.py` (autopilot endpoints, brand CRUD), `backend/app/pipeline/poster.py`
  (creds live), `frontend/src/App.tsx` + `Sidebar.tsx` (Autopilot screen), `frontend/src/api.ts`
- **Reused as-is**: `jobs.py` pattern, `assemble.py`, `render.py`, `sheets.py`,
  Ticket/Beat/Outlier/Perf/Angle models.
