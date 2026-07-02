# Architecture — Cvideo is the hub

Cvideo is a general short-form video creation platform that orchestrates the whole workflow end
to end. It is **format-agnostic** (talking-head, faceless, b-roll, clip-based — any kind of
video) with two production paths:
1. **Clipper** — a long video in → find viral moments → clip, reframe (9:16), caption → shorts.
2. **Idea → reel generator** — generate an idea/angle → AI script + hooks → produce a native reel.

It is the **hub**; specialized tools (ffmpeg, the FreeCut editor, Upload-Post, an LLM brain) are
things the hub *calls* — never dependencies woven through the code.

## Stack
| Layer | Tech | Location |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript (single-file `App.tsx`) | `frontend/` |
| Backend | FastAPI + SQLModel/SQLite, ffmpeg render pipeline | `backend/app/` |
| Editor | **Vendored FreeCut** — React 19 + Vite, WebGPU/WebCodecs, headless renderer | `editor/` |
| LLM brain | Local Ollama (free) or Gemini; heuristic fallbacks | `backend/app/ai.py`, `pipeline/brain.py` |

## Backend modules (`backend/app/`)
- `main.py` — the API (projects, clips, tickets, exports, insights, perf, scheduling).
- `db.py` — SQLite models: `Project`, `Clip`, `Ticket`, `Beat`, `Perf`, `Outlier`, `Angle`, `Folder`.
- `ai.py` — **Script Factory + Hook Forge** (content generation).
- `learn.py` — **closed learning loop** (winning hooks/angles/presets from real performance).
- `intake.py` — idea/outlier intake.
- `sheets.py` — one-way push to the Google Sheet (feeds the external learning loop).
- `pipeline/` — `ingest`, `transcribe`, `brain` (moment scoring), `assemble`, `reframe`,
  `captions`, `render` (ffmpeg), `poster` (Upload-Post).

## The workflow (stations)
`Idea → Create (brand + AI script) → Source (ingest + captions) → Edit → Render → Post → Results → learn`

Cvideo owns every station except **Edit** and (for FreeCut projects) **Render**, which the
vendored FreeCut editor handles. See [../editor/freecut-editor.md](../editor/freecut-editor.md).

## Render paths (two, deliberately)
1. **ffmpeg** (`pipeline/render.py`) — authoritative for existing clips/reels; server-side,
   scriptable, voice-first scene re-timing, ASS caption burn-in.
2. **FreeCut headless** (`editor/headless/render.mjs`) — full-fidelity render of FreeCut
   projects via headless Chrome; server-side and batchable, so automation/Autopilot survives.

## Reel identity
A "reel" is a caption-mode `Project` (one `Clip`). Its canonical name is the **project name**
everywhere (`_video_name` in `main.py`) — folder, Results, Downloads, Sheet all agree.

## Brands
Reel brand lives on `Project.brand` (chosen at New-project or on Results). Resolution order:
`Clip.brand → Project.brand → linked Ticket.brand → blank`. Never a silent default.
Brands: NoCrapDiet, SemSeo, Real Dennis, Missedyu.
