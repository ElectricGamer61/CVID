"""Studio REST API, mounted at /api/studio by app.main."""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from . import engines, export, processing, store

router = APIRouter(prefix="/api/studio")

MEDIA_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts", ".m2ts", ".mxf",
             ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"}


def _project(pid: str) -> store.Project:
    try:
        return store.load(pid)
    except store.NotFound:
        raise HTTPException(404, "project not found")


def _view(p: store.Project) -> dict:
    d = p.model_dump()
    for c in d["clips"]:
        c["progress"] = processing.progress.get((p.id, c["id"]), {})
    d["export"] = export.status(p.id)
    fmt = export.target_format(p)
    d["export_format"] = {k: fmt[k] for k in ("width", "height", "fps")}   # JSON-safe only
    return d


@router.get("/engines")
def get_engines():
    avail = engines.availability()
    chain = engines.chain()
    return {"order": engines.ENGINE_ORDER, "engines": avail,
            "default": chain[0] if chain else None}


@router.get("/projects")
def list_projects():
    out = []
    for p in store.list_projects():
        first = next((c for c in p.clips if c.proxy == "done"), None)
        out.append({"id": p.id, "name": p.name, "updated": p.updated, "clips": len(p.clips),
                    "duration": round(sum(c.duration for c in p.clips), 1),
                    "thumb_clip": first.id if first else None})
    return {"projects": out}


class NewProject(BaseModel):
    name: str = ""


@router.post("/projects")
def create_project(body: NewProject):
    return _view(store.create(body.name))


@router.get("/projects/{pid}")
def get_project(pid: str):
    return _view(_project(pid))


class CutIn(BaseModel):
    clip: str
    start: float
    end: float
    reason: str = "manual"


class ProjectEdit(BaseModel):
    edit_rev: int
    name: Optional[str] = None
    cuts: Optional[list[CutIn]] = None
    settings: Optional[dict] = None
    clip_order: Optional[list[str]] = None


@router.patch("/projects/{pid}")
def edit_project(pid: str, body: ProjectEdit):
    _project(pid)

    def apply(p: store.Project) -> None:
        if body.name is not None:
            p.name = body.name.strip() or p.name
        if body.cuts is not None:
            ids = {c.id for c in p.clips}
            p.cuts = [store.Cut(**c.model_dump()) for c in body.cuts
                      if c.clip in ids and c.end > c.start]
        if body.settings is not None:
            p.settings = {**p.settings, **body.settings}
        if body.clip_order is not None:
            pos = {cid: i for i, cid in enumerate(body.clip_order)}
            p.clips.sort(key=lambda c: pos.get(c.id, len(pos)))
    try:
        return _view(store.mutate(pid, apply, base_rev=body.edit_rev))
    except store.StaleEdit as e:
        return JSONResponse({"detail": "stale", "project": _view(e.current)}, status_code=409)


@router.delete("/projects/{pid}")
def delete_project(pid: str):
    export.cancel(pid)
    try:
        store.delete(pid)
    except store.NotFound:
        raise HTTPException(404, "project not found")
    return {"ok": True}


@router.post("/projects/{pid}/clips")
def add_clips(pid: str, files: list[UploadFile] = File(...)):
    _project(pid)
    added: list[store.Clip] = []
    media_dir = store.project_dir(pid) / "media"
    media_dir.mkdir(exist_ok=True)
    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in MEDIA_EXT:
            raise HTTPException(400, f"{f.filename}: not a video or audio file Studio can read")
        cid = store.new_id()
        dest = media_dir / f"{cid}{ext}"
        with open(dest, "wb") as out:
            shutil.copyfileobj(f.file, out, length=8 * 1024 * 1024)
        added.append(store.Clip(id=cid, name=Path(f.filename or cid).stem,
                                file=f"media/{cid}{ext}", size=dest.stat().st_size))

    def apply(p: store.Project) -> None:
        p.clips.extend(added)
        p.edit_rev += 1           # the timeline changed under any open editor
    p = store.mutate(pid, apply)
    for c in added:
        processing.enqueue(pid, c.id)
    return _view(p)


@router.delete("/projects/{pid}/clips/{cid}")
def delete_clip(pid: str, cid: str):
    p = _project(pid)
    clip = next((c for c in p.clips if c.id == cid), None)
    if clip is None:
        raise HTTPException(404, "clip not found")

    def apply(p: store.Project) -> None:
        p.clips = [c for c in p.clips if c.id != cid]
        p.cuts = [c for c in p.cuts if c.clip != cid]
        p.edit_rev += 1
    p = store.mutate(pid, apply)
    store.media_path(pid, clip).unlink(missing_ok=True)
    shutil.rmtree(store.project_dir(pid) / "clips" / cid, ignore_errors=True)
    return _view(p)


@router.post("/projects/{pid}/clips/{cid}/retry")
def retry_clip(pid: str, cid: str):
    try:
        processing.retry(pid, cid)
    except store.NotFound:
        raise HTTPException(404, "clip not found")
    return _view(_project(pid))


@router.post("/projects/{pid}/clips/{cid}/retranscribe")
def retranscribe_clip(pid: str, cid: str):
    try:
        processing.retranscribe(pid, cid)
    except store.NotFound:
        raise HTTPException(404, "clip not found")
    return _view(_project(pid))


def _clip_file(pid: str, cid: str, name: str) -> Path:
    try:
        f = store.project_dir(pid) / "clips" / cid / name
        store.clip_dir(pid, cid)                 # validates the ids
    except store.NotFound:
        raise HTTPException(404, "not found")
    if not f.exists():
        raise HTTPException(404, f"{name} is not ready yet")
    return f


@router.get("/projects/{pid}/clips/{cid}/proxy")
def clip_proxy(pid: str, cid: str):
    return FileResponse(_clip_file(pid, cid, "proxy.mp4"), media_type="video/mp4")


@router.get("/projects/{pid}/clips/{cid}/thumb")
def clip_thumb(pid: str, cid: str):
    return FileResponse(_clip_file(pid, cid, "thumb.jpg"), media_type="image/jpeg")


@router.get("/projects/{pid}/clips/{cid}/words")
def clip_words(pid: str, cid: str):
    return json.loads(_clip_file(pid, cid, "words.json").read_text(encoding="utf-8"))


@router.get("/projects/{pid}/clips/{cid}/energy")
def clip_energy(pid: str, cid: str):
    """Loudness every 10 ms as bytes: value = round(dB) + 100."""
    return Response(_clip_file(pid, cid, "energy.bin").read_bytes(),
                    media_type="application/octet-stream")


def _words_of(pid: str):
    def read(cid: str) -> list[dict]:
        f = store.project_dir(pid) / "clips" / cid / "words.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    return read


@router.post("/projects/{pid}/export")
def start_export(pid: str):
    _project(pid)
    try:
        return export.start(pid, _words_of(pid))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/projects/{pid}/export")
def export_status(pid: str):
    return export.status(pid)


@router.post("/projects/{pid}/export/cancel")
def cancel_export(pid: str):
    export.cancel(pid)
    return export.status(pid)


@router.get("/projects/{pid}/export/file")
def export_file(pid: str, kind: str = "mp4"):
    st = export.status(pid)
    if st.get("state") != "done":
        raise HTTPException(404, "no finished export")
    name = st["srt"] if kind == "srt" else st["file"]
    f = store.project_dir(pid) / "exports" / name
    if not f.exists():
        raise HTTPException(404, "the export file is gone")
    return FileResponse(f, filename=name,
                        media_type="application/x-subrip" if kind == "srt" else "video/mp4")
