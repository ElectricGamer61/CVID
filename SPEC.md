> # ⚠️ STACK OVERRIDE — READ FIRST
>
> **This project is built with Claude Code in Cvideo's real stack — NOT Lovable, NOT Supabase.**
> The spec below was written assuming Lovable + Supabase. That assumption is **superseded**. The
> table shapes, screens, and P1→P6 phase order all hold; **only the stack/syntax changes.**
>
> | SPEC says (Lovable/Supabase) | Cvideo actually uses |
> |---|---|
> | Supabase Postgres | **SQLite via SQLModel** — tables in `backend/app/db.py` (mirror the additive `_migrate()` pattern) |
> | Supabase Edge Functions (Script/Hook/Signal AI) | **FastAPI routes** in `backend/app/main.py` calling the **existing Ollama/Gemini brain** (`backend/app/pipeline/brain.py`) |
> | Supabase Storage | **Local filesystem** under `data/` (already how clips/proxies are stored) |
> | React frontend | **React + Vite + TS** at `frontend/` (unchanged) — new Board/Intake/Insights live alongside the current Projects/Editor |
>
> **Field-type mapping** when porting the Postgres DDL below to SQLModel: `uuid pk → int pk` ·
> `jsonb → Column(JSON)` · `text[] → JSON list` · `timestamptz → datetime`.
>
> **Hard rule:** no Lovable, no Supabase, no edge functions anywhere in the build. The existing
> `Project`/`Clip` tables and the `backend/app/pipeline/` clip engine are the SPEC's
> **ASSEMBLE / order 6** — they stay as-is; the lifecycle tables sit on top with a `Ticket`
> pointing at a `Project`.
>
> *(Original spec follows verbatim — read it through the override above.)*

---

# CVIDEO — PIPELINE INTEGRATION SPEC
*Wrap the existing clip engine in the full 10-order pipeline so the whole content line lives in one app. Hand each phase to Claude Code / Codex separately — never one massive prompt.*

> **Stack assumption:** Lovable + Supabase (React frontend · Postgres · Storage · Edge Functions). If Cvideo is a different stack, the schema and phase order hold; only syntax changes.

---

## WHAT'S ALREADY HERE vs. WHAT WE'RE ADDING

| | Order | Status |
|--|--|--|
| Mine → Extract → Script → Stage → Source | 1–5 | **new** (intake + AI + tickets) |
| **Assemble (the clip engine)** | 6 | **you have this** — just trigger it from a ticket |
| Hook → Schedule → Post → Measure | 7–10 | **new** (Hook Forge, queue, Signal Reader) |

The integration is the point: your clip engine stops being a standalone tool and becomes one stage inside the lifecycle. That's what "all in one place" buys you.

---

## DATA MODEL (Supabase)

Four tables. The `tickets` table is the spine — everything else hangs off it.

**`tickets`** — one row per piece of content
```
id            uuid pk
brand         text            -- loads the cartridge
stage         text            -- outlier|scripted|staged|sourced|assembled|ready|scheduled|posted
angle         text            -- the keystone field
outlier_id    uuid fk         -- the proof that validated this angle
capture_mode  text            -- asset-assemble|native-short|longform-clip|repurpose
source_ref    text            -- 'LF 02:14' | 'native take 7' | 'b-roll set A'
script        jsonb           -- {hook, beats[], on_screen[], cta}
hook_text     text            -- chosen first-frame hook
clip_url      text            -- output from the clip engine (order 6)
captions      jsonb           -- {tt, ig, yt}
platforms     text[]          -- ['tt','ig','yt']
scheduled_at  timestamptz
posted_at     timestamptz
created_at    timestamptz default now()
```

**`outliers`** — the swipe file (intake at MINE)
```
id uuid pk · url text · hook text · structure text · why_popped text
· caption text · angle text · power_phrases text[] · created_at
```

**`perf`** — one row per platform per posted ticket (MEASURE)
```
id uuid pk · ticket_id fk · platform text · views int · follows int
· saves int · sends int · captured_at
```

**`angles`** — rollup the board reads for Signal Reader
```
angle text pk · outlier_id fk · posts_count int
· avg_score numeric  -- avg(follows+saves) — recomputed on perf insert
```

---

## SCREENS

| Screen | Job |
|--------|-----|
| **Board** | the 10 orders as columns, Lane A/B fork visible at SOURCE; advance/drag tickets |
| **Ticket** | all fields + per-stage action buttons (Run Script · Run Hook Forge · Clip · Schedule · Log perf) |
| **Intake** | paste outliers → swipe file → spin tickets; the MINE screen |
| **Insights** | = **Signal Reader**: KPIs, top performers, angle ranking. The measure brain. |
| **Queue** | calendar of scheduled posts across the 3 platforms |

---

## WHERE EACH ORDER PLUGS IN

- **MINE (1)** — manual paste now → **Scrape Creators API** later (`tiktok/profile/videos`, `instagram/reels`) for auto-outlier pull.
- **SCRIPT (3) · HOOK (7) · MEASURE (10)** — Claude via a **Supabase Edge Function** (key stays server-side). The function loads the cartridge + the relevant prompt (Script Factory · Hook Forge · Signal Reader) from your docs.
- **SOURCE Lane B (5)** — **ElevenLabs** edge function for transcript → moment-mining.
- **ASSEMBLE (6)** — **your existing clip engine.** Triggered from the ticket; writes `clip_url` back. This is the only integration with code you already own.
- **SCHEDULE (8)** — scheduler API (Buffer/Ayrshare). Last and most brittle.

---

## PHASED BUILD ORDER

Each phase ships something usable and is one self-contained Codex prompt. Build the brain before the arms — your own engine and AI before external APIs.

**Phase 1 — Schema + Board.** Create the 4 tables. Build the Board screen: 10 columns, ticket cards, manual stage advance, the Lane A/B fork at SOURCE. *Acceptance: I can add a ticket and move it end-to-end by hand.*

**Phase 2 — Ticket detail + Intake.** Full ticket editor; the Intake screen to paste outliers into the swipe file and spin tickets from them. *Acceptance: paste an outlier, generate a ticket pre-tagged with its angle.*

**Phase 3 — AI buttons (the big jump).** Edge function that calls Claude with a cartridge + a prompt. Wire "Run Script Factory" and "Run Hook Forge" to the ticket. *Acceptance: one click fills `script`; one click returns 3 hooks across 2 categories.*

**Phase 4 — Clip-engine hookup (the integration).** Trigger your existing Cvideo clip engine from a "sourced" ticket; write `clip_url` back on completion. *Acceptance: a ticket goes from sourced → assembled without leaving the app.* **This is the phase that makes it "one place."**

**Phase 5 — Insights = Signal Reader.** Build the Insights screen off the `perf`/`angles` tables: KPIs, top performers by saves+follows, angle ranking. Optional AI summary via the edge function. *Acceptance: after logging 10 perf rows, it ranks my angles.* **This closes order 10 — Signal Reader becomes a real query, not a manual prompt.**

**Phase 6 — External arms.** Wire SCHEDULE (scheduler API), then auto-MINE (Scrape Creators) and Lane-B transcribe (ElevenLabs). Last because platform APIs break. *Acceptance: a ready ticket queues to 3 platforms.*

---

## THE PAYOFF

After Phase 5 the loop closes **inside one app**: MINE feeds the board, AI fills scripts and hooks, your clip engine assembles, Insights ranks the angles, and that ranking seeds the next MINE. Phase 6 just removes the last manual hand-offs. Build 1→5 first; you'll have the entire engine running in Cvideo before you ever touch a brittle external API.
