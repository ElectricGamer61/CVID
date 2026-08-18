"""Cvideo FastAPI app: REST API for the browser editor."""
from __future__ import annotations

import json
import shutil
import tempfile
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import settings
from . import ai, autopilot, cartridge, intake, learn, sheets
from .db import (Angle, Beat, Clip, Folder, IngestClip, Outlier, Perf, Project,
                 Ticket, get_session, init_db)
from .jobs import get_words, start_shootdrop_watcher, submit_analyze, submit_shootdrop
from .pipeline import captions as caps
from .pipeline import ingest, look, reframe, render, shootdrop

app = FastAPI(title="Cvideo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"], allow_headers=["*"],
)


# OPT-IN API auth (lock the doors before any multi-user / public exposure). When
# CVIDEO_API_TOKEN is empty (the default) this is a no-op — solo/local use is unchanged.
# When set, every /api/* call must carry the token (X-API-Token or Bearer). /api/health
# stays open so the frontend's offline banner can probe without it.
@app.middleware("http")
async def _require_api_token(request, call_next):
    token = settings.API_TOKEN
    if token:
        path = request.url.path
        if path.startswith("/api") and path != "/api/health":
            sent = request.headers.get("x-api-token") or ""
            if not sent:
                auth = request.headers.get("authorization") or ""
                if auth.lower().startswith("bearer "):
                    sent = auth[7:]
            if sent != token:
                return JSONResponse({"detail": "invalid or missing API token"}, status_code=401)
    return await call_next(request)

_render_pool = ThreadPoolExecutor(max_workers=2)
# Transient assemble progress per ticket (no schema change needed): id -> {state,stage,error}
_assemble_status: dict[int, dict] = {}


@app.on_event("startup")
def _startup():
    init_db()
    start_shootdrop_watcher()


# --------------------------------------------------------------------------- #
# Brand cartridges (the "who am I posting as" layer — one JSON file per brand)
# --------------------------------------------------------------------------- #
@app.get("/api/brands")
def list_brands():
    return {"brands": cartridge.list_brands()}


@app.get("/api/brands/{name}")
def get_brand(name: str):
    return cartridge.load(name) or {"name": name}


@app.put("/api/brands/{name}")
def put_brand(name: str, body: dict):
    try:
        return cartridge.save(name, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


# --------------------------------------------------------------------------- #
# Autopilot — the autonomous orchestrator (background loop + approval queue)
# --------------------------------------------------------------------------- #
@app.get("/api/autopilot")
def autopilot_status():
    return {**autopilot.status(), "queue": autopilot.queue()}


@app.post("/api/autopilot/start")
def autopilot_start():
    return {"started": autopilot.start(), **autopilot.status()}


@app.post("/api/autopilot/stop")
def autopilot_stop():
    return {"stopped": autopilot.stop(), **autopilot.status()}


@app.post("/api/autopilot/tick")
def autopilot_tick():
    """Advance every autopilot ticket one hop now (manual pump; the loop calls this on a timer)."""
    return {"result": autopilot.tick()}


@app.post("/api/autopilot/tickets/{tid}/toggle")
def autopilot_toggle(tid: int, body: dict):
    try:
        return autopilot.set_autopilot(tid, bool(body.get("on", True)))
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/autopilot/tickets/{tid}/approve")
def autopilot_approve(tid: int):
    try:
        return autopilot.approve(tid)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/autopilot/tickets/{tid}/reject")
def autopilot_reject(tid: int):
    try:
        return autopilot.reject(tid)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/autopilot/tickets/{tid}/regenerate")
def autopilot_regenerate(tid: int, body: dict):
    try:
        return autopilot.regenerate(tid, str(body.get("note", "")))
    except ValueError as e:
        raise HTTPException(404, str(e))


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class CreateProject(BaseModel):
    name: str
    source_url: str
    brain: str = settings.DEFAULT_BRAIN
    transcribe_backend: str = settings.DEFAULT_TRANSCRIBE
    aspect: str = "9:16"
    caption_preset: str = caps.DEFAULT_PRESET
    mode: str = "moments"             # moments | caption
    brand: Optional[str] = None       # reel brand (caption mode); None -> unset


class ClipPatch(BaseModel):
    start: Optional[float] = None
    end: Optional[float] = None
    title: Optional[str] = None
    caption_preset: Optional[str] = None
    aspect: Optional[str] = None
    resolution: Optional[str] = None
    crop_center: Optional[float] = None
    style: Optional[dict] = None  # caption style overrides (stored as style_json)
    words: Optional[list] = None  # edited caption words (stored as words_json)
    cuts: Optional[list] = None   # removed middle ranges [[a,b],...] (stored as cuts_json)
    splits: Optional[list] = None  # split points [t1,...] (stored as splits_json)
    effects: Optional[dict] = None  # {zoom:[...], sfx:[...]} (stored as effects_json)


class CreateTicket(BaseModel):
    brand: str = "NoCrapDiet"
    angle: str = ""
    format: str = "reel"               # reel | carousel
    capture_mode: str = "native-short" # longform-clip | native-short | repurpose
    outlier_id: Optional[int] = None
    source_ref: str = ""
    hook_text: str = ""
    platforms: list = []


class TicketFromScript(CreateTicket):
    script: str = ""                   # pasted script → auto-split into beats
    autopilot: bool = False            # hand the ticket to the orchestrator right away
    auto_voiceover: bool = False       # TTS each scene's spoken line before assembling


class ImportScript(BaseModel):
    script: str                        # pasted script → replaces this ticket's beats


class TicketPatch(BaseModel):
    stage: Optional[str] = None
    brand: Optional[str] = None
    angle: Optional[str] = None
    format: Optional[str] = None
    capture_mode: Optional[str] = None
    source_ref: Optional[str] = None
    hook_text: Optional[str] = None
    clip_url: Optional[str] = None
    project_id: Optional[int] = None
    outlier_id: Optional[int] = None
    platforms: Optional[list] = None
    post_meta: Optional[dict] = None       # per-platform publish copy (hand edits)
    auto_voiceover: Optional[bool] = None  # AI-voice toggle (TTS scenes before assemble)


class BeatPatch(BaseModel):
    spoken_line: Optional[str] = None
    on_screen_text: Optional[str] = None
    caption: Optional[str] = None
    shot_cue: Optional[str] = None
    order_index: Optional[int] = None
    is_proof_beat: Optional[bool] = None   # manual override of the auto proof-flag


class CreateOutlier(BaseModel):
    url: str = ""
    hook: str = ""
    structure: str = ""
    why_popped: str = ""
    caption: str = ""
    angle: str = ""
    power_phrases: list = []


class ReorderBeats(BaseModel):
    ids: list[int]                         # beat ids in the desired order


class AIBrief(BaseModel):
    brief: str = ""                        # optional extra direction for the LLM


class LogPerf(BaseModel):
    video_kind: Optional[str] = None       # "clip" | "reel" (the real exported video)
    video_id: Optional[int] = None         # Clip.id or Ticket.id
    ticket_id: Optional[int] = None        # legacy alias (treated as a reel)
    platform: str = ""                     # tt | ig | yt
    brand: Optional[str] = None            # chosen on the logger; persisted; "" = blank, None = leave as-is
    views: int = 0
    follows: int = 0
    saves: int = 0
    sends: int = 0


class ScheduleTicket(BaseModel):
    scheduled_at: Optional[str] = None     # ISO datetime; None = unschedule
    platforms: Optional[list] = None       # ['tt','ig','yt']
    captions: Optional[dict] = None        # per-platform {tt,ig,yt}


class PostTicket(BaseModel):
    platforms: Optional[list] = None       # default: ticket's platforms or all
    caption: Optional[str] = None          # default: derived from ticket
    scheduled_at: Optional[str] = None     # ISO datetime → schedule for then; None → post now


def _proj_dict(p: Project) -> dict:
    return p.model_dump()


# --------------------------------------------------------------------------- #
# Project routes
# --------------------------------------------------------------------------- #
@app.post("/api/projects")
def create_project(body: CreateProject):
    with get_session() as s:
        proj = Project(name=body.name, source_type="url", source_url=body.source_url,
                        brain=body.brain, transcribe_backend=body.transcribe_backend,
                        aspect=body.aspect, caption_preset=body.caption_preset,
                        mode=body.mode, brand=(body.brand or None), status="created")
        s.add(proj)
        s.commit()
        s.refresh(proj)
        pid = proj.id
    submit_analyze(pid)
    return {"id": pid}


@app.post("/api/projects/upload")
async def create_project_upload(
    name: str = Form(...), brain: str = Form(settings.DEFAULT_BRAIN),
    transcribe_backend: str = Form(settings.DEFAULT_TRANSCRIBE),
    aspect: str = Form("9:16"), caption_preset: str = Form(caps.DEFAULT_PRESET),
    mode: str = Form("moments"), brand: str = Form(""),
    file: UploadFile = File(...),
):
    tmp = Path(tempfile.gettempdir()) / f"cvideo_upload_{file.filename}"
    with tmp.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    with get_session() as s:
        proj = Project(name=name, source_type="file", brain=brain,
                        transcribe_backend=transcribe_backend, aspect=aspect,
                        caption_preset=caption_preset, mode=mode,
                        brand=(brand.strip() or None), status="created")
        s.add(proj)
        s.commit()
        s.refresh(proj)
        pid = proj.id
    submit_analyze(pid, upload_path=str(tmp))
    return {"id": pid}


@app.post("/api/projects/{pid}/retry")
def retry_project(pid: int):
    """Run the analyze pipeline again on a project that errored.

    The failures worth retrying are transient and external — a dropped model download, a
    throttled YouTube fetch — and until now the only way through one was to delete the
    project and re-upload the clip. The media is already in the project dir, so a retry
    resumes from there (a half-downloaded model resumes too) instead of starting over."""
    from sqlmodel import select
    with get_session() as s:
        p = s.get(Project, pid)
        if not p:
            raise HTTPException(404, "project not found")
        if p.status not in ("error", "ready"):
            raise HTTPException(409, f"project is still {p.status}")
        # Clips are re-created by the run; leaving the old ones would duplicate them.
        for c in s.exec(select(Clip).where(Clip.project_id == pid)).all():
            s.delete(c)
        p.status, p.stage, p.progress, p.error = "created", "Retrying", 0, None
        s.add(p)
        s.commit()
    submit_analyze(pid)
    return {"ok": True, "id": pid}


@app.get("/api/projects")
def list_projects():
    with get_session() as s:
        from sqlmodel import select
        rows = s.exec(select(Project).order_by(Project.id.desc())).all()
        return [_proj_dict(p) for p in rows]


@app.get("/api/projects/{pid}")
def get_project(pid: int):
    with get_session() as s:
        from sqlmodel import select
        proj = s.get(Project, pid)
        if not proj:
            raise HTTPException(404, "project not found")
        clips = s.exec(select(Clip).where(Clip.project_id == pid)
                       .order_by(Clip.start)).all()
        return {"project": _proj_dict(proj),
                "clips": [c.model_dump() for c in clips]}


@app.get("/api/projects/{pid}/words")
def project_words(pid: int):
    return {"words": get_words(pid)}


class PatchProject(BaseModel):
    name: Optional[str] = None
    folder: Optional[str] = None       # "" / null -> loose (no folder)


@app.patch("/api/projects/{pid}")
def patch_project(pid: int, body: PatchProject):
    """Rename a project and/or move it into a Home folder (drag-to-move)."""
    with get_session() as s:
        p = s.get(Project, pid)
        if not p:
            raise HTTPException(404, "project not found")
        if body.name is not None:
            p.name = body.name.strip() or p.name
        if body.folder is not None:
            p.folder = body.folder.strip() or None
        s.add(p); s.commit(); s.refresh(p)
        return _proj_dict(p)


# --------------------------------------------------------------------------- #
# Home folders — group project cards on the Home grid. Membership lives on
# Project.folder (by name); a Folder row lets a folder persist while empty.
# The auto "Reels" folder is virtual (derived from mode=caption) — no row.
# --------------------------------------------------------------------------- #
class FolderBody(BaseModel):
    name: str


@app.get("/api/folders")
def list_folders():
    from sqlmodel import select
    with get_session() as s:
        rows = s.exec(select(Folder).order_by(Folder.name)).all()
        return [{"id": f.id, "name": f.name} for f in rows]


@app.post("/api/folders")
def create_folder(body: FolderBody):
    from sqlmodel import select
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "folder name required")
    with get_session() as s:
        existing = s.exec(select(Folder).where(Folder.name == name)).first()
        if existing:
            return {"id": existing.id, "name": existing.name}
        f = Folder(name=name)
        s.add(f); s.commit(); s.refresh(f)
        return {"id": f.id, "name": f.name}


@app.patch("/api/folders/{fid}")
def rename_folder(fid: int, body: FolderBody):
    from sqlmodel import select
    new = body.name.strip()
    if not new:
        raise HTTPException(400, "folder name required")
    with get_session() as s:
        f = s.get(Folder, fid)
        if not f:
            raise HTTPException(404, "folder not found")
        old = f.name
        f.name = new
        for p in s.exec(select(Project).where(Project.folder == old)).all():
            p.folder = new; s.add(p)        # re-tag members so they follow the rename
        s.add(f); s.commit()
        return {"id": f.id, "name": f.name}


@app.delete("/api/folders/{fid}")
def delete_folder(fid: int):
    from sqlmodel import select
    with get_session() as s:
        f = s.get(Folder, fid)
        if not f:
            raise HTTPException(404, "folder not found")
        for p in s.exec(select(Project).where(Project.folder == f.name)).all():
            p.folder = None; s.add(p)       # members fall back to loose / virtual Reels
        s.delete(f); s.commit()
        return {"deleted": fid}


# --------------------------------------------------------------------------- #
# Ticket routes (the content-pipeline spine)
# --------------------------------------------------------------------------- #
_TICKET_FORMATS = {"reel", "carousel"}
_CAPTURE_MODES = {"longform-clip", "native-short", "repurpose"}
# Ordered lifecycle stages = the Board columns (the 10 orders collapse to these states).
STAGES = ["outlier", "scripted", "staged", "sourced", "assembled",
          "ready", "scheduled", "posted"]


def _beats_for(s, tid: int) -> list[Beat]:
    from sqlmodel import select
    return s.exec(select(Beat).where(Beat.ticket_id == tid).order_by(Beat.order_index)).all()


def _replace_beats(s, tid: int, parsed_beats: list[dict]) -> None:
    """Delete a ticket's beats and recreate them from parsed script beats."""
    from sqlmodel import select
    for b in s.exec(select(Beat).where(Beat.ticket_id == tid)).all():
        s.delete(b)
    for pb in parsed_beats:
        s.add(Beat(ticket_id=tid, order_index=pb["order_index"],
                   spoken_line=pb["spoken_line"], on_screen_text=pb["on_screen_text"],
                   caption=pb["caption"], shot_cue=pb["shot_cue"],
                   is_proof_beat=pb["is_proof_beat"]))


def _validate_ticket(body: CreateTicket) -> None:
    if body.format not in _TICKET_FORMATS:
        raise HTTPException(400, f"unknown format {body.format!r}")
    if body.capture_mode not in _CAPTURE_MODES:
        raise HTTPException(400, f"unknown capture_mode {body.capture_mode!r}")


def _new_ticket(body: CreateTicket, hook: str, stage: str) -> Ticket:
    return Ticket(brand=body.brand, angle=body.angle, format=body.format,
                  capture_mode=body.capture_mode, outlier_id=body.outlier_id,
                  source_ref=body.source_ref, hook_text=hook,
                  platforms=body.platforms, stage=stage)


@app.post("/api/tickets")
def create_ticket(body: CreateTicket):
    _validate_ticket(body)
    with get_session() as s:
        t = _new_ticket(body, body.hook_text, "outlier")
        s.add(t); s.commit(); s.refresh(t)
        return {"ticket": t.model_dump(), "beats": []}


@app.post("/api/tickets/from-script")
def create_ticket_from_script(body: TicketFromScript):
    """Intake: spin a ticket from a pasted Claude script, auto-split into beats."""
    _validate_ticket(body)
    parsed = intake.parse_script(body.script)
    with get_session() as s:
        t = _new_ticket(body, body.hook_text or parsed["hook"],
                        "scripted" if parsed["beats"] else "outlier")
        t.autopilot = body.autopilot
        t.auto_voiceover = body.auto_voiceover
        s.add(t); s.commit(); s.refresh(t)
        tid = t.id
        _replace_beats(s, tid, parsed["beats"])
        s.commit(); s.refresh(t)
        return {"ticket": t.model_dump(),
                "beats": [b.model_dump() for b in _beats_for(s, tid)]}


@app.post("/api/tickets/{tid}/import-script")
def import_script(tid: int, body: ImportScript):
    """Re-import: replace a ticket's beats from a freshly pasted script."""
    parsed = intake.parse_script(body.script)
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        if parsed["hook"] and not t.hook_text:
            t.hook_text = parsed["hook"]
        if parsed["beats"]:
            t.stage = "scripted"
        s.add(t)
        _replace_beats(s, tid, parsed["beats"])
        s.commit(); s.refresh(t)
        return {"ticket": t.model_dump(),
                "beats": [b.model_dump() for b in _beats_for(s, tid)]}


@app.post("/api/tickets/{tid}/script-factory")
def script_factory(tid: int, body: AIBrief):
    """AI: generate a script (hook + beats) for the ticket's angle, replacing its beats."""
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        brand, angle, fmt = t.brand, t.angle, t.format
    result = ai.script_factory(brand, angle, body.brief, fmt)
    with get_session() as s:
        t = s.get(Ticket, tid)
        if result.get("hook") and not t.hook_text:
            t.hook_text = result["hook"]
        if result["beats"]:
            t.stage = "scripted"
        t.ai_generated = True          # the app wrote this script → reel rates 90+
        s.add(t)
        _replace_beats(s, tid, result["beats"])
        s.commit(); s.refresh(t)
        return {"ticket": t.model_dump(),
                "beats": [b.model_dump() for b in _beats_for(s, tid)]}


@app.post("/api/tickets/{tid}/hook-forge")
def hook_forge(tid: int, body: AIBrief):
    """AI: return candidate first-frame hooks (the frontend picks one → sets hook_text)."""
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        brand, angle = t.brand, t.angle
    return {"hooks": ai.hook_forge(brand, angle, body.brief)}


@app.post("/api/tickets/{tid}/post-copy")
def generate_post_copy(tid: int):
    """AI: fill Ticket.post_meta (per-platform captions/hashtags/title/description)
    from the ticket's own script — no more pasting the script back into Claude."""
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        beats = _beats_for(s, tid)
        brand, hook = t.brand, t.hook_text
        script = "\n".join((b.spoken_line or b.caption) for b in beats)
    meta = ai.post_copy(brand, hook, script)
    with get_session() as s:
        t = s.get(Ticket, tid)
        t.post_meta = meta
        s.add(t); s.commit(); s.refresh(t)
        return {"ticket": t.model_dump(), "post_meta": meta}


@app.get("/api/tickets")
def list_tickets():
    """All tickets, each with a scene-progress summary (n_beats / n_clips / n_vo) so the
    board can show exactly where a "Make it" video was left off."""
    from sqlmodel import select
    with get_session() as s:
        rows = s.exec(select(Ticket).order_by(Ticket.id.desc())).all()
        beats = s.exec(select(Beat)).all()
        prog: dict[int, dict] = {}
        for b in beats:
            p = prog.setdefault(b.ticket_id, {"n_beats": 0, "n_clips": 0, "n_vo": 0})
            p["n_beats"] += 1
            if b.clip_path:
                p["n_clips"] += 1
            if b.voiceover_path:
                p["n_vo"] += 1
        return [{**t.model_dump(), **prog.get(t.id, {"n_beats": 0, "n_clips": 0, "n_vo": 0})}
                for t in rows]


@app.get("/api/tickets/{tid}")
def get_ticket(tid: int):
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        return {"ticket": t.model_dump(),
                "beats": [b.model_dump() for b in _beats_for(s, tid)]}


@app.patch("/api/tickets/{tid}")
def patch_ticket(tid: int, body: TicketPatch):
    data = body.model_dump(exclude_none=True)
    if "stage" in data and data["stage"] not in STAGES:
        raise HTTPException(400, f"unknown stage {data['stage']!r}")
    if "format" in data and data["format"] not in _TICKET_FORMATS:
        raise HTTPException(400, f"unknown format {data['format']!r}")
    if "capture_mode" in data and data["capture_mode"] not in _CAPTURE_MODES:
        raise HTTPException(400, f"unknown capture_mode {data['capture_mode']!r}")
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        for k, v in data.items():
            setattr(t, k, v)
        s.add(t); s.commit(); s.refresh(t)
        return t.model_dump()


@app.delete("/api/tickets/{tid}")
def delete_ticket(tid: int):
    from sqlmodel import select
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        for b in s.exec(select(Beat).where(Beat.ticket_id == tid)).all():
            s.delete(b)
        s.delete(t)
        s.commit()
    return {"deleted": tid}


@app.patch("/api/beats/{bid}")
def patch_beat(bid: int, body: BeatPatch):
    """Edit a beat — notably toggle is_proof_beat so heuristic false-flags
    (e.g. '3 swaps') can be turned off."""
    data = body.model_dump(exclude_none=True)
    with get_session() as s:
        b = s.get(Beat, bid)
        if not b:
            raise HTTPException(404, "beat not found")
        for k, v in data.items():
            setattr(b, k, v)
        s.add(b); s.commit(); s.refresh(b)
        return b.model_dump()


def _safe_name(s: str, fallback: str) -> str:
    import re
    cleaned = re.sub(r'[\\/:*?"<>|]+', " ", (s or "")).strip()
    return f"{cleaned or fallback}.mp4"


@app.get("/api/exports")
def list_exports():
    """Every rendered output across the app — project clips + assembled ticket reels.
    Powers the Downloads screen. Items carry folder metadata: `group` (top folder) →
    `subgroup` → cards. REELS all live under one "Reels" folder, split into brand
    subfolders (NoCrapDiet / SemSeo / …); plain clips stay grouped by their project.
    Names are the ONE canonical `_video_name` so Downloads matches the editor & Results."""
    from sqlmodel import select
    REELS = "Reels"
    out = []
    with get_session() as s:
        for c in s.exec(select(Clip).where(Clip.status == "rendered")).all():
            title = _video_name(s, "clip", c.id)
            if _is_reel_clip(s, c):   # a caption-mode reel → Reels/<brand>
                brand = _video_brand(s, "clip", c.id) or "Unsorted"
                out.append({"kind": "clip", "id": c.id, "title": title,
                            "subtitle": f"{brand} · reel",
                            "group": (c.folder or REELS), "subgroup": brand,
                            "hook": c.hook or "", "filename": _safe_name(title, f"reel_{c.id}"),
                            "score": round(c.score), "download": f"/api/clips/{c.id}/download",
                            "thumb": f"/api/clips/{c.id}/thumb"})
            else:                     # a plain moment clip → grouped by its project
                proj = s.get(Project, c.project_id)
                pname = proj.name if proj else "Clips"
                out.append({"kind": "clip", "id": c.id, "title": title,
                            "subtitle": pname,
                            "group": (c.folder or pname), "subgroup": "Clips",
                            "hook": c.hook or "", "filename": _safe_name(title, f"clip_{c.id}"),
                            "score": round(c.score), "download": f"/api/clips/{c.id}/download",
                            "thumb": f"/api/clips/{c.id}/thumb"})
        for t in s.exec(select(Ticket).where(Ticket.clip_url.is_not(None))).all():
            title = _video_name(s, "reel", t.id)
            brand = _video_brand(s, "reel", t.id) or t.brand or "Unsorted"
            out.append({"kind": "reel", "id": t.id, "title": title,
                        "subtitle": f"{brand} · reel",
                        "group": (t.folder or REELS), "subgroup": brand,
                        "hook": (t.hook_text or t.angle or "").strip(),
                        "filename": _safe_name(title, f"reel_{t.id}"),
                        "score": None,
                        "download": f"/api/tickets/{t.id}/download",
                        "thumb": f"/api/tickets/{t.id}/thumb"})
    return out


class SetFolder(BaseModel):
    folder: str = ""                       # "" clears the override (back to default)


@app.patch("/api/exports/{kind}/{item_id}/folder")
def set_export_folder(kind: str, item_id: int, body: SetFolder):
    """Move a finished video into a different Downloads folder (drag-to-move)."""
    folder = body.folder.strip() or None
    with get_session() as s:
        obj = s.get(Clip, item_id) if kind == "clip" else s.get(Ticket, item_id) if kind == "reel" else None
        if kind not in ("clip", "reel"):
            raise HTTPException(400, f"unknown kind {kind!r}")
        if not obj:
            raise HTTPException(404, "item not found")
        obj.folder = folder
        s.add(obj); s.commit()
    return {"ok": True, "folder": folder}


class SetBrand(BaseModel):
    brand: str = ""                        # "" clears the brand


@app.post("/api/videos/{kind}/{item_id}/brand")
def set_video_brand(kind: str, item_id: int, body: SetBrand):
    """Set a video's brand on its own — no metrics needed. Lets you brand a reel straight
    from Results (or fix one) without logging performance numbers."""
    if kind not in ("clip", "reel"):
        raise HTTPException(400, f"unknown kind {kind!r}")
    with get_session() as s:
        obj = s.get(Clip, item_id) if kind == "clip" else s.get(Ticket, item_id)
        if not obj:
            raise HTTPException(404, "item not found")
        _set_video_brand(s, kind, item_id, body.brand)
        s.commit()
    return {"ok": True, "brand": body.brand.strip()}


@app.post("/api/tickets/{tid}/beats")
def add_beat(tid: int):
    """Append a blank beat to a ticket (manual editing on the native path)."""
    from sqlmodel import select
    with get_session() as s:
        if not s.get(Ticket, tid):
            raise HTTPException(404, "ticket not found")
        existing = s.exec(select(Beat).where(Beat.ticket_id == tid)).all()
        nxt = (max((b.order_index for b in existing), default=-1)) + 1
        b = Beat(ticket_id=tid, order_index=nxt)
        s.add(b); s.commit(); s.refresh(b)
        return b.model_dump()


@app.delete("/api/beats/{bid}")
def delete_beat(bid: int):
    with get_session() as s:
        b = s.get(Beat, bid)
        if not b:
            raise HTTPException(404, "beat not found")
        s.delete(b); s.commit()
    return {"deleted": bid}


@app.post("/api/tickets/{tid}/beats/reorder")
def reorder_beats(tid: int, body: ReorderBeats):
    """Set each beat's order_index from its position in `ids`."""
    with get_session() as s:
        if not s.get(Ticket, tid):
            raise HTTPException(404, "ticket not found")
        for i, bid in enumerate(body.ids):
            b = s.get(Beat, bid)
            if b and b.ticket_id == tid:
                b.order_index = i
                s.add(b)
        s.commit()
        return {"beats": [b.model_dump() for b in _beats_for(s, tid)]}


# --------------------------------------------------------------------------- #
# Outlier routes (the swipe file / MINE)
# --------------------------------------------------------------------------- #
@app.post("/api/outliers")
def create_outlier(body: CreateOutlier):
    with get_session() as s:
        o = Outlier(**body.model_dump())
        s.add(o); s.commit(); s.refresh(o)
        return o.model_dump()


@app.get("/api/outliers")
def list_outliers():
    from sqlmodel import select
    with get_session() as s:
        return [o.model_dump() for o in s.exec(select(Outlier).order_by(Outlier.id.desc())).all()]


@app.delete("/api/outliers/{oid}")
def delete_outlier(oid: int):
    with get_session() as s:
        o = s.get(Outlier, oid)
        if not o:
            raise HTTPException(404, "outlier not found")
        s.delete(o); s.commit()
    return {"deleted": oid}


@app.post("/api/tickets/from-outlier/{oid}")
def ticket_from_outlier(oid: int):
    """Spin a ticket pre-tagged with the outlier's angle (the MINE→ticket step)."""
    with get_session() as s:
        o = s.get(Outlier, oid)
        if not o:
            raise HTTPException(404, "outlier not found")
        t = Ticket(brand="NoCrapDiet", angle=o.angle, outlier_id=oid,
                   hook_text=o.hook or "", stage="outlier")
        s.add(t); s.commit(); s.refresh(t)
        return {"ticket": t.model_dump(), "beats": []}


# --------------------------------------------------------------------------- #
# Insights / Signal Reader (MEASURE) — ranks angles by saves+follows, NOT views
# --------------------------------------------------------------------------- #
def _recompute_angle(s, angle_name: str) -> None:
    from sqlmodel import select
    if not angle_name:
        return
    tids = [t.id for t in s.exec(select(Ticket).where(Ticket.angle == angle_name)).all()]
    rows = s.exec(select(Perf).where(Perf.ticket_id.in_(tids))).all() if tids else []
    scores = [learn.perf_score(p.views, p.follows, p.saves, p.sends) for p in rows]
    a = s.get(Angle, angle_name) or Angle(angle=angle_name)
    a.posts_count = len({p.ticket_id for p in rows})
    a.avg_score = round(sum(scores) / len(scores), 2) if scores else 0.0
    s.add(a)


def _is_reel_clip(s, c: "Clip") -> bool:
    """A caption-mode project's clip IS a reel (that's what lands in Home's 'Reels'
    folder). Also treat any scene-stitched clip (has markers) as a reel."""
    if c is None:
        return False
    if c.markers_json:
        return True
    proj = s.get(Project, c.project_id)
    return bool(proj and proj.mode == "caption")


def _video_name(s, kind: str, vid: int) -> str:
    """The ONE display name for a video, identical across the editor, Results, Downloads
    and the Sheet. A reel is a caption-mode project — named by the PROJECT (the name the
    user gave it and sees in the Reels folder), so it never disagrees with itself. Regular
    clips keep their clip title; assembled ticket-reels keep their hook."""
    if kind == "clip":
        c = s.get(Clip, vid)
        if c is None:
            return f"Clip {vid}"
        if _is_reel_clip(s, c):
            proj = s.get(Project, c.project_id)
            return ((proj.name if proj else "") or "").strip() or f"Reel {vid}"
        return (c.title or "").strip() or f"Clip {c.idx + 1}"
    t = s.get(Ticket, vid)
    return ((t.hook_text or t.angle) if t else "").strip() or f"Reel {vid}"


def _set_video_brand(s, kind: str, vid: int, brand: str) -> None:
    """Persist a video's chosen brand to its canonical home so every screen agrees:
    ticket-reel -> Ticket.brand; caption reel -> its Project.brand (and clear any per-clip
    override); plain clip -> Clip.brand. Blank clears it (None) — never a silent default."""
    b = (brand or "").strip() or None
    if kind == "reel":
        t = s.get(Ticket, vid)
        if t:
            t.brand = b or ""            # Ticket.brand is non-null
            s.add(t)
        return
    c = s.get(Clip, vid)
    if not c:
        return
    if _is_reel_clip(s, c):
        proj = s.get(Project, c.project_id)
        if proj:
            proj.brand = b
            s.add(proj)
        c.brand = None                   # reel brand lives on the project — drop stale override
        s.add(c)
    else:
        c.brand = b
        s.add(c)


def _video_label(s, kind: str, vid: int) -> dict:
    """Resolve a (kind, id) video to its fields — hook is the learnable signal; angle/
    caption_preset/score round out the row pushed to the Google Sheet. `title` is the ONE
    canonical name (see `_video_name`) so every screen agrees."""
    if kind == "clip":
        c = s.get(Clip, vid)
        return {"video_kind": "clip", "video_id": vid,
                "hook": (c.hook if c else "") or "",
                "title": _video_name(s, kind, vid),
                "angle": "", "caption_preset": (c.caption_preset if c else "") or "",
                "score": round(c.score) if (c and c.score) else 0}
    t = s.get(Ticket, vid)
    return {"video_kind": "reel", "video_id": vid,
            "hook": (t.hook_text if t else "") or "",
            "title": _video_name(s, kind, vid),
            "angle": (t.angle if t else "") or "", "caption_preset": "", "score": 0}


_PLATFORM_FULL = {"tt": "TikTok", "ig": "Instagram", "yt": "YouTube"}


def _video_brand(s, kind: str, vid: int) -> str:
    """Resolve a video's brand for performance attribution (the cowork engine needs it for
    per-brand Growth Logs). Reel → its Ticket.brand; clip → its stored brand (chosen on the
    Results logger), else the brand of a ticket linked to the clip's project. NEVER falls back
    to a default — returns "" when unknown, so an unlinked/long-form clip logs BLANK instead
    of being silently mislabeled as NoCrapDiet."""
    from sqlmodel import select
    if kind == "reel":
        t = s.get(Ticket, vid)
        return (t.brand if (t and t.brand) else "") or ""
    c = s.get(Clip, vid)
    if c is None:
        return ""
    if c.brand:
        return c.brand
    proj = s.get(Project, c.project_id)
    if proj and proj.brand:            # reel brand chosen on New project / Results
        return proj.brand
    t = s.exec(select(Ticket).where(Ticket.project_id == c.project_id)).first()
    return (t.brand if (t and t.brand) else "") or ""


def _perf_sheet_row(s, kind: str, vid: int, platform: str, m: dict, when=None) -> dict:
    """One Google-Sheet row matching the cowork engine's A–M contract. Cvideo fills what it
    knows (brand/hook/angle/caption_style/metrics); journey_stage + hook_trigger are left
    blank for the weekly run to infer. NO score — the Sheet computes that."""
    from datetime import datetime
    lbl = _video_label(s, kind, vid)
    return {"post_id": f"{kind}_{vid}",
            "date": (when or datetime.utcnow()).date().isoformat(),
            "brand": _video_brand(s, kind, vid),
            "platform": _PLATFORM_FULL.get(platform, platform),
            "journey_stage": "",
            "hook": lbl["hook"] or lbl["title"],
            "hook_trigger": "",
            "angle": lbl["angle"],
            "caption_style": lbl["caption_preset"],
            "views": m.get("views", 0), "follows": m.get("follows", 0),
            "saves": m.get("saves", 0), "sends": m.get("sends", 0)}


@app.post("/api/perf")
def log_perf(body: LogPerf):
    from datetime import datetime
    # Accept the new (video_kind, video_id) or the legacy ticket_id (== a reel).
    kind = body.video_kind or ("reel" if body.ticket_id else None)
    vid = body.video_id or body.ticket_id
    if kind not in ("clip", "reel") or not vid:
        raise HTTPException(400, "pick a video to log against")
    with get_session() as s:
        angle = None
        if kind == "reel":
            t = s.get(Ticket, vid)
            if not t:
                raise HTTPException(404, "reel not found")
            t.stage = "posted"
            if not t.posted_at:
                t.posted_at = datetime.utcnow()
            s.add(t); angle = t.angle
            # Persist the brand chosen on the logger (blank allowed; None = leave as-is).
            if body.brand is not None:
                _set_video_brand(s, kind, vid, body.brand)
        else:  # clip
            c = s.get(Clip, vid)
            if not c:
                raise HTTPException(404, "clip not found")
            if body.brand is not None:
                _set_video_brand(s, kind, vid, body.brand)
        # Upsert: one row per (video, platform) — re-logging UPDATES the latest numbers
        # for that platform (so the same reel tracked on TikTok/IG/YouTube stays 3 rows,
        # each editable), instead of stacking duplicate rows that double-count.
        from sqlmodel import select as _select
        existing = s.exec(_select(Perf).where(
            Perf.video_kind == kind, Perf.video_id == vid, Perf.platform == body.platform)).first()
        if existing:
            existing.views, existing.follows = body.views, body.follows
            existing.saves, existing.sends = body.saves, body.sends
            existing.captured_at = datetime.utcnow(); s.add(existing)
        else:
            s.add(Perf(video_kind=kind, video_id=vid,
                       ticket_id=(vid if kind == "reel" else None),
                       platform=body.platform, views=body.views, follows=body.follows,
                       saves=body.saves, sends=body.sends))
        s.commit()
        if angle:
            _recompute_angle(s, angle); s.commit()
        row = _perf_sheet_row(s, kind, vid, body.platform, body.model_dump())
    # Best-effort, non-blocking: append this row to the Google Sheet (→ cowork engine).
    _render_pool.submit(sheets.push_perf_rows, [row])
    return {"ok": True}


@app.post("/api/perf/sync-sheet")
def sync_sheet():
    """Backfill: push ALL logged performance to the Google Sheet at once."""
    from sqlmodel import select
    if not sheets.is_live():
        raise HTTPException(400, "No Google Sheet connected yet — add PERF_SHEET_WEBHOOK_URL to "
                                 "backend/.env (the Apps Script web-app URL) and restart.")
    with get_session() as s:
        rows = []
        for p in s.exec(select(Perf).order_by(Perf.captured_at)).all():
            vid = p.video_id if p.video_id is not None else p.ticket_id
            if vid is None:
                continue
            rows.append(_perf_sheet_row(s, p.video_kind or "reel", vid, p.platform,
                        {"views": p.views, "follows": p.follows, "saves": p.saves, "sends": p.sends},
                        when=p.captured_at))
    res = sheets.push_perf_rows(rows)
    if res.get("error"):
        raise HTTPException(502, f"Sheet push failed: {res['error']}")
    return {"ok": True, "pushed": res.get("pushed", 0)}


@app.get("/api/insights")
def insights():
    from sqlmodel import select
    from collections import defaultdict
    with get_session() as s:
        tickets = s.exec(select(Ticket)).all()
        perfs = s.exec(select(Perf)).all()
        angles = s.exec(select(Angle).order_by(Angle.avg_score.desc())).all()

        # Top VIDEOS by the unified perf_score — keyed on the real exported asset
        # (clip/reel), so a long-form clip you posted ranks the same as a native reel.
        by_video: dict[tuple, float] = defaultdict(float)
        for p in perfs:
            vid = p.video_id if p.video_id is not None else p.ticket_id
            if vid is None:
                continue
            by_video[(p.video_kind or "reel", vid)] += learn.perf_score(
                p.views, p.follows, p.saves, p.sends)
        top_keys = sorted(by_video.items(), key=lambda kv: kv[1], reverse=True)[:8]
        top = [{**_video_label(s, k[0], k[1]), "score": sc} for k, sc in top_keys]

        # Per-VIDEO, per-PLATFORM tracking: every exported reel/clip with its TikTok /
        # Instagram / YouTube numbers side by side, so you can pick a reel and see + edit
        # all three channels at once.
        pvp: dict[tuple, dict] = {}
        for p in perfs:
            v = p.video_id if p.video_id is not None else p.ticket_id
            if v is None:
                continue
            cur = pvp.get((p.video_kind or "reel", v, p.platform or "?"),
                          {"views": 0, "follows": 0, "saves": 0, "sends": 0})
            cur = {"views": cur["views"] + p.views, "follows": cur["follows"] + p.follows,
                   "saves": cur["saves"] + p.saves, "sends": cur["sends"] + p.sends}
            pvp[(p.video_kind or "reel", v, p.platform or "?")] = cur
        # Track every reel (any Clip with scene markers) + every rendered clip + assembled
        # ticket-reels — so all your reels show up here, not just the ones already exported.
        exported: list[tuple] = []   # (kind, id, is_reel)
        for c in s.exec(select(Clip)).all():
            if c.status == "rendered" or c.markers_json:
                exported.append(("clip", c.id, _is_reel_clip(s, c)))
        for t in s.exec(select(Ticket).where(Ticket.clip_url.is_not(None))).all():
            exported.append(("reel", t.id, True))
        videos = []
        for kind, vid, is_reel in exported:
            lbl = _video_label(s, kind, vid)
            plats, tot = {}, {"views": 0, "follows": 0, "saves": 0, "sends": 0}
            for pf in ("tt", "ig", "yt"):
                d = pvp.get((kind, vid, pf))
                if d:
                    plats[pf] = d
                    for kk in tot:
                        tot[kk] += d[kk]
            videos.append({"video_kind": kind, "video_id": vid, "is_reel": is_reel,
                           "title": lbl["title"], "hook": lbl["hook"],
                           "brand": _video_brand(s, kind, vid), "platforms": plats,
                           "totals": tot,
                           "score": learn.perf_score(tot["views"], tot["follows"],
                                                     tot["saves"], tot["sends"])})
        videos.sort(key=lambda v: (v["score"], v["is_reel"]), reverse=True)

    # Per-platform breakdown (which channel is actually working).
    _plat: dict[str, dict] = defaultdict(
        lambda: {"views": 0, "follows": 0, "saves": 0, "sends": 0, "posts": 0})
    for p in perfs:
        row = _plat[p.platform or "?"]
        row["views"] += p.views; row["follows"] += p.follows
        row["saves"] += p.saves; row["sends"] += p.sends; row["posts"] += 1
    _pscore = lambda v: learn.perf_score(v["views"], v["follows"], v["saves"], v["sends"])
    by_platform = [{"platform": k, **v, "score": _pscore(v)}
                   for k, v in sorted(_plat.items(), key=lambda kv: _pscore(kv[1]),
                                      reverse=True)]

    # Trend: totals per capture day (chronological) so the UI can chart momentum.
    _days: dict[str, dict] = defaultdict(
        lambda: {"views": 0, "follows": 0, "saves": 0, "sends": 0})
    for p in perfs:
        d = p.captured_at.date().isoformat() if p.captured_at else "?"
        row = _days[d]
        row["views"] += p.views; row["follows"] += p.follows
        row["saves"] += p.saves; row["sends"] += p.sends
    trend = [{"date": d, **v,
              "score": learn.perf_score(v["views"], v["follows"], v["saves"], v["sends"])}
             for d, v in sorted(_days.items())]

    return {
        "kpis": {
            "tickets": len(by_video) or len(tickets),   # # of videos you're tracking
            "posted": len([t for t in tickets if t.stage == "posted"]),
            "views": sum(p.views for p in perfs),
            "follows": sum(p.follows for p in perfs),
            "saves": sum(p.saves for p in perfs),
            "sends": sum(p.sends for p in perfs),
        },
        "top": top,
        "videos": videos,
        "angles": [a.model_dump() for a in angles],
        "by_platform": by_platform,
        "trend": trend,
    }


# --------------------------------------------------------------------------- #
# Scheduling / posting (P6) — Upload-Post behind a dry-run adapter
# --------------------------------------------------------------------------- #
from .pipeline import poster  # noqa: E402


def _ticket_caption(t: Ticket, platform: Optional[str] = None) -> str:
    """Best publish caption for a ticket. Prefers the per-platform post_meta (caption + hashtags —
    the copy the app writes and you edit on screen), then the legacy `captions` field, then the
    hook. This is what actually gets sent to Upload-Post, so the descriptions/tags aren't lost."""
    pm = t.post_meta if isinstance(t.post_meta, dict) else {}
    order = [platform] if platform else list(pm.keys())
    for p in order:
        entry = pm.get(p) or {}
        cap = (entry.get("caption") or entry.get("title") or "").strip()
        tags = (entry.get("hashtags") or entry.get("tags") or "").strip()
        if cap or tags:
            return " ".join(x for x in (cap, tags) if x).strip()
    caps_map = t.captions if isinstance(t.captions, dict) else {}
    if platform and caps_map.get(platform):
        return caps_map[platform]
    for v in caps_map.values():
        if v:
            return v
    return t.hook_text or t.angle or ""


@app.get("/api/queue")
def queue():
    """Scheduling board: what's ready to schedule, what's queued, what's posted.
    `dry_run` tells the UI we'll only log (no UPLOAD_POST_API_KEY set)."""
    from datetime import datetime
    from sqlmodel import select
    with get_session() as s:
        tickets = s.exec(select(Ticket)).all()

    def card(t: Ticket) -> dict:
        d = t.model_dump()
        d["has_video"] = bool(t.clip_url and Path(t.clip_url).exists())
        return d

    ready = [card(t) for t in tickets if t.stage in ("assembled", "ready") and t.clip_url]
    sched = sorted([t for t in tickets if t.stage == "scheduled"],
                   key=lambda t: t.scheduled_at or datetime.max)
    posted = sorted([t for t in tickets if t.stage == "posted"],
                    key=lambda t: t.posted_at or datetime.min, reverse=True)[:20]
    return {"dry_run": not poster.is_live(), "platforms": settings.PLATFORMS,
            "config": poster.configured(),
            "ready": ready, "scheduled": [card(t) for t in sched],
            "posted": [card(t) for t in posted]}


@app.post("/api/tickets/{tid}/schedule")
def schedule_ticket(tid: int, body: ScheduleTicket):
    """Queue a reel for a time (or clear it). Sets stage=scheduled."""
    from datetime import datetime
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        if body.scheduled_at:
            try:
                t.scheduled_at = datetime.fromisoformat(body.scheduled_at)
            except ValueError:
                raise HTTPException(400, "scheduled_at must be an ISO datetime")
            t.stage = "scheduled"
        else:                                   # clear → back out of the queue
            t.scheduled_at = None
            if t.stage == "scheduled":
                t.stage = "ready" if t.clip_url else "assembled"
        if body.platforms is not None:
            t.platforms = body.platforms
        if body.captions is not None:
            t.captions = body.captions
        s.add(t); s.commit(); s.refresh(t)
        return t.model_dump()


@app.post("/api/tickets/{tid}/post")
def post_ticket(tid: int, body: PostTicket):
    """Send a reel to Upload-Post — now (scheduled_at=None) or scheduled for a time.
    Dry-run (no UPLOAD_POST_API_KEY) just logs. Updates the ticket stage accordingly."""
    from datetime import datetime
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        platforms = body.platforms or t.platforms or settings.PLATFORMS
        caption = body.caption or _ticket_caption(t, platforms[0] if platforms else None)
        video = t.clip_url
    when = body.scheduled_at or None
    try:
        result = poster.post_reel(ticket_id=tid, video_path=video, caption=caption,
                                  platforms=platforms, when=when)
    except Exception as e:  # surfaces real-mode misconfig as a 400
        raise HTTPException(400, f"{e}")
    with get_session() as s:
        t = s.get(Ticket, tid)
        t.platforms = platforms
        if when:
            t.stage = "scheduled"
            try:
                t.scheduled_at = datetime.fromisoformat(when)
            except ValueError:
                pass
        else:
            t.stage = "posted"
            if not t.posted_at:
                t.posted_at = datetime.utcnow()
        # Capture the Upload-Post ids (present in real mode; None in dry-run) so a scheduled
        # post can later be cancelled and per-video stats matched back.
        t.job_id = result.get("job_id") or t.job_id
        t.request_id = result.get("request_id") or t.request_id
        s.add(t); s.commit()
    return result


# --------------------------------------------------------------------------- #
# Native assemble routes (beat uploads → reel) + long-form hookup
# --------------------------------------------------------------------------- #
from .pipeline import assemble  # noqa: E402


def _beat_media_dir(tid: int, bid: int) -> Path:
    d = assemble.ticket_dir(tid) / "beats" / str(bid)
    d.mkdir(parents=True, exist_ok=True)
    return d


@app.post("/api/beats/{bid}/clip")
async def upload_beat_clip(bid: int, file: UploadFile = File(...)):
    with get_session() as s:
        b = s.get(Beat, bid)
        if not b:
            raise HTTPException(404, "beat not found")
        tid = b.ticket_id
    dest = _beat_media_dir(tid, bid) / "clip.mp4"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    _set_beat_media(bid, clip_path=str(dest))
    return {"clip_path": str(dest)}


@app.post("/api/beats/{bid}/voiceover")
async def upload_beat_voiceover(bid: int, file: UploadFile = File(...)):
    with get_session() as s:
        b = s.get(Beat, bid)
        if not b:
            raise HTTPException(404, "beat not found")
        tid = b.ticket_id
    mdir = _beat_media_dir(tid, bid)
    raw = mdir / f"vo_raw_{file.filename or 'audio'}"
    with raw.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    wav = mdir / "voiceover.wav"
    try:
        ingest.extract_voiceover(raw, wav)      # full-quality 48k stereo wav
    finally:
        raw.unlink(missing_ok=True)
    _set_beat_media(bid, voiceover_path=str(wav))
    return {"voiceover_path": str(wav)}


def _set_beat_media(bid: int, **fields):
    with get_session() as s:
        b = s.get(Beat, bid)
        if b:
            for k, v in fields.items():
                setattr(b, k, v)
            s.add(b); s.commit()


# --------------------------------------------------------------------------- #
# Shoot Drop — batch raw-footage intake (record → dump files → done)
# --------------------------------------------------------------------------- #
class ShootdropAssign(BaseModel):
    beat_id: Optional[int] = None      # attach to this scene…
    new_ticket: bool = False           # …or spin a new video from this clip


@app.post("/api/shootdrop")
async def shootdrop_upload(files: list[UploadFile] = File(...)):
    """Drop a whole shoot's raw files at once; the batch pipeline sorts them."""
    tmp = Path(tempfile.mkdtemp(prefix="shootdrop_"))
    paths: list[Path] = []
    names: list[str] = []
    for f in files:
        name = f.filename or "clip.mp4"
        suffix = Path(name).suffix.lower() or ".mp4"
        if suffix not in shootdrop.VIDEO_EXTS:
            continue
        dest = tmp / f"{len(paths):02d}{suffix}"
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        paths.append(dest)
        names.append(name)
    if not paths:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(400, "no video files in upload")
    batch_id = shootdrop.new_batch(paths, move=True, names=names)
    shutil.rmtree(tmp, ignore_errors=True)
    submit_shootdrop(batch_id)
    return {"batch_id": batch_id, "count": len(paths)}


@app.get("/api/shootdrop")
def shootdrop_status():
    """Recent ingest clips (newest first) + open scenes for the reassign menu."""
    from sqlmodel import select
    with get_session() as s:
        rows = s.exec(select(IngestClip).where(IngestClip.status != "discarded")
                      .order_by(IngestClip.id.desc()).limit(60)).all()
        clips = []
        for ic in rows:
            d = ic.model_dump()
            if ic.ticket_id:
                t = s.get(Ticket, ic.ticket_id)
                d["ticket_label"] = (t.hook_text or t.angle or f"video {t.id}") if t else ""
            if ic.beat_id:
                b = s.get(Beat, ic.beat_id)
                d["scene_index"] = b.order_index if b else None
            clips.append(d)
    return {"clips": clips, "watch_dir": settings.SHOOT_DROP_DIR,
            "open_scenes": shootdrop.open_beats()}


@app.get("/api/shootdrop/clips/{icid}/file")
def shootdrop_clip_file(icid: int):
    """Stream a raw ingest clip so you can watch the take and verify the match."""
    with get_session() as s:
        ic = s.get(IngestClip, icid)
        if not ic:
            raise HTTPException(404, "ingest clip not found")
        path = Path(ic.path)
    if not path.exists():
        raise HTTPException(404, "file no longer exists")
    return FileResponse(str(path), media_type="video/mp4")


@app.get("/api/shootdrop/clips/{icid}/thumb")
def shootdrop_clip_thumb(icid: int):
    """A small still frame of the clip — so you recognize silent B-roll at a glance
    and drag it onto the right scene (media-bin style)."""
    with get_session() as s:
        ic = s.get(IngestClip, icid)
        if not ic:
            raise HTTPException(404, "ingest clip not found")
        path = Path(ic.path)
    if not path.exists():
        raise HTTPException(404, "file no longer exists")
    thumb = path.with_suffix(".thumb.jpg")
    if not thumb.exists():
        _make_frame(path, thumb, 1.0, w=320)   # ~1s in, source aspect
    if not thumb.exists():
        raise HTTPException(404, "thumbnail unavailable")
    return FileResponse(str(thumb), media_type="image/jpeg")


@app.post("/api/shootdrop/clips/{icid}/assign")
def shootdrop_assign(icid: int, body: ShootdropAssign):
    """Fix a wrong/missed match: attach the take to a chosen scene, or spin a
    new video from it. Clears the previously matched scene's footage."""
    with get_session() as s:
        ic = s.get(IngestClip, icid)
        if not ic:
            raise HTTPException(404, "ingest clip not found")
        if not Path(ic.path).exists():
            raise HTTPException(400, "source file no longer exists")
        prev_beat, src, transcript, mtime = ic.beat_id, ic.path, ic.transcript, ic.mtime
    if prev_beat and prev_beat != body.beat_id:
        _set_beat_media(prev_beat, clip_path=None)

    if body.new_ticket:
        tid = shootdrop.reverse_ticket(
            f"manual-{icid}",
            [{"id": icid, "path": src, "transcript": transcript or "", "mtime": mtime}])
        shootdrop.after_footage(tid)
    elif body.beat_id:
        with get_session() as s:
            b = s.get(Beat, body.beat_id)
            if not b:
                raise HTTPException(404, "beat not found")
            tid, order_index = b.ticket_id, b.order_index
            t = s.get(Ticket, tid)
            label = (t.hook_text or t.angle or f"video {tid}") if t else f"video {tid}"
        shootdrop.attach_clip_to_beat(Path(src), tid, body.beat_id)
        with get_session() as s:
            ic = s.get(IngestClip, icid)
            ic.status = "assigned"
            ic.ticket_id, ic.beat_id, ic.confidence = tid, body.beat_id, 0.0
            s.add(ic); s.commit()
        shootdrop.after_footage(tid)
    else:
        raise HTTPException(400, "pass beat_id or new_ticket")
    with get_session() as s:
        return s.get(IngestClip, icid).model_dump()


@app.delete("/api/shootdrop/clips/{icid}")
def shootdrop_discard(icid: int):
    """Discard a take. If it was attached to a scene, that scene needs footage again."""
    with get_session() as s:
        ic = s.get(IngestClip, icid)
        if not ic:
            raise HTTPException(404, "ingest clip not found")
        prev_beat = ic.beat_id
        ic.status = "discarded"
        ic.ticket_id = ic.beat_id = None
        s.add(ic); s.commit()
    if prev_beat:
        _set_beat_media(prev_beat, clip_path=None)
    return {"discarded": icid}


def _assemble_job(tid: int):
    _assemble_status[tid] = {"state": "running", "stage": "Starting", "error": None}
    try:
        reel = assemble.assemble_reel(tid, progress=lambda m: _assemble_status.__setitem__(
            tid, {"state": "running", "stage": m, "error": None}))
        with get_session() as s:
            t = s.get(Ticket, tid)
            t.clip_url = str(reel)
            if t.stage in ("outlier", "scripted", "staged", "sourced"):
                t.stage = "assembled"
            s.add(t); s.commit()
        _assemble_status[tid] = {"state": "done", "stage": "Done", "error": None}
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        _assemble_status[tid] = {"state": "error", "stage": "", "error": f"{e}"}


@app.post("/api/tickets/{tid}/assemble")
def assemble_ticket_route(tid: int):
    """Kick off native assembly of a ticket's beats into a reel (background)."""
    from sqlmodel import select
    with get_session() as s:
        if not s.get(Ticket, tid):
            raise HTTPException(404, "ticket not found")
        beats = s.exec(select(Beat).where(Beat.ticket_id == tid)).all()
        if not beats:
            raise HTTPException(400, "ticket has no beats to assemble")
        gaps = [b for b in beats if b.is_proof_beat and not (b.clip_path and Path(b.clip_path).exists())]
        if gaps:
            raise HTTPException(400, f"{len(gaps)} proof beat(s) missing a clip — add the product/label footage first")
    _render_pool.submit(_assemble_job, tid)
    return {"status": "assembling"}


@app.get("/api/tickets/{tid}/assemble-status")
def assemble_status(tid: int):
    return _assemble_status.get(tid, {"state": "idle", "stage": "", "error": None})


@app.post("/api/tickets/{tid}/use-clip/{cid}")
def ticket_use_clip(tid: int, cid: int):
    """Long-form hookup: point a longform-clip ticket at a rendered project clip."""
    with get_session() as s:
        t = s.get(Ticket, tid)
        c = s.get(Clip, cid)
        if not t or not c:
            raise HTTPException(404, "ticket or clip not found")
        if not c.output_path or not Path(c.output_path).exists():
            raise HTTPException(400, "clip is not rendered yet")
        t.clip_url = c.output_path
        t.project_id = c.project_id
        t.stage = "assembled"
        s.add(t); s.commit(); s.refresh(t)
        return t.model_dump()


@app.get("/api/tickets/{tid}/download")
def download_ticket(tid: int):
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t or not t.clip_url or not Path(t.clip_url).exists():
            raise HTTPException(404, "no assembled reel for this ticket")
        return FileResponse(t.clip_url, media_type="video/mp4",
                            filename=f"{t.angle or 'reel'}.mp4")


@app.get("/api/tickets/{tid}/thumb")
def ticket_thumb(tid: int):
    """A poster frame for an assembled reel (already 9:16) — for Downloads/board cards."""
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t or not t.clip_url or not Path(t.clip_url).exists():
            raise HTTPException(404, "no assembled reel for this ticket")
        src = Path(t.clip_url)
    thumb = src.with_suffix(".jpg")
    if not thumb.exists():
        import subprocess
        dur = ingest.probe_duration(src) or 1.0
        subprocess.run(["ffmpeg", "-y", "-ss", f"{dur / 3:.2f}", "-i", str(src),
                        "-vf", "scale=360:-2", "-frames:v", "1", "-q:v", "4", str(thumb)],
                       capture_output=True)
    if not thumb.exists():
        raise HTTPException(404, "thumbnail unavailable")
    return FileResponse(str(thumb), media_type="image/jpeg")


def _score_reel(beats: list[dict], hook: str, ai_generated: bool) -> int:
    """A reel's quality score (0-100), derived from its SCRIPT. App-written (AI) scripts
    always rate **90+** (never below 90); pasted scripts get a content heuristic
    (hook present + how developed it is + proof beats)."""
    n = len(beats or [])
    proof = sum(1 for b in (beats or []) if b.get("is_proof_beat"))
    has_hook = bool((hook or "").strip()) or (n > 0 and bool((beats[0].get("spoken_line") or "").strip()))
    if ai_generated:
        return min(98, 90 + (n % 5) + min(proof, 3))                 # 90-98
    base = 72 + min(n, 8) + min(proof * 2, 6) + (6 if has_hook else 0)
    return int(min(96, max(60, base)))                               # pasted: 60-96


@app.post("/api/tickets/{tid}/build-edit")
def build_edit(tid: int):
    """Stitch a native reel's scenes into ONE video and open it in the clip editor.
    Creates (or reuses) a caption-mode Project + single Clip carrying scene markers
    and caption words, so the existing editor (preview/captions/trim/cut/voice) applies."""
    from sqlmodel import select
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        beats = [b.model_dump() for b in s.exec(
            select(Beat).where(Beat.ticket_id == tid).order_by(Beat.order_index)).all()]
        if not beats:
            raise HTTPException(400, "this video has no scenes yet")
        title = t.angle or f"Reel {tid}"
        existing_pid = t.project_id
        reel_score = _score_reel(beats, t.hook_text, bool(t.ai_generated))
    with get_session() as s:
        proj = s.get(Project, existing_pid) if existing_pid else None
        if not proj:
            proj = Project(name=title, source_type="file", mode="caption",
                           aspect="9:16", caption_preset=caps.DEFAULT_PRESET)
        proj.status, proj.stage, proj.progress = "analyzing", "Building video", 30
        s.add(proj); s.commit(); s.refresh(proj); pid = proj.id
    try:
        result = assemble.build_edit_video(tid, settings.project_dir(pid))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        with get_session() as s:
            p = s.get(Project, pid)
            p.status, p.error = "error", f"{e}"; s.add(p); s.commit()
        raise HTTPException(500, f"build failed: {e}")
    (settings.project_dir(pid) / "words.json").write_text(
        json.dumps({"words": result["words"]}, ensure_ascii=False), encoding="utf-8")
    full = result["duration"]
    new_scene_ct = len(result["scenes"])
    with get_session() as s:
        clip = s.exec(select(Clip).where(Clip.project_id == pid)).first()
        # Preserve the user's edits across a rebuild when the timeline shape is unchanged
        # (same scene count) and the clip actually carries edits — a trim/cut/split/voice.
        # If the scene count changed, the old edits no longer map, so wipe to a fresh clip.
        prev_scene_ct = 0
        if clip and clip.markers_json:
            try:
                prev_scene_ct = len(json.loads(clip.markers_json))
            except Exception:  # noqa: BLE001
                prev_scene_ct = 0
        edited = bool(clip and (clip.words_json or clip.cuts_json or clip.splits_json
                                or clip.voiceover_path or clip.scene_vo_json
                                or (clip.start or 0) > 0.05
                                or (0 < (clip.end or 0) < full - 0.05)))
        reuse = bool(clip and edited and prev_scene_ct == new_scene_ct)
        fresh_clip = clip is None
        if not clip:
            clip = Clip(project_id=pid, idx=0)
        clip.title = title
        clip.aspect = "9:16"
        # A rebuild must not restyle a video someone already captioned — only a brand-new
        # clip picks up the default (big cinematic subtitles).
        if fresh_clip:
            clip.caption_preset = caps.DEFAULT_PRESET
        clip.score = reel_score                       # rate the reel from its script
        clip.markers_json = json.dumps(result["scenes"])  # markers always refresh
        if not reuse:
            clip.start, clip.end = 0.0, full
            clip.words_json = clip.cuts_json = clip.splits_json = None
            clip.voiceover_path = clip.scene_vo_json = None
        clip.status = "suggested"
        s.add(clip); s.commit(); s.refresh(clip); cid = clip.id
        proj = s.get(Project, pid)
        proj.status, proj.stage, proj.progress, proj.duration = "ready", "Ready", 100, full
        s.add(proj)
        t = s.get(Ticket, tid); t.project_id = pid; s.add(t); s.commit()
    return {"pid": pid, "cid": cid, "reused_edits": reuse,
            "wiped_edits": bool(edited and not reuse)}


# --------------------------------------------------------------------------- #
# Clip routes
# --------------------------------------------------------------------------- #
@app.patch("/api/clips/{cid}")
def patch_clip(cid: int, body: ClipPatch):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        data = body.model_dump(exclude_none=True)
        if "resolution" in data and data["resolution"] not in settings.RESOLUTIONS:
            raise HTTPException(400, f"unknown resolution {data['resolution']!r}")
        style = data.pop("style", None)
        words = data.pop("words", None)
        cuts = data.pop("cuts", None)
        splits = data.pop("splits", None)
        effects = data.pop("effects", None)
        if style is not None:
            clip.style_json = json.dumps(style)
        if words is not None:
            clip.words_json = json.dumps(words)
        if cuts is not None:
            clip.cuts_json = json.dumps(cuts)
        if splits is not None:
            clip.splits_json = json.dumps(splits)
        if effects is not None:
            clip.effects_json = json.dumps(effects)
        for k, v in data.items():
            setattr(clip, k, v)
        clip.status = "suggested"  # edits invalidate any previous render
        s.add(clip)
        s.commit()
        s.refresh(clip)
        return clip.model_dump()


class AIEffectsBody(BaseModel):
    emphasis: bool = True   # emphasize key words + add emoji (on words_json)
    zoom: bool = True       # punch-in keyframes (effects_json.zoom)
    sfx: bool = True        # sound effects (effects_json.sfx)


@app.post("/api/clips/{cid}/ai-effects")
def ai_effects(cid: int, body: AIEffectsBody):
    """Submagic-style AI auto-effects (opt-in). Runs ONLY the checked sub-effects: emphasis/emoji
    get written onto the clip's caption words (words_json), zoom/sfx into effects_json. A clip
    nobody runs this on is untouched (byte-identical render)."""
    from .pipeline import effects as fx
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        pid, start, end = clip.project_id, clip.start, clip.end
        words = json.loads(clip.words_json) if clip.words_json else [
            w for w in get_words(pid) if w["end"] > start and w["start"] < end]

    sug = fx.suggest(words, body.emphasis, body.zoom, body.sfx)

    if body.emphasis:
        em, emoji = set(sug["emphasis"]), {int(k): v for k, v in sug["emoji"].items()}
        for i, w in enumerate(words):
            if i in em:
                w["emphasis"] = True
            else:
                w.pop("emphasis", None)
            if i in emoji:
                w["emoji"] = emoji[i]
            else:
                w.pop("emoji", None)

    with get_session() as s:
        clip = s.get(Clip, cid)
        if body.emphasis:
            clip.words_json = json.dumps(words)
        eff = json.loads(clip.effects_json) if clip.effects_json else {}
        if body.zoom:
            eff["zoom"] = sug["zoom"]
        if body.sfx:
            eff["sfx"] = sug["sfx"]
        clip.effects_json = json.dumps(eff)
        clip.status = "suggested"
        s.add(clip); s.commit(); s.refresh(clip)
    return {"clip": clip.model_dump(), "words": words, "effects": eff,
            "counts": {"emphasis": len(sug["emphasis"]), "emoji": len(sug["emoji"]),
                       "zoom": len(sug["zoom"]), "sfx": len(sug["sfx"])}}


def _set_clip(cid: int, **fields):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            return
        for k, v in fields.items():
            setattr(clip, k, v)
        s.add(clip)
        s.commit()


def _render_clip_job(cid: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        clip.status = "rendering"
        clip.stage = "Preparing"
        clip.error = None
        s.add(clip)
        s.commit()
        pid = clip.project_id
        start, end = clip.start, clip.end
        aspect, preset, center = clip.aspect, clip.caption_preset, clip.crop_center
        resolution = clip.resolution or settings.DEFAULT_RESOLUTION
        style = json.loads(clip.style_json) if clip.style_json else None
        words = json.loads(clip.words_json) if clip.words_json else None
        cuts = json.loads(clip.cuts_json) if clip.cuts_json else []
        voiceover = clip.voiceover_path if (clip.voiceover_path and Path(clip.voiceover_path).exists()) else None
        markers = json.loads(clip.markers_json) if clip.markers_json else []
        scene_vos = json.loads(clip.scene_vo_json) if clip.scene_vo_json else []
        effects = json.loads(clip.effects_json) if clip.effects_json else {}
        proj = s.get(Project, pid)
        source_type, source_url = proj.source_type, proj.source_url
    try:
        pdir = settings.project_dir(pid)
        if words is None:
            words = get_words(pid)
        ass = pdir / "clips" / f"clip_{cid}.ass"
        out = pdir / "clips" / f"clip_{cid}.mp4"
        source = pdir / "source.mp4"

        # For URL projects, fetch the full video once on first export and cache it
        # (analysis/preview stayed on audio+proxy only). All renders reuse source.mp4.
        if source_type == "url" and not source.exists():
            _set_clip(cid, stage="Downloading video (one-time)")
            ingest.download_full(source_url, source)

        _set_clip(cid, stage="Rendering")
        if abs(center - 0.5) < 1e-6:
            center = reframe.detect_center(source, start, end)
        out_w, out_h = settings.output_dims(aspect, resolution)
        vo_path = Path(voiceover) if voiceover else None
        segments = render.kept_segments(start, end, cuts)
        # Opt-in AI auto-effects. Remap the source-time zoom/sfx keyframes onto the edited
        # (post-cut) timeline; empty when the clip has none → render is unchanged.
        zoom_kfs = render.remap_keyframes_for_cuts(effects.get("zoom", []), segments)
        sfx_cues = render.remap_keyframes_for_cuts(effects.get("sfx", []), segments)
        # Cinematic Look + big title (opt-in, one place). Both empty on a clip nobody
        # applied them to → the ffmpeg command and the .ass are exactly what they were.
        look_cfg = effects.get("look") or {}
        grade = look.look_filter(look_cfg.get("id"), look_cfg.get("strength", look.DEFAULT_STRENGTH))
        title = look.normalize_title(effects.get("title"))
        if markers and any(scene_vos):
            # Per-scene voice-first reel: re-time each scene to its own recorded voice.
            # Honor the trim: clamp every scene to [start,end], drop scenes trimmed away,
            # keep scene_vos aligned — so a trimmed reel starts/ends where the user set it
            # (a scene whose front was trimmed is recorded + rendered FROM the trim point).
            cl_markers, cl_vos = [], []
            for i, m in enumerate(markers):
                ms, me = max(float(m["start"]), start), min(float(m["end"]), end)
                if me - ms > 0.2:
                    cl_markers.append({**m, "start": round(ms, 3), "end": round(me, 3)})
                    cl_vos.append(scene_vos[i] if i < len(scene_vos) else None)
            if cl_markers and any(cl_vos):
                assemble.render_scene_reel(source, out, cl_markers, words, cl_vos, preset,
                                           style, out_w=out_w, out_h=out_h, cuts=cuts,
                                           look=grade, title=title)
            else:
                # Whole reel trimmed off its voiced scenes → plain trimmed-range render.
                caps.write_ass(words, start, end, preset, ass, overrides=style, title=title)
                render.render_clip(source, out, start, end, aspect, ass, center,
                                   out_w=out_w, out_h=out_h, voiceover=vo_path, zoom=zoom_kfs,
                                   look=grade)
        elif cuts and len(segments) != 1:
            # Middle parts removed → concat kept segments + retime captions.
            # ASS keeps the 1080×1920 PlayRes baseline; libass scales it to the frame.
            local_words, total = render.remap_words_for_cuts(words, segments)
            caps.write_ass(local_words, 0.0, total, preset, ass, overrides=style, title=title)
            render.render_clip_segments(source, out, segments, aspect, ass, center,
                                        out_w=out_w, out_h=out_h, voiceover=vo_path, zoom=zoom_kfs,
                                        look=grade)
        else:
            # No cuts → unchanged single-range fast path.
            caps.write_ass(words, start, end, preset, ass, overrides=style, title=title)
            render.render_clip(source, out, start, end, aspect, ass, center,
                               out_w=out_w, out_h=out_h, voiceover=vo_path, zoom=zoom_kfs,
                               look=grade)

        # SFX: isolated post-pass (no-op without cues; a failure keeps the clean render).
        if sfx_cues:
            render.mix_sfx(out, sfx_cues, settings.BACKEND_DIR / "assets" / "sfx")

        with get_session() as s:
            clip = s.get(Clip, cid)
            clip.status = "rendered"
            clip.stage = ""
            clip.output_path = str(out)
            clip.crop_center = center
            s.add(clip)
            s.commit()
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        _set_clip(cid, status="error", stage="", error=f"{type(e).__name__}: {e}")


@app.post("/api/clips/{cid}/render")
def render_clip_route(cid: int):
    with get_session() as s:
        if not s.get(Clip, cid):
            raise HTTPException(404, "clip not found")
    _render_pool.submit(_render_clip_job, cid)
    return {"status": "rendering"}


@app.post("/api/clips/{cid}/voiceover")
async def upload_clip_voiceover(cid: int, file: UploadFile = File(...)):
    """Save a recorded/uploaded voiceover for a clip (normalized to wav). Render then
    muxes it as the clip's audio instead of the source audio."""
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        pid = clip.project_id
    mdir = settings.project_dir(pid)
    mdir.mkdir(parents=True, exist_ok=True)
    raw = mdir / f"clip_{cid}_vo_raw"
    with raw.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    wav = mdir / f"clip_{cid}_voiceover.wav"
    try:
        ingest.extract_voiceover(raw, wav)      # webm/whatever → 48k stereo wav
    finally:
        raw.unlink(missing_ok=True)
    with get_session() as s:
        clip = s.get(Clip, cid)
        clip.voiceover_path = str(wav)
        clip.status = "suggested"           # invalidate any previous render
        s.add(clip); s.commit()
    return {"voiceover_path": str(wav)}


class TTSBody(BaseModel):
    voice_id: Optional[str] = None
    text: Optional[str] = None       # override; default = the clip's own transcript


@app.get("/api/tts/voices")
def tts_voices():
    """Available ElevenLabs voices for the editor's picker (+ whether TTS is configured)."""
    from .pipeline import tts
    return {"available": tts.available(), "default": settings.ELEVENLABS_VOICE_ID,
            "voices": tts.list_voices()}


@app.post("/api/clips/{cid}/tts-voiceover")
def clip_tts_voiceover(cid: int, body: TTSBody):
    """Read the clip's transcript into a voiceover via ElevenLabs and store it as the clip's
    voice (same slot as a recorded take → render muxes it). Text defaults to the clip's caption
    words; pass `text` to override with exactly what's on screen right now."""
    from .pipeline import tts
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        pid, start, end = clip.project_id, clip.start, clip.end
        words = json.loads(clip.words_json) if clip.words_json else [
            w for w in get_words(pid) if w["end"] > start and w["start"] < end]
    text = (body.text or "").strip() or " ".join(w.get("word", "") for w in words).strip()
    if not text:
        raise HTTPException(400, "no transcript to read — add captions first")
    mdir = settings.project_dir(pid); mdir.mkdir(parents=True, exist_ok=True)
    mp3 = mdir / f"clip_{cid}_tts.mp3"
    wav = mdir / f"clip_{cid}_voiceover.wav"
    try:
        tts.synthesize(text, mp3, body.voice_id)
        ingest.extract_voiceover(mp3, wav)          # mp3 → 48k stereo wav
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"voice generation failed: {e}")
    finally:
        mp3.unlink(missing_ok=True)
    with get_session() as s:
        clip = s.get(Clip, cid)
        clip.voiceover_path = str(wav)
        clip.scene_vo_json = None      # one read for the WHOLE reel wins over any per-scene voices
        clip.status = "suggested"
        s.add(clip); s.commit()
    return {"voiceover_path": str(wav)}


@app.get("/api/clips/{cid}/voiceover-file")
def clip_voiceover_file(cid: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip or not clip.voiceover_path or not Path(clip.voiceover_path).exists():
            raise HTTPException(404, "no voiceover for this clip")
        return FileResponse(clip.voiceover_path, media_type="audio/wav")


@app.delete("/api/clips/{cid}/voiceover")
def delete_clip_voiceover(cid: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        if clip.voiceover_path:
            Path(clip.voiceover_path).unlink(missing_ok=True)
        clip.voiceover_path = None
        clip.status = "suggested"
        s.add(clip); s.commit()
    return {"ok": True}


def _scene_count(clip: Clip) -> int:
    return len(json.loads(clip.markers_json)) if clip.markers_json else 0


def _load_scene_vos(clip: Clip) -> list:
    vos = json.loads(clip.scene_vo_json) if clip.scene_vo_json else []
    n = _scene_count(clip)
    if len(vos) < n:
        vos = vos + [None] * (n - len(vos))
    return vos


@app.post("/api/clips/{cid}/scene-voiceover/{idx}")
async def upload_scene_voiceover(cid: int, idx: int, file: UploadFile = File(...)):
    """Save a recorded voiceover for one scene of a stitched reel."""
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        if idx < 0 or idx >= _scene_count(clip):
            raise HTTPException(400, "scene index out of range")
        pid = clip.project_id
    mdir = settings.project_dir(pid)
    mdir.mkdir(parents=True, exist_ok=True)
    raw = mdir / f"clip_{cid}_scene_{idx}_raw"
    with raw.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    wav = mdir / f"clip_{cid}_scene_{idx}.wav"
    try:
        ingest.extract_voiceover(raw, wav)
    finally:
        raw.unlink(missing_ok=True)
    with get_session() as s:
        clip = s.get(Clip, cid)
        vos = _load_scene_vos(clip)
        vos[idx] = str(wav)
        clip.scene_vo_json = json.dumps(vos)
        clip.status = "suggested"
        s.add(clip); s.commit()
    return {"voiceover_path": str(wav), "scene_vos": vos}


@app.get("/api/clips/{cid}/scene-voiceover/{idx}")
def scene_voiceover_file(cid: int, idx: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        vos = _load_scene_vos(clip)
        path = vos[idx] if 0 <= idx < len(vos) else None
        if not path or not Path(path).exists():
            raise HTTPException(404, "no voiceover for this scene")
        return FileResponse(path, media_type="audio/wav")


@app.post("/api/clips/{cid}/scene-tts/{idx}")
def scene_tts_voiceover(cid: int, idx: int, body: TTSBody):
    """Generate an ElevenLabs voice for ONE scene of a stitched reel and store it in that
    scene's slot (the same place a recorded scene take lands). Text defaults to the scene's
    own caption words (sliced by its marker), so 'record it or generate it' is one flow —
    per scene for reels, whole-clip for long-form."""
    from .pipeline import tts
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        markers = json.loads(clip.markers_json) if clip.markers_json else []
        if idx < 0 or idx >= len(markers):
            raise HTTPException(400, "scene index out of range")
        m = markers[idx]
        pid = clip.project_id
        words = json.loads(clip.words_json) if clip.words_json else get_words(pid)
    ms, me = float(m["start"]), float(m["end"])
    scene_words = [w for w in words if w.get("end", 0) > ms and w.get("start", 0) < me]
    text = ((body.text or "").strip()
            or " ".join(w.get("word", "") for w in scene_words).strip()
            or (m.get("label") or "").strip())
    if not text:
        raise HTTPException(400, "no words for this scene to read")
    mdir = settings.project_dir(pid); mdir.mkdir(parents=True, exist_ok=True)
    mp3 = mdir / f"clip_{cid}_scene_{idx}_tts.mp3"
    wav = mdir / f"clip_{cid}_scene_{idx}.wav"       # same slot a recorded scene take uses
    try:
        tts.synthesize(text, mp3, body.voice_id)
        ingest.extract_voiceover(mp3, wav)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"voice generation failed: {e}")
    finally:
        mp3.unlink(missing_ok=True)
    with get_session() as s:
        clip = s.get(Clip, cid)
        vos = _load_scene_vos(clip)
        vos[idx] = str(wav)
        clip.scene_vo_json = json.dumps(vos)
        clip.status = "suggested"
        s.add(clip); s.commit()
    return {"voiceover_path": str(wav), "scene_vos": vos}


@app.delete("/api/clips/{cid}/scene-voiceover/{idx}")
def delete_scene_voiceover(cid: int, idx: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        vos = _load_scene_vos(clip)
        if 0 <= idx < len(vos) and vos[idx]:
            Path(vos[idx]).unlink(missing_ok=True)
            vos[idx] = None
            clip.scene_vo_json = json.dumps(vos)
            clip.status = "suggested"
            s.add(clip); s.commit()
    return {"ok": True}


@app.delete("/api/clips/{cid}")
def delete_clip(cid: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        pid = clip.project_id
        s.delete(clip)
        s.commit()
    # best-effort cleanup of this clip's render artifacts
    cdir = settings.project_dir(pid) / "clips"
    for f in cdir.glob(f"clip_{cid}.*"):
        f.unlink(missing_ok=True)
    return {"deleted": cid}


@app.get("/api/clips/{cid}/download")
def download_clip(cid: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip or not clip.output_path or not Path(clip.output_path).exists():
            raise HTTPException(404, "rendered clip not available")
        return FileResponse(clip.output_path, media_type="video/mp4",
                            filename=f"{clip.title or 'clip'}.mp4")


@app.get("/api/clips/{cid}/preview")
def preview_clip(cid: int):
    """Stream the rendered clip inline (range-enabled) for the editor player."""
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip or not clip.output_path or not Path(clip.output_path).exists():
            raise HTTPException(404, "rendered clip not available")
        return FileResponse(clip.output_path, media_type="video/mp4")


def _make_thumb(src: Path, out: Path, t: float, aspect: str, center: float) -> None:
    import subprocess
    from .pipeline.reframe import crop_filter, probe_size
    sw, sh = probe_size(src)
    vf = crop_filter(sw, sh, aspect, center, 360, 640)
    subprocess.run(["ffmpeg", "-y", "-ss", f"{max(0, t):.2f}", "-i", str(src),
                    "-vf", vf, "-frames:v", "1", "-q:v", "4", str(out)],
                   capture_output=True)


def _preview_source(pid: int) -> Optional[Path]:
    pdir = settings.project_dir(pid)
    for name in ("proxy.mp4", "source.mp4"):
        f = pdir / name
        if f.exists():
            return f
    return None


@app.get("/api/clips/{cid}/thumb")
def clip_thumb(cid: int):
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        pid, start, end = clip.project_id, clip.start, clip.end
        aspect, center = clip.aspect, clip.crop_center
    thumb = settings.project_dir(pid) / "clips" / f"clip_{cid}.jpg"
    if not thumb.exists():
        src = _preview_source(pid)
        if not src:
            raise HTTPException(404, "no source for thumbnail yet")
        _make_thumb(src, thumb, (start + end) / 2, aspect, center)
    if not thumb.exists():
        raise HTTPException(404, "thumbnail unavailable")
    return FileResponse(str(thumb), media_type="image/jpeg")


@app.get("/api/projects/{pid}/thumb")
def project_thumb(pid: int):
    pdir = settings.project_dir(pid)
    thumb = pdir / "thumb.jpg"
    if not thumb.exists():
        src = _preview_source(pid)
        if not src:
            raise HTTPException(404, "no source for thumbnail yet")
        dur = ingest.probe_duration(src)
        _make_thumb(src, thumb, dur / 3 if dur else 1.0, "9:16", 0.5)
    if not thumb.exists():
        raise HTTPException(404, "thumbnail unavailable")
    return FileResponse(str(thumb), media_type="image/jpeg")


def _make_frame(src: Path, out: Path, t: float, w: int = 160) -> None:
    """Small full-frame (source aspect) JPG at time t — for the editor filmstrip."""
    import subprocess
    subprocess.run(["ffmpeg", "-y", "-ss", f"{max(0, t):.2f}", "-i", str(src),
                    "-vf", f"scale={w}:-2", "-frames:v", "1", "-q:v", "5", str(out)],
                   capture_output=True)


@app.get("/api/projects/{pid}/frame")
def project_frame(pid: int, t: float = 0.0):
    """One small cached filmstrip frame at time t (seconds), for the editor timeline."""
    src = _preview_source(pid)
    if not src:
        raise HTTPException(404, "no source yet")
    fdir = settings.project_dir(pid) / "frames"
    fdir.mkdir(exist_ok=True)
    out = fdir / f"f_{int(max(0, t) * 1000)}.jpg"
    if not out.exists():
        _make_frame(src, out, t)
    if not out.exists():
        raise HTTPException(404, "frame unavailable")
    return FileResponse(str(out), media_type="image/jpeg")


@app.post("/api/clips/{cid}/auto-center")
def clip_auto_center(cid: int):
    """Detect a face-based 9:16 crop center for the clip range (runs on the proxy)."""
    with get_session() as s:
        clip = s.get(Clip, cid)
        if not clip:
            raise HTTPException(404, "clip not found")
        pid, start, end = clip.project_id, clip.start, clip.end
    src = _preview_source(pid)
    if not src:
        raise HTTPException(404, "no source yet")
    center = reframe.detect_center(src, start, end)
    return {"center": round(float(center), 4)}


@app.get("/api/projects/{pid}/source")
def project_source(pid: int):
    """Stream the preview video (range-enabled): the 360p proxy for URL projects,
    the uploaded source for file projects."""
    pdir = settings.project_dir(pid)
    for name in ("proxy.mp4", "source.mp4"):
        f = pdir / name
        if f.exists():
            return FileResponse(str(f), media_type="video/mp4")
    raise HTTPException(404, "preview not available yet")


@app.delete("/api/projects/{pid}")
def delete_project(pid: int):
    """Delete a project: its DB rows (project + clips) and its data folder."""
    from sqlmodel import select
    with get_session() as s:
        proj = s.get(Project, pid)
        if not proj:
            raise HTTPException(404, "project not found")
        for clip in s.exec(select(Clip).where(Clip.project_id == pid)).all():
            s.delete(clip)
        s.delete(proj)
        s.commit()
    shutil.rmtree(settings.PROJECTS_DIR / str(pid), ignore_errors=True)
    return {"deleted": pid}


@app.get("/api/presets")
def list_presets():
    from dataclasses import asdict

    from .pipeline import tts
    _labels = {"1080p": "1080p", "1440p": "1440p (2K)", "4k": "4K"}
    resolutions = []
    for rid in settings.RESOLUTIONS:
        w, h = settings.output_dims("9:16", rid)
        resolutions.append({"id": rid, "label": _labels.get(rid, rid),
                            "hint": f"{w}×{h}"})
    return {"captions": list(caps.PRESETS.keys()),
            "caption_styles": {k: asdict(v) for k, v in caps.PRESETS.items()},
            "aspects": list(reframe.ASPECTS.keys()),
            "brains": ["openai", "claude", "ollama", "gemini", "heuristic"],
            "brains_default": settings.DEFAULT_BRAIN,
            "transcribe": ["local", "elevenlabs"],
            "transcribe_default": settings.DEFAULT_TRANSCRIBE,
            "resolutions": resolutions,
            # Cinematic Look presets + big-title placements (mirrored in frontend/src/looks.ts).
            "looks": [{"id": l.id, "label": l.label, "hint": l.hint} for l in look.LOOKS],
            "title_places": [{"id": p.id, "label": p.label} for p in look.PLACES],
            "title_styles": look.TITLE_STYLES,
            "stages": STAGES,
            "formats": sorted(_TICKET_FORMATS),
            "capture_modes": sorted(_CAPTURE_MODES),
            # Just the key check, no call out to ElevenLabs — /api/tts/voices does the
            # round trip and is only worth it when you actually need the voice list.
            "tts_available": tts.available()}


@app.get("/api/health")
def health():
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Single-port serving (multi-device). Once the frontend is built (`npm run build`),
# the backend also serves the UI, so the whole app lives at ONE url (:8000) — no
# separate Vite server, no CORS. Reachable from another device by running uvicorn
# with `--host 0.0.0.0` and opening http://<this-machine>:8000. Mounted LAST so it
# never shadows the /api routes above. Dev still uses the Vite server on :3000 when
# dist/ is absent.
# --------------------------------------------------------------------------- #
_FRONTEND_DIST = settings.PROJECT_ROOT / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
