# RUN · the live loop
*The click-by-click. `00-MAP.md` is the strategy; this is the operation. Script output format is owned by `scripts/RULES.md` — that file wins every conflict. Folder boundary: writing outputs → `scripts/`; cvideo = production + metrics only.*

```
PICK → FILM → SCRIPT (voiceover) → EDIT/POST → LOG → MEASURE
  ▲                                                    │
  └──────────── MEASURE feeds the next PICK ───────────┘
```

**The cadence that's already working:** one grocery-run film batch (~6–10 reels) per week · Claude writes voiceovers to the footage · Dennis posts ~3/day · Sunday = 15-min MEASURE. Total Dennis time: ~2.5 hrs/week. Everything else is Claude's job.

---

## PRODUCTION PRINCIPLES (hold across every batch)

- **Film-first.** The script is a *voiceover written to real footage*, not a pre-shoot script. The film brief tells Dennis what to grab; the footage tells Claude what to write.
- **80/20 steal ratio.** ~80% ride the proven format (costume reframe — the Growth Log winner), ~20% experiment. Experiments mint the next banked format.
- **Study growers, not the already-huge.** Model creators actively growing (<500k). Big accounts coast on brand recognition; growers run the playbook you can copy now.
- **Volume into proven patterns.** The system makes each reel near-free so you ship 10, not 3. Shipping 3 means the engine failed at its one job.
- **The hook stays human.** Claude drafts, Dennis approves with his eyes before posting. Never auto-post a hook.

---

## STEP 1 · PICK — the film brief
*Claude's job. Dennis says "give me food lies" → Claude returns a paste-ready film brief.*

**How the angle gets picked (non-skippable, in this order):**
1. **Target the health halo, not obvious junk** (Law 8). Nobody's shocked Oreos are bad; the win is the food they eat *because they think it's healthy*. That buyer is who the guide and Challenge launch to.
2. **360-map** the product: list every TRUE angle about it.
3. **Shock-score** each: of 100 people, how many would be genuinely shocked? Skip angles that score high but are fear-mongery or legally shaky (e.g. glyphosate) — those can be a later beat, never the hook.
4. **Verify the numbers NOW**, at brief time — real label figures, sourced, with date. If a number can't be verified, the line runs number-free. **No `[X]` ever** (RULES.md rule 1).
5. **Wrap in the winning format** from the Growth Log (currently: "X is Y in a costume") — ride the format, rotate the pillar (`03-TRUST.md`).

### PROMPT — Film Brief Forge
```
You are my NoCrapDiet film-brief writer. Read the whole Content engine
folder first (CLAUDE.md order). Then build a film brief for [N] reels.

For each reel:
- PRODUCT: exact brand + item + which aisle
- COSTUME LINE: the "X is Y in a costume" reframe (or the current
  Growth Log winning format)
- SHOCK SCORE: /100, and the runner-up angle you rejected
- VERIFIED PROOF: the real label numbers, verified via search TODAY,
  with source — or "number-free angle" if unverifiable
- SHOTS: the exact clips to film, in order (aisle → label close-up
  with the damning line readable → aisle/swap). Flag which shot must
  show the number on camera.
- MUTED CHECK: one line — does the label shot alone carry the shock?

Batch rules: all picks in-pillar (swaps · label lies · myth-busting ·
cheap-healthy) · rotate pillars across the batch · 5·4·1 journey mix ·
at least 2 of N are experiments (new format or angle, tagged EXPERIMENT).
```

### Feeding the engine — the capture tax (when Dennis saves an outlier)
Claude can't open IG/TikTok links. Pay 30 seconds at save-time:
```
HOOK: [first on-screen line or first words spoken]
STRUCTURE: [one line — "lie → label read → swap → CTA"]
WHY IT POPPED: [outlier signal — "60k views, creator usually gets 4k"]
CAPTION: [paste]
```
Only feed posts that **beat their creator's normal** (5–10× baseline). Screenshot hook/CTA frames if the magic is visual.

### PROMPT — Format Extractor *(run when 5+ outliers are captured)*
```
You're a short-form content strategist. Below are high-performing posts
from my niche — each far outperformed its creator's baseline.
Ignore topics. Extract mechanics.

POSTS: [paste captures]

Output: 1) the shared HOOK pattern · 2) the beat-by-beat STRUCTURAL
template · 3) the psychological trigger · 4) a reusable SKELETON.
Log each outlier's power phrases (exact 2–3 word punches) and a
per-element score (hook / retention / payoff, 1–5).
If multiple creators: analyze each separately first, then surface only
patterns recurring across 2+ — pooling dilutes to a bland average.
```
A new skeleton that beats the banked one goes in the Growth Log; otherwise discard (Prime Directive).

---

## STEP 2 · FILM — one grocery run, ~6–10 reels
Dennis's checklist per reel (from the brief):
- Film the listed clips in order. Standard pattern: **aisle/grab → label close-up → aisle/swap** (3 clips; add a second label = 4).
- **The label close-up is the money shot:** number/ingredient line readable in frame, finger pointing at it, steady for 2+ seconds. The camera does the proving — no number needs to be spoken if the shot is clean.
- Frame one of clip one has **motion** (grabbing, flipping, walking) — never a static shelf.
- Products with tricky labels: film both the nutrition panel and the ingredient list; Claude picks the damning one at script time.

---

## STEP 3 · SCRIPT — voiceover to the footage
*Claude's job. Output goes in `scripts/`, exact RULES.md format, nothing extra. Never into cvideo.*

### PROMPT — Voiceover Factory
```
You are my NoCrapDiet voiceover writer. Read the whole Content engine
folder first, then scripts/RULES.md — its format is law.

FOOTAGE: [Dennis lists each video's clips in order, + the real label
numbers visible on camera]

For each video, write the script in the EXACT RULES.md structure:
HOOK (one sentence, ≤12 words, sentence case) + one BEAT per clip
(Spoken / On-screen / Caption / Shot / Proof).

NON-SKIPPABLE CHECKS — rewrite until every one passes, then print a
one-line ✓/✗ audit per video at the bottom of the file as a comment:
1. MUTE TEST: on-screen lines alone tell lie → label → swap.
2. RUNG 3 STALL: one beat delays the reveal ("here's the part nobody
   tells you" / "and it gets worse") before the payoff.
3. RUNG 4 NON-OBVIOUS: the payoff can't be guessed from the hook.
   If it can, dig deeper for the real why.
4. BUT/THEREFORE: no two beats joined by "and then" energy; each line
   pulls causally into the next. Jagged rhythm — vary line lengths.
5. ONE IDEA per video. Two swaps taught = none taught.
6. NUMBERS: every figure verified or absent. No [X].
7. TRUST ANCHOR: proof beat (the label) lands by line 2–3, not the end.
8. HOOK LAYERING: spoken HOOK ≠ beat-1 On-screen text.
9. CTA: one line, one mechanism (rotate across the batch), destination
   nocrapdiet.com. Whisperer tone, not town-crier.
```

---

## STEP 4 · EDIT/POST — ~3/day
Voiceover delivery (the few that matter for reading over footage):
- **Downward inflection** on verdict lines — upspeak reads unsure.
- **Half-second breather** after the line that matters; rushing buries it.
- **Believe the line.** If a line reads fake to you, rewrite it before recording — viewers smell it.
- Record line by line, not one ramble take; re-do any flat line.

Posting: TikTok + IG Reels + YouTube Shorts, same clip. One CTA per post. Don't go dark; 1–4/day is plenty. Face-to-camera brands (Real Dennis, future SemSeo): warm up 2 min before the real take, happy-to-be-there energy or don't record.

---

## STEP 5 · LOG — automatic (cvideo → Google Sheet)
cvideo captures each post's performance and pushes it to the **tracker Google Sheet**. Dennis's only job: make sure every posted reel exists in cvideo so nothing ships untracked — an unlogged post can't teach the engine anything.

**Score/Verdict logic (lives in the Sheet; documented here so it's never lost):**
`Score = (saves×1 + follows×2 + sends×2) ÷ views × 1000` — value-actions per 1,000 views, so a small post people act on beats a big one nobody acts on. Under 200 views = "low data" (algorithm still pushing, wait 3–7 days). **Winner ≥ 30 · flop < 8.** When the email gate is live, add an `emails` column and weight it heaviest.

---

## STEP 6 · MEASURE — Sunday, 15 minutes
*Claude reads the tracker Google Sheet (the one scoreboard). Only real results update the engine. After each ~10 posted:*

1. **Read the Sheet** — rank by **Score**, grouped by `angle` and `hook_trigger`. Judge the batch, not one video. Track sends/shares — the breadth lever; design for it ("send this to whoever still buys ___"). Once the email gate is live, emails/week is the top line.
2. **Bank the winner** — one Growth Log line in `BRANDS.md`: `date · pillar · winning hook/format · metric`. It's now a remixable asset.
3. **Prune** — any angle that's flopped twice gets cut. Stop feeding it. (Check it wasn't a trim problem first — a slow reveal isn't a dead angle, see Growth Log LOSER note.)
4. **One craft note** — the single thing to do better next batch. Apply it; don't write a manual.
5. **Load the next batch by multiple:**
   - **Nothing ≥5× batch avg** → something's off (usually hooks). Mine fresh outliers before scaling.
   - **5–10×** → winner. Keep topic + format, change the angle; run 3 of the next 10 as variations.
   - **10×+** → liquid gold. Rerun the *exact* topic + format (fresh hook pass).
   Aim to hold **3 proven topic+format combos** live at once; the rest stays fresh.

**Test like a scientist:** each reel is 5 bricks — format · idea · hook · script · visuals. The experiments in each batch change ONE brick, holding four constant. Change everything and a winner teaches nothing.

### When a real conversion happens (a signup, a Challenge sale)
Ask the converter two questions, in their words: **"What was the first thing of mine you saw?"** (proven top-of-funnel format — make more) and **"What was the last thing you saw before you signed up?"** (the closer — the most valuable content type you have; bank it loud). Log follower→signup duration; when it drops, the middle of the funnel is working. Pushback you hear 3+ times becomes an objection-as-content reel (`01-STOP.md`).

**Invest, don't day-trade:** post, move on, analyze Sundays. Checking views hourly teaches nothing. **Noise to ignore:** posting time · hashtag stacking · 20 posts/day.

---

## WHEN LONG-FORM EXISTS — Lane B
The first YouTube long-form unlocks the cheapest shorts there are: transcribe → mine 12–15 clippable moments with timestamps → hook each → clip. Full flow lives in `LONGFORM.md`. Until a long-form exists, this lane is off — don't build for it.
