# Cvideo — Project Goal

`/goal` prompt for building **Cvideo**, my own free, local, open-source clone of wayin.ai's
*wayinvideo* / OpusClip, for turning my long-form YouTube videos into vertical shorts.
It's mine, runs on my PC, no subscription. Paste the block below to kick off the build.

---

```
/goal Build "Cvideo" — my own free, local, open-source clone of wayinvideo/OpusClip for turning my long-form YouTube videos into vertical shorts. It's mine, runs on my PC, no subscription.

## What it does (same flow as OpusClip & wayinvideo)
Paste a long-form YouTube link or drop a local file → auto-analyze (transcribe + AI "brain") → get a grid of suggested clips, each with a virality score, title, and time range → open a clip in the editor (preview, trim, transcript, captions, reframe) → export a ready-to-post vertical short. Same muscle memory as Opus/wayin, zero subscription. Clips come out export-ready but fully editable first.

## Locked decisions (do not re-ask)
- Form factor: LOCAL WEB APP — Python (FastAPI) backend + React/Vite/TypeScript browser editor at localhost.
- Input: BOTH — paste a YouTube URL (yt-dlp) OR drag in a local .mp4.
- Build style: working MVP end-to-end FIRST, then layer polish.
- AI brain: SWITCHABLE — local Ollama (default, offline) AND cloud Gemini (free tier), behind a pluggable ScorerBackend interface.
- Output: auto clips, fully editable before export (trim, fix transcript words, caption style, reframe nudge).

## Vertical conversion (hard requirement)
Every exported clip is 9:16 vertical (1080×1920) by default, with aspect presets (9:16, 1:1, 4:5, original). MVP = smart center/active-speaker crop; Phase B = smooth subject/face tracking so the speaker stays framed. Non-negotiable — the whole point is 16:9 long-form → vertical short.

## TikTok-style captions (hard requirement)
Switchable, real presets rendered via ffmpeg ASS so they burn in cleanly:
- TikTok/CapCut classic: big bold white, heavy black outline, word-by-word pop-in, active word highlighted (karaoke).
- Hormozi/Opus: chunky uppercase, per-word color highlight, slight bounce.
- Beasty: large centered, current-word color swap, drop shadow.
- Clean/minimal: lower-third, subtle background bar.
Each preset exposes font, size, color, highlight color, outline, position (top/mid/bottom), and max words-per-line. Live preview in the editor; burned output matches the preview.

## My hardware + the ONE gotcha (already researched — don't redo it)
RTX 5070 (Blackwell, sm_120), Ryzen 9700X, 32GB RAM, Windows 11.
- PyTorch: stable wheels don't ship sm_120 — install PyTorch NIGHTLY cu128, NOT default `pip install torch`. Verify torch.cuda.is_available() is True on the 5070.
- Transcription: WhisperX (word-level) is primary, but CTranslate2 is the shakiest Blackwell link — bake in a whisper.cpp CUDA fallback from the start. Both write a common words.json.

## Stack
FastAPI + Uvicorn + SQLite (SQLModel) backend; React+Vite+TS+Tailwind frontend; system ffmpeg/ffprobe for all cut/crop/caption-burn; yt-dlp ingest; WhisperX (+whisper.cpp fallback) transcription; Ollama (qwen2.5:7b) + Gemini brains; OpenCV for 9:16 reframe; ffmpeg ASS subtitles (karaoke \k tags) for animated captions.

## Pipeline modules (backend/app/pipeline/)
ingest.py (yt-dlp/upload) → transcribe.py (words.json) → brain.py (ScorerBackend: Ollama + Gemini, returns ranked moments w/ start/end/title/score) → reframe.py (9:16 crop) → captions.py (word-level styled .ass) → render.py (ffmpeg cut+crop+burn → clip.mp4). jobs.py runs long jobs in the background with progress to the UI.

## Phases
- Phase 0 (FIRST): env setup — ffmpeg, venv, PyTorch nightly cu128, WhisperX smoke test (fall back to whisper.cpp if CTranslate2 errors on sm_120), Ollama + model pull, Gemini key in .env. Document the working path in README. Confirm GPU + transcription works BEFORE building on it.
- Phase A (MVP): URL/file → transcribe → ONE brain (Ollama) → smart center-crop 9:16 → basic word captions → export, with a minimal editor (clip grid + scores, trim, Export).
- Phase B (editor): real trim timeline w/ live preview; transcript editing that re-burns captions; the 4 caption-style presets above; subject/face-tracking reframe + manual nudge.
- Phase C (polish): add GeminiScorer + per-project brain toggle; better moment selection (hook detection, 20–60s targets, dedupe overlaps); batch export, thumbnails, project management.

## Reuse, don't reinvent
WhisperX for alignment, yt-dlp for downloads, ffmpeg ASS for animated captions, Ollama REST for the local brain, OpenCV built-in detectors for reframe.

## Top-tier acceptance criteria (measure against wayin, don't guess)
1. Captions word-synced within ~80ms, readable, animated, no overlap/cutoff.
2. On a 10-min real video, the brain's top 5 moments include ≥3 I'd actually post (tune the brain on my real footage until this holds).
3. Reframe keeps the speaker's face in-frame with no visible jitter across a 30–60s clip.
4. Full run (10-min source → ranked clips) completes in minutes on the 5070.
5. Every auto-clip is editable (trim, transcript fix, caption style, reframe nudge) before export.

Project root: C:\Users\Dennis\Documents\VsCode\Cvideo. Start with Phase 0, confirm the GPU/transcription path works before building on it, then proceed through phases.
```
