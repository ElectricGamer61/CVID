"""SQLite models + engine for Cvideo."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel, create_engine, Session

import settings


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    source_type: str = "url"          # url | file
    source_url: Optional[str] = None
    brain: str = settings.DEFAULT_BRAIN
    transcribe_backend: str = settings.DEFAULT_TRANSCRIBE  # local | elevenlabs
    aspect: str = "9:16"
    caption_preset: str = "capcut"
    status: str = "created"           # created|ingesting|transcribing|analyzing|ready|error
    stage: str = ""                   # human-readable current step
    progress: int = 0                 # 0-100
    error: Optional[str] = None
    duration: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Clip(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(index=True, foreign_key="project.id")
    idx: int = 0
    start: float = 0.0
    end: float = 0.0
    title: str = ""
    score: float = 0.0
    hook: str = ""              # the scroll-stopping line from the brain
    reason: str = ""
    aspect: str = "9:16"
    caption_preset: str = "capcut"
    resolution: str = settings.DEFAULT_RESOLUTION  # 1080p | 1440p | 4k
    crop_center: float = 0.5          # horizontal crop center, 0..1
    status: str = "suggested"         # suggested|rendering|rendered|error
    stage: str = ""                   # human-readable render step (e.g. "Downloading video")
    output_path: Optional[str] = None
    error: Optional[str] = None
    # JSON caption-style overrides (font/size/color/highlight/position/max_words).
    # None -> use the clip's caption_preset as-is.
    style_json: Optional[str] = None
    # JSON list of edited caption words [{start,end,word}] for THIS clip.
    # None -> use the project transcript words.
    words_json: Optional[str] = None


_engine = create_engine(f"sqlite:///{settings.DB_PATH}", echo=False,
                        connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(_engine)
    _migrate()


def _migrate() -> None:
    """Tiny additive migration: add columns that create_all won't add to an
    existing table."""
    from sqlalchemy import text
    wanted = {
        "clip": {"style_json": "TEXT", "words_json": "TEXT", "stage": "TEXT DEFAULT ''",
                 "hook": "TEXT DEFAULT ''",
                 "resolution": f"TEXT DEFAULT '{settings.DEFAULT_RESOLUTION}'"},
        "project": {"transcribe_backend": "TEXT DEFAULT 'local'"},
    }
    with _engine.connect() as conn:
        for table, cols in wanted.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for col, decl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {decl}"))
        conn.commit()


def get_session() -> Session:
    return Session(_engine)
