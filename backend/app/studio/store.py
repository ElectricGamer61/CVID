"""Studio projects on disk: one folder per project, one project.json per folder.

    data/studio/<pid>/project.json      the project (schema below), written atomically
    data/studio/<pid>/media/<cid>.<ext> the original clips, byte-for-byte as uploaded
    data/studio/<pid>/clips/<cid>/      what Studio derives from each clip:
        audio.wav    16 kHz mono, for the speech engine
        words.json   the verbatim transcript
        energy.bin   loudness every 10 ms (uint8 dB + 100), for snapping cuts into silence
        proxy.mp4    a 720p copy that scrubs instantly
        thumb.jpg
    data/studio/<pid>/exports/          finished renders

Two kinds of writer touch project.json: the editor (cuts, name, settings) and the
processing threads (what is ready). They never fight: every write goes through `mutate`
under the project's lock, and the editor's own changes carry `edit_rev` so a stale tab
cannot silently overwrite a newer edit from another one.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, Field

import settings

SCHEMA_VERSION = 1
_ID_RE = re.compile(r"^[0-9a-f]{8}$")


class Clip(BaseModel):
    id: str
    name: str                      # the file name the user gave it
    file: str                      # media path, relative to the project folder
    size: int = 0
    duration: float = 0.0
    width: int = 0                 # as displayed (phone rotation already applied)
    height: int = 0
    fps: str = ""                  # rational, e.g. "30000/1001"
    has_audio: bool = True
    vfr: bool = False              # variable frame rate (phones): NLEs drift on it
    recorded_at: str = ""          # creation_time from the file, when it has one
    proxy: Literal["pending", "done", "error"] = "pending"
    transcript: Literal["pending", "done", "error", "none"] = "pending"  # none = no sound
    engine: str = ""               # which speech engine wrote words.json
    error: str = ""


class Cut(BaseModel):
    clip: str
    start: float                   # seconds, in the clip's own time
    end: float
    reason: str = "manual"         # manual | filler | stutter | repeat | pause | retake | dead


class Project(BaseModel):
    version: int = SCHEMA_VERSION
    id: str
    name: str
    created: str
    updated: str
    edit_rev: int = 0              # bumped only by editor writes (see module docstring)
    clips: list[Clip] = Field(default_factory=list)   # timeline order
    cuts: list[Cut] = Field(default_factory=list)
    settings: dict = Field(default_factory=dict)


class NotFound(Exception):
    pass


class StaleEdit(Exception):
    def __init__(self, current: Project):
        super().__init__("project changed since this edit was based on it")
        self.current = current


_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def _lock(pid: str) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault(pid, threading.RLock())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def root() -> Path:
    settings.STUDIO_DIR.mkdir(parents=True, exist_ok=True)
    return settings.STUDIO_DIR


def project_dir(pid: str) -> Path:
    if not _ID_RE.match(pid):           # ids become paths: never let one escape the root
        raise NotFound(pid)
    return root() / pid


def clip_dir(pid: str, cid: str) -> Path:
    if not _ID_RE.match(cid):
        raise NotFound(cid)
    d = project_dir(pid) / "clips" / cid
    d.mkdir(parents=True, exist_ok=True)
    return d


def media_path(pid: str, clip: Clip) -> Path:
    return project_dir(pid) / clip.file


def new_id() -> str:
    return secrets.token_hex(4)


def _write(p: Project) -> None:
    d = project_dir(p.id)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "project.json.tmp"
    tmp.write_text(p.model_dump_json(indent=1), encoding="utf-8")
    os.replace(tmp, d / "project.json")   # atomic: a crash leaves the old file, never half


def load(pid: str) -> Project:
    f = project_dir(pid) / "project.json"
    if not f.exists():
        raise NotFound(pid)
    return Project.model_validate_json(f.read_text(encoding="utf-8"))


def create(name: str) -> Project:
    now = _now()
    p = Project(id=new_id(), name=(name or "").strip() or "Untitled", created=now, updated=now)
    _write(p)
    return p


def list_projects() -> list[Project]:
    out = []
    for d in root().iterdir():
        if d.is_dir() and _ID_RE.match(d.name) and (d / "project.json").exists():
            try:
                out.append(load(d.name))
            except Exception as e:  # noqa: BLE001 - one bad file must not hide the rest
                print(f"[studio] skipping unreadable project {d.name}: {e}")
    return sorted(out, key=lambda p: p.updated, reverse=True)


def delete(pid: str) -> None:
    d = project_dir(pid)
    with _lock(pid):
        if not d.exists():
            raise NotFound(pid)
        shutil.rmtree(d)


def mutate(pid: str, fn: Callable[[Project], None], *, base_rev: int | None = None) -> Project:
    """Load, change, save under the project's lock. `base_rev` marks an editor write: it
    must match the stored edit_rev (else StaleEdit) and bumps it."""
    with _lock(pid):
        p = load(pid)
        if base_rev is not None:
            if base_rev != p.edit_rev:
                raise StaleEdit(p)
            p.edit_rev += 1
        fn(p)
        p.updated = _now()
        _write(p)
        return p


def update_clip(pid: str, cid: str, **fields) -> Project:
    def apply(p: Project) -> None:
        for c in p.clips:
            if c.id == cid:
                for k, v in fields.items():
                    setattr(c, k, v)
                return
        raise NotFound(cid)
    return mutate(pid, apply)


def find_clip(p: Project, cid: str) -> Clip:
    for c in p.clips:
        if c.id == cid:
            return c
    raise NotFound(cid)
