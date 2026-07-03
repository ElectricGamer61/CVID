# LONGFORM · the YouTube engine
*Kept separate on purpose — same DNA as short-form, different mechanics. Brand leans live in `BRANDS.md`; this holds the universal long-form prompts + rules.*

**STATUS: DORMANT.** Unlocks when the email gate is live and shorts are converting (first ~100 emails), or when Dennis decides he wants the YouTube asset. Until then, don't build for it. First video = a SEARCH play ("is [health-halo food] actually healthy") — it compounds for years and mines into shorts.

**Lane B — long-form → shorts (the payoff):** once a long-form exists, it's the cheapest shorts source there is. Transcribe (ElevenLabs) → mine 12–15 clippable moments (timestamps + angle + hook each, `01-STOP.md` rules) → clip vertical, no watermark → each clip enters the normal RUN.md flow at the voiceover/hook step. One recording = a week+ of content.

Same console-and-cartridge logic: universal prompts you run for any brand, fed a cartridge. **Three console prompts, in order per video:**
1. **Packaging Extractor** → what concept/title/thumbnail pattern wins in the niche (run before you've published; refresh ~monthly)
2. **Script Factory** → the actual video script, retention built in (per video)
3. **Thumbnail Factory** → the click lever (per video, a module not the whole engine)

On YouTube, **packaging (title + concept + thumbnail) decides the click before the video matters.**

---

## DECIDE THE JOB FIRST — SEARCH vs BROWSE
*Pick this before you package. The same topic gets built differently depending on the job. Most creators skip this and wonder why a good video died.*

- **SEARCH video** — people are *looking* for it. Win = showing up in results over time (slow burn, compounds for years). Title = the exact phrase they'd type ("healthy granola that's actually junk"). Packaging is **clarity, not curiosity**. Evergreen. Most of NoCrapDiet + SemSeo ("is X healthy", "why isn't my site ranking").
- **BROWSE video** — the homepage / suggested feed *pushes* it. Win = a curiosity-gap thumbnail + title that stops a scroll cold. Most of Real Dennis — nobody searches the PR-house bet; the algorithm has to *offer* it.

A search title written for browse (too curiosity-baity) never ranks; a browse title written for search (too literal) never gets clicked. **Tag every video SEARCH or BROWSE before the Extractor runs.**

**SEO layer (search videos only):** title carries the search phrase · description front-loads the same phrase + what they'll get · a few real tags · CTA link in description **and** pinned comment. Don't over-engineer — modern YouTube SEO is mostly "say the thing people search, clearly."

---

## CONSOLE — THE 3 PROMPTS

### 1 · Packaging Extractor
*The most important prompt in the engine. Run once per brand-niche, refresh ~monthly.*
```
You are a YouTube packaging analyst.
INPUT: [3–5 channels in this brand's niche actively GROWING (~<500k subs),
plus the brand's main search terms]
TASK: Find the 10 biggest OUTLIERS (views ÷ subscriber baseline, not raw
views). For YouTube look back 1–2 years, not 3 months — long-form packaging
ages slowly. For each, log:
- The TITLE (exact words) + the curiosity/stakes mechanism it uses
- The CONCEPT in one line (the promise)
- The THUMBNAIL move (face/no-face, text words, focal subject, contrast)
- SEARCH or BROWSE win (search phrase in title vs curiosity gap)
- Why it overperformed its channel
OUTPUT: a ranked pattern library — the 3–4 packaging moves that repeat.
Flag the ONE title structure and ONE thumbnail move that show up most.
These become the brand's defaults.
```
> **Steal 80/20** — ~80% model proven winners, ~20% your experiment; borrow the title *structure*, never the whole video. **Study growers, not the established** — channels still climbing run the moves you can copy.

### 2 · Script Factory
*Run per video. Retention is the whole game — every beat earns the next.*
```
You are my [BRAND] long-form scriptwriter.
CARTRIDGE: [paste from BRANDS.md]
PACKAGING: [paste the winning title + concept from the Extractor]
VIDEO TOPIC: [topic]
STRUCTURE:
- INTRO (0–~90s, 5 beats): CONTEXT (confirm the title's topic immediately)
  → RELEVANCE/STAKES (why it maps to what they're trying to solve) →
  CONTRAST (the gap between what they believe and your new take) → PROOF
  (one concrete, ideally atypical result so they trust it) → PLAN (the
  list/framework the video walks). No "hey guys," no slow build.
- SPEED TO LIST: hit the FIRST real value point by ~55s. If the first
  payoff lands later, most viewers bounce.
- BODY: 3–5 beats, each OPENS A LOOP before closing the last (retention
  spine = Dopamine rungs 2–4, 02-HOLD.md). Order by the 2-1-3 rule: lead
  with your SECOND-best point, drop your BEST point second — perceived
  value should feel like it's *climbing*, so they stay for the trend.
  Race to deliver TWO non-obvious hits early ("one nugget is a fluke,
  two is a pattern" — that's when they trust you for the whole video).
- WALK-AWAY VALUE: every point must be tactically implementable on their
  own — if they can't apply it without you, retention drops.
- PAYOFF: deliver the exact thing the title promised. Don't withhold.
- CTA: native embed only (see "The First 2 Minutes") — [from cartridge]
Write in the brand's voice. Mark where B-roll / on-screen text should hit.
```

### 3 · Thumbnail Factory (module)
*Run per video, after packaging. On-thumbnail text is a first-frame hook — max 4 words; all the leverage lives there.*
> **Rule: the thumbnail can't echo the title.** Title + thumbnail are one combined punch with two jobs — together they give complete context AND make the viewer feel what they lose by skipping. Thumbnail shows the stakes/result; title sets up the question. If the thumbnail text restates the title, it's a dead slot. *(Same law as the short-form text-vs-spoken hook, `01-STOP.md`.)*
```
You are my [BRAND] thumbnail generator.
CARTRIDGE: [paste from BRANDS.md]
PATTERN: [paste the winning thumbnail move from the Extractor]
VIDEO TOPIC: [topic]
TASK: Generate 3 thumbnail concepts. For each:
- The visual, described shot-by-shot, ready to build/shoot
- The on-thumbnail text — max 4 words, treat it like a first-frame hook
- Which winning pattern it borrows and why it fits this topic
```

---

## THE FIRST 2 MINUTES — where the video is won or lost
The intro is beachfront property; the end is rural farmland. Spend effort accordingly.

**Effort allocation.** Put 50%+ of your work time on idea + title + thumbnail + the first 2 minutes. And write/record the intro when you're *warm and in flow*, not first and cold (most people draft the intro at their worst). Brain-dump the body outline to warm up, then go hammer the intro.

**The trust ladder (first ~3 min).** A new viewer is skeptical; you climb four trust moments:

1. **Crowd verification** — subs/views vouch for you (you won't have this early; it just loads more pressure onto 2–4).
2. **Proof signaling** — state a real, ideally atypical result in the intro.
3. **First dopamine hit (~60s)** — race to one non-obvious insight fast.
4. **Second dopamine hit** — a second nugget proves it's a *pattern*, not a fluke. Now they're locked for the whole video.

**CTAs = native embeds only.** The goal is to drop the viewer into hypnosis and never break it — a random or disconnected ad/CTA snaps them out. Ramp from the exact topic instead ("want the template of that framework? link below"): a smooth, non-breaking value ramp into your buyer-activation flow (`04-CAPTURE.md`). And never ask for the subscribe in the first 60s — asking before you've given tanks conversion; earn it and they subscribe on their own.

**Forever loop.** End every video with a literal "watch this next" + the clickable end card to another video in your catalog. Turns disconnected videos into a series and chains the binge (the long-form twin of `RUN.md` connective tissue).

---

## DISTRIBUTION — where long-form connects
- **Every long-form is a short-form mine.** Shoot once; cut the best beats into Shorts/Reels/TikToks (`RUN.md` Lane B). Frame yourself centered so wide footage crops clean to vertical. The long-form shoot *feeds* the short-form sprint — not separate production runs.
- **TikTok/Shorts → long-form pairs; IG → doesn't.** Short-form viewers on TikTok and YouTube Shorts *will* click through to a long video; IG audiences mostly won't leave the app. So route long-form CTAs through TikTok/Shorts, not Reels.
- **Reality: slow, then compounding.** Long-form is the slowest channel to move and the best to monetize — a video can climb for months off search. Don't judge it in days; judge the channel over a quarter. The thing that keeps you consistent long enough to compound is shooting formats you actually like.
- **Why long-form converts: trust per minute.** A short-form follow is shallow — 30–60 seconds gives few points to build trust, and short-form followers follow everyone and mute the noise. A 10–30 min video is the opposite: every minute is another reinforcement point, so a viewer who gives you that time trusts you far more. That's why 100k YouTube views can drive more real, convertible followers than 10M on a Reel. **Short-form wins reach; long-form wins the trust that turns viewers into buyers.** Use shorts to get discovered, long-form to deepen — they're two jobs, not a ranking.

---

## YOUTUBE CHANNEL ARCHITECTURE — control the path, not just the video
Individual videos get discovered; the *channel structure* decides whether one view becomes a binge and a captured email. Three levers most creators ignore:

- **Playlists = viewer pathways.** When someone opens a playlist, YouTube auto-plays the next video in *your* order — so you control the sequence instead of leaving the next view to a random suggestion. Build a "start here" playlist + a themed progression (for you: "sneakiest fake-health foods" → "what to actually buy" → "the $3 swaps"). It's the forever loop scaled up — you sequence a whole binge, not just point to one next video.
- **Use all three mediums (shorts + long-form + live).** YouTube pushes channels that post shorts, long-form, AND live streams harder than single-medium channels — and a live clips back into more shorts. Even an occasional live (a "flip the box with me" Q&A) compounds reach across the whole account.
- **Flywheel every video to one capture video.** End-screen and CTA every long-form back to a single evergreen "here's the free swap cheat-sheet" video (or straight to the magnet). Long-form collects views for *years*, so this compounds: every new upload sends a growing, permanent stream of traffic to the one place that captures the email (`04-CAPTURE.md`). One core capture video, everything points at it.

---

## IMPROVEMENT LOOP
1. Ship the video.
2. Log the real numbers: **CTR** (packaging worked?) + **average view duration / retention** (script worked?). Note SEARCH vs BROWSE — a search video with weak day-1 CTR may still be climbing in results weeks later, so don't kill it on early numbers the way you would a browse video.
3. After ~5 videos, the winning title structure + thumbnail move become defaults; the Extractor only re-runs to find *new* moves.
4. Verification = CTR + retention, both real numbers. Don't loop on "does this feel good."

## GROWTH LOG
| Date | Brand | Video topic | Title used | Thumbnail pattern | CTR | Avg view duration | Keep / kill |
|------|-------|-------------|-----------|-------------------|-----|-------------------|-------------|
|      |       |             |           |                   |     |                   |             |
