# 00 · THE MAP
*Read this first. The whole engine on one page. Everything else is one file per funnel stage.*

**One machine, swappable brands.** The mechanics never change — the funnel, the loop, the laws. Each brand is a **cartridge** (`BRANDS.md`): its voice, pillars, magnet, offer, CTA. **NoCrapDiet is the only cartridge loaded.** SemSeo, Missedyu, and Real Dennis sit dormant in `BRANDS.md` — config kept, machinery off. Don't run their sprints; don't write their content unless Dennis asks.

---

## THE FUNNEL — the order a stranger moves through

A person doesn't go from scroll to sale in one jump. They walk five steps. Each step is one file.

| # | Stage | The job | File |
|---|-------|---------|------|
| 1 | **STOP** | get found / stop the scroll | `01-STOP.md` |
| 2 | **HOLD** | keep them watching | `02-HOLD.md` |
| 3 | **TRUST** | become the go-to they believe | `03-TRUST.md` |
| 4 | **CAPTURE** | own them (email), don't rent them (follow) | `04-CAPTURE.md` |
| 5 | **SELL** | turn reach into revenue | `05-SELL.md` |

**NoCrapDiet's closed path, end to end:** reel → one CTA line → nocrapdiet.com → email gate → free swap guide → nurture → Weight Loss 30 Day Challenge. Every post feeds this path. A viral video into an empty funnel is a dopamine hit, not a business.

### Every post gets a job — the `journey_stage` tag
The job is about the post's **substance**, not its CTA (every post carries one site-driving CTA line — see below):
- **attention** — the shock/discovery piece (STOP/HOLD do the work). Most reels.
- **authority** — delivers a usable win (a real how-to, a label-reading skill, a swap that saves money).
- **invitation** — the magnet/offer IS the content ("I put all 27 fake-health foods in one free guide — here's 3 of them").

**Batch ratio per 10 posts: 5 attention · 4 authority · 1 invitation.** The two ways to break it: all-attention (a crowd that never trusts) or too-much-invitation (you burn the audience pitching).

### The CTA doctrine (one rule, no exceptions)
**Every reel ends with exactly ONE ask, and the destination is always nocrapdiet.com** — the free guide, zero friction, lean on "free." Rotate the *mechanism* per post so it never goes stale: comment SWAP · DM SWAP · link in bio · say the site. Follow/save is a secondary line at most. Full spec: `scripts/RULES.md` + `04-CAPTURE.md`. The ask stays one line, under 5 seconds on screen (`04-CAPTURE.md` CTA discipline).

---

## THE LOOP — how a piece of content gets made (the live, film-first loop)

```
PICK → FILM → SCRIPT (voiceover) → EDIT/POST → LOG → MEASURE
  ▲                                                     │
  └───────────── MEASURE feeds the next PICK ───────────┘
```

1. **PICK** — Claude 360-maps + shock-scores angles, returns a film brief (product + verified numbers + shot list) in the winning costume format. (`RUN.md`)
2. **FILM** — Dennis batch-films ~6–10 reels on one grocery run.
3. **SCRIPT** — Claude writes voiceover to the footage, exact `scripts/RULES.md` format, one beat per clip.
4. **EDIT/POST** — Dennis pulls the script into cvideo (his production + metrics workspace), voiceovers, edits, posts ~3/day.
5. **LOG** — automatic: cvideo captures each post's performance and pushes it to the **tracker Google Sheet**.
6. **MEASURE** — Sunday: Claude reads the Sheet, ranks by Score, banks winners in the Growth Log (`BRANDS.md`), prunes two-time flops, one craft note. (`RUN.md`)

The loop is closed: MEASURE feeds the next PICK, so the engine learns every week instead of starting cold.

---

## THE 3 GATES — every piece clears these before it earns effort

1. **The Goal Filter.** Does it move a goal (below)? If not, it waits.
2. **The 8 Laws.** The non-negotiable mechanics (below).
3. **The Cartridge.** `journey_stage` + voice + pillars + CTA load from `BRANDS.md`.

## THE GOALS
1. $100K revenue · Apr–Oct 2026 — the content engine's lane: grow NoCrapDiet's list → launch the Weight Loss 30 Day Challenge to it.
2. Faster content workflow — the engine itself needs less of Dennis every week.

(SemSeo's first paid sale runs on Dad's ads + direct sales, not this engine, until its cartridge reactivates.)

---

## THE 8 LAWS
*Proven mechanics (Nikita Bier + Mike Yanda). Brand-agnostic — every cartridge inherits these.*

1. **3-second value** — the hook lands in the first 2–3 seconds or they're gone. (→ `01-STOP.md`)
2. **Latent demand** — find the janky workaround people already do, then remove the friction. Best content angle *and* best product idea both live here.
3. **100% on the test** — nail the one thing you're validating (usually the hook), half-ass the rest.
4. **The signal is binary** — a post that does 10× your usual isn't luck. Make ten more of that exact format. (→ `RUN.md` measure)
5. **Marketing = product** — the reel, the site, and the guide must all point at the same person. Misalignment kills the flywheel.
6. **Do right by users** — above-board growth only; shady tactics come back worse.
7. **Be categorizable** — the algorithm can't push you until it knows your bucket. Hammer 3–4 fixed pillars until you're bored; the audience seeing them is always new. **IG embeds your whole account into one topic** (staying in-pillar isn't optional there); **TikTok categorizes per video** (test off-pillar there without poisoning the account). (→ `03-TRUST.md`)
8. **The content is the targeting** — make content for your *buyer* (people who think they're eating healthy and aren't), not max views. 2k views from real health-halo shoppers beats 50k from randoms. (→ `03-TRUST.md`)

---

## THE SCOREBOARD — one board, no copies
The scoreboard is the **tracker Google Sheet**: cvideo captures post performance and pushes it there; Claude reads it every Sunday for MEASURE. There is no second board — the old local `content-performance-tracker.xlsx` is retired to `_archive/` (its Score/Verdict logic is documented in `RUN.md` MEASURE). Fields per post:

`post_id · date · platform · journey_stage · hook · hook_trigger · angle · views · follows · saves · sends` → **Score** = value-actions per 1,000 views (sends & follows ×2, saves ×1; <200 views = "low data") → **Verdict** = winner / ok / flop.

`angle` is the keystone — it's what MEASURE groups by to tell you what to film next. Once the email gate is live, **emails/week becomes the top-line metric** and the Sheet gains an `emails` column (`04-CAPTURE.md`).

---

## THE 3 FAILURE MODES — what actually breaks this engine

1. **Automating judgment.** The hook and the angle-pick stay human forever. Auto-generated, auto-posted hooks are the slop the algorithm hunts. Automate everything *around* those two.
2. **"Only record winners" → "record less."** The engine makes each shot near-free so you take *more* proven shots. Filming 3 instead of 10 because you're waiting for certainty means the system failed at its one job.
3. **Polishing the OS instead of filming.** The engine's output is posted reels and captured emails, not better docs. If a week's "engine work" didn't change what got filmed or posted, it was procrastination wearing a system costume. New inputs only get banked if they *replace* something weaker (CLAUDE.md Prime Directive).

---

## MODULE INDEX — where everything lives

| You want… | File |
|-----------|------|
| The overview, loop, laws, goals, scoreboard | `00-MAP.md` (this) |
| Hooks — stop the scroll | `01-STOP.md` |
| Retention — keep them watching (the dopamine ladder) | `02-HOLD.md` |
| Authority, SPCL influence, pillar discipline | `03-TRUST.md` |
| Email capture — the guide + gate + Stories | `04-CAPTURE.md` |
| The offer — the 30-Day Challenge path | `05-SELL.md` |
| Per-brand config + the Growth Log (the memory) | `BRANDS.md` |
| The live loop, prompts, measure thresholds | `RUN.md` |
| **Canonical script format (overrides all)** | `scripts/RULES.md` |
| The YouTube long-form engine (dormant until first LF) | `LONGFORM.md` |
| The scoreboard | the tracker Google Sheet (fed by cvideo) |

---

## HOW THIS ENGINE GROWS — the rule for adding anything
*Default: improve the existing file for that part. New files are rare.*

1. **New tactic for an existing stage** → improve that stage's file. **Do not create a new file.**
2. **Brand-specific** (pillar, voice, magnet, offer, CTA) → `BRANDS.md`, under that brand.
3. **A new step or prompt** → `RUN.md` (short-form) or `LONGFORM.md`.
4. **A performance result** → a Growth Log line in `BRANDS.md`, not new prose.

**Guardrails:** one fact, one home (sharpen + cross-reference, never restate) · map before you add (a new framework is ~80% things you already have) · archive to `_archive/` before big rewrites · **and the Prime Directive: if it doesn't change what ships this week, it waits.**
