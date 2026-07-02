# Autopilot / in-app content engine — original idea capture

> **Superseded 2026-07-02:** the full plan now lives in [master-plan.md](master-plan.md)
> (architecture, decisions, build phases A–D). This file stays as the original vision capture.
> North-star unchanged: AI-assisted → Service-as-a-Software (Autopilot + the closed learning
> loop = the moat).

## The ask
Cvideo itself creates the ideas, writes the scripts, and runs the whole process **without a
human manually prompting Claude** — while continuously **improving using AI**.

## The reframe
"Without Claude" = without *you* prompting claude.ai each time. The app already calls an LLM
directly (local **Ollama = free**, or Gemini; the **Claude API** could be plugged for quality).
The AI becomes a **service the app calls on a schedule** — you remove the human-in-the-loop,
not the intelligence. Baking the engine into the app (as files/code, not Claude skills) is also
what makes Cvideo **sellable**.

## What already exists (the skeleton)
- `backend/app/ai.py` — **Script Factory + Hook Forge** (LLM script/hook generation, heuristic
  fallbacks).
- `backend/app/learn.py` — **"closed learning loop — the moat"**: reads real performance
  (saves+follows) and surfaces winning hooks/angles/caption styles, fed back into `ai.py`/`brain.py`.
- `backend/app/pipeline/brain.py` — analytical brain (moment scoring).
- **Brand cartridges** — `Ticket.brand` already "loads the cartridge."
- **Perf → Google Sheet** — the performance feed the loop learns from.

## What "my content engine as files inside the app" means
1. **Brand cartridges** (data files per brand): system prompt, voice, do/don't rules, proof
   requirements, journey stages. Move NoCrapDiet's engine out of Claude-skills/your-head into an
   in-app `brands/nocrapdiet.json`-style file the generator loads.
2. **Hook banks + angle libraries** (seed data the generator draws from and AI-expands).
3. **Autonomous orchestrator** (the missing piece): a scheduled job running the whole chain —
   mine idea → write script → assemble reel → schedule/post — with quality gates.
4. **Deeper learning bias**: make `learn.py` per-brand + per journey-stage, gated on real signal
   (the 200-view rule).

## Honest constraints
- **Quality drifts without guardrails** — needs strong cartridges + quality gates (AI-script
  floor, proof beats). Start **supervised** (app drafts the whole reel, you 1-click approve),
  graduate to **hands-off per brand** as trust builds.
- **Learning needs volume** — improves only once enough performance is logged; cold-start =
  heuristics.
- **Cost knob** — Ollama free but weaker; Gemini/Claude API better but per-call.
- **Ideation source** — autonomous ideas need an input (trending/outlier mining or a topic bank)
  or it repeats itself.

## Recommended path (when we pick this up)
1. Encode the **NoCrapDiet cartridge** and wire it into `ai.py` (+ `learn.py` winners).
2. Build **supervised Autopilot**: one action that drafts idea→script→hook→assemble → a
   ready-to-approve reel on the board.
3. Flip a proven brand to **hands-off** (auto-schedule) once the loop pays off.
