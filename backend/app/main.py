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
from fastapi.responses import FileResponse
from pydantic import BaseModel

import settings
from . import intake
from .db import Beat, Clip, Project, Ticket, get_session, init_db
from .jobs import get_words, submit_analyze
from .pipeline import captions as caps
from .pipeline import ingest, reframe, render

app = FastAPI(title="Cvideo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"], allow_headers=["*"],
)

_render_pool = ThreadPoolExecutor(max_workers=2)


@app.on_event("startup")
def _startup():
    init_db()


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class CreateProject(BaseModel):
    name: str
    source_url: str
    brain: str = settings.DEFAULT_BRAIN
    transcribe_backend: str = settings.DEFAULT_TRANSCRIBE
    aspect: str = "9:16"
    caption_preset: str = "capcut"


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


class BeatPatch(BaseModel):
    spoken_line: Optional[str] = None
    on_screen_text: Optional[str] = None
    caption: Optional[str] = None
    shot_cue: Optional[str] = None
    order_index: Optional[int] = None
    is_proof_beat: Optional[bool] = None   # manual override of the auto proof-flag


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
                        status="created")
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
    aspect: str = Form("9:16"), caption_preset: str = Form("capcut"),
    file: UploadFile = File(...),
):
    tmp = Path(tempfile.gettempdir()) / f"cvideo_upload_{file.filename}"
    with tmp.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    with get_session() as s:
        proj = Project(name=name, source_type="file", brain=brain,
                        transcribe_backend=transcribe_backend, aspect=aspect,
                        caption_preset=caption_preset, status="created")
        s.add(proj)
        s.commit()
        s.refresh(proj)
        pid = proj.id
    submit_analyze(pid, upload_path=str(tmp))
    return {"id": pid}


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


@app.get("/api/tickets")
def list_tickets():
    from sqlmodel import select
    with get_session() as s:
        rows = s.exec(select(Ticket).order_by(Ticket.id.desc())).all()
        return [t.model_dump() for t in rows]


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


@app.get("/api/exports")
def list_exports():
    """Every rendered output across the app — project clips + assembled ticket reels.
    Powers the Library/Exports screen."""
    from sqlmodel import select
    out = []
    with get_session() as s:
        for c in s.exec(select(Clip).where(Clip.status == "rendered")).all():
            proj = s.get(Project, c.project_id)
            out.append({"kind": "clip", "id": c.id,
                        "title": c.title or f"Clip {c.idx + 1}",
                        "subtitle": proj.name if proj else "",
                        "score": round(c.score), "download": f"/api/clips/{c.id}/download",
                        "thumb": f"/api/clips/{c.id}/thumb"})
        for t in s.exec(select(Ticket).where(Ticket.clip_url.is_not(None))).all():
            out.append({"kind": "reel", "id": t.id,
                        "title": t.angle or f"Reel {t.id}",
                        "subtitle": f"{t.brand} · native", "score": None,
                        "download": f"/api/tickets/{t.id}/download", "thumb": None})
    return out


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
        if style is not None:
            clip.style_json = json.dumps(style)
        if words is not None:
            clip.words_json = json.dumps(words)
        for k, v in data.items():
            setattr(clip, k, v)
        clip.status = "suggested"  # edits invalidate any previous render
        s.add(clip)
        s.commit()
        s.refresh(clip)
        return clip.model_dump()


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
        caps.write_ass(words, start, end, preset, ass, overrides=style)
        out_w, out_h = settings.output_dims(aspect, resolution)
        render.render_clip(source, out, start, end, aspect, ass, center,
                           out_w=out_w, out_h=out_h)

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
    _labels = {"1080p": "1080p", "1440p": "1440p (2K)", "4k": "4K"}
    resolutions = []
    for rid in settings.RESOLUTIONS:
        w, h = settings.output_dims("9:16", rid)
        resolutions.append({"id": rid, "label": _labels.get(rid, rid),
                            "hint": f"{w}×{h}"})
    return {"captions": list(caps.PRESETS.keys()),
            "caption_styles": {k: asdict(v) for k, v in caps.PRESETS.items()},
            "aspects": list(reframe.ASPECTS.keys()),
            "brains": ["ollama", "gemini", "heuristic"],
            "transcribe": ["local", "elevenlabs"],
            "resolutions": resolutions,
            "stages": STAGES,
            "formats": sorted(_TICKET_FORMATS),
            "capture_modes": sorted(_CAPTURE_MODES)}


@app.get("/api/health")
def health():
    return {"ok": True}
