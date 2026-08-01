# Cvideo — descriptive overview

## What it is
Cvideo is a **short-form video creation platform** that runs locally and orchestrates the entire
workflow — from raw idea or footage to a published, tracked video. It's **format-agnostic**:
talking-head, faceless, b-roll, clip-based, whatever. Under the hood it's a hub coordinating a
clip engine, an AI script/hook writer, a video editor, a publisher, and a performance-learning loop.

## Two ways to make a video
1. **Clipper** — feed a long video (podcast, stream, talking-head, YouTube link). It transcribes,
   scores the transcript to find viral moments, then clips, reframes to 9:16, and captions them.
2. **Idea → reel generator** — start from an idea/angle. The AI writes the script and hooks; you
   (or the app) assemble the scenes into a native reel.

Both paths share the same downstream engine, so the final format is entirely up to you.

## Screens
- **Ideas** — swipe file of reference videos ("outliers"): hook, structure, why they worked.
- **Projects** — long videos you've ingested, in folders; caption projects collect into **Reels**.
- **Create videos** — a kanban of the content lifecycle; new videos pick a brand/format and paste
  or AI-generate a script.
- **Editor** — trim, cuts, caption editing/styling, multi-clip timeline, per-scene voiceover with
  voice-first re-timing, teleprompter. (Being upgraded to FreeCut.)
- **Schedule** — posting queue to TikTok/IG/YouTube via Upload-Post.
- **Results** — KPIs, momentum trend, per-video/per-platform tracker ranked by **saves + follows**.
- **Downloads** — finished renders; reels in one Reels folder split by brand.

## Production pipeline (backend, ffmpeg)
`ingest → transcribe (ElevenLabs/local) → brain (score moments) → assemble (voice-first timing) →
reframe (9:16) → captions (capcut/hormozi/beasty/clean) → render (ffmpeg → MP4) → poster (publish)`.

## AI brain + learning loop
Calls an LLM directly — local **Ollama** (free) or **Gemini**, heuristic fallbacks. Three roles:
- **Script Factory + Hook Forge** (writes scripts/hooks),
- analytical **brain** (scores moments),
- **closed learning loop** (reads real performance — saves + follows — and surfaces winning hooks/
  angles/caption styles so generation emulates proven winners).

Organized by **brand**, each with its own voice "cartridge": NoCrapDiet, SemSeo, Real Dennis, Missedyu.

## Editor (being upgraded)
Vendored **FreeCut** (MIT, professional browser editor) in `editor/`, recolored to Cvideo purple.
Polished timeline + effects + captions, and a **headless renderer** so FreeCut projects render
server-side and in batch. ffmpeg stays authoritative for existing clips; FreeCut renders FreeCut
projects. See [../editor/freecut-editor.md](../editor/freecut-editor.md).

## Publishing, tracking, learning bridge
Posts via **Upload-Post** (fronts TikTok/IG/YouTube). Per-platform metrics logged on Results
(upsert, no double-count) and pushed one-way to a **Google Sheet** that computes a score and feeds
an external content engine.

## Data model
- **Project** — ingested source video (mode: find-moments or single-caption-reel).
- **Clip** — a cut (trim, cuts, captions, scene markers, voiceovers); a caption-project's clip is a
  **reel**, named by its project everywhere.
- **Ticket** — content-pipeline spine (outlier → scripted → staged → sourced → assembled → ready →
  scheduled → posted).
- **Beat** — script-as-timeline for native content.
- **Outlier / Perf / Angle / Folder** — swipe refs, per-platform performance, angle rollups, organization.

## Status
- **Working:** full pipeline (clip or generate → edit → caption → render → publish → measure →
  learn) across multiple brands; performance loop + Google Sheet bridge live.
- **In progress:** FreeCut vendored, running, recolored, headless render engine proven; next is
  the Cvideo→FreeCut seam + embedding its UI.
- **Parked:** "Autopilot" — the app running the engine autonomously and improving from results.
