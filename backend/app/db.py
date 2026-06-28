"""SQLite models + engine for Cvideo."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
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
    mode: str = "moments"             # moments (find viral clips) | caption (one full clip)
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
    # JSON list of removed sub-ranges [[a,b],...] (absolute source secs within
    # [start,end]) — the parts cut out of the middle. None/[] -> no cuts.
    cuts_json: Optional[str] = None
    # JSON list of scene boundaries [{start,end,label}] when this clip was built
    # by stitching a reel's scenes — drawn as markers on the editor timeline.
    markers_json: Optional[str] = None
    # Recorded/replaced voiceover for this clip (set in the editor). When present,
    # render muxes it as the audio track instead of the source audio.
    voiceover_path: Optional[str] = None
    # Per-scene voiceovers for a stitched reel — JSON list aligned to markers_json,
    # each entry a wav path or null. When any is set, render re-times each scene to
    # its voice (voice-first timing).
    scene_vo_json: Optional[str] = None
    # User-assigned Downloads folder (drag-to-move). None -> grouped under the project.
    folder: Optional[str] = None


# --------------------------------------------------------------------------- #
# Content-pipeline tables (the 10-order lifecycle that wraps the clip engine).
# Ticket is the spine; everything hangs off it. Project/Clip above are the
# ASSEMBLE output a long-form-clip ticket points at.
# --------------------------------------------------------------------------- #
class Outlier(SQLModel, table=True):
    """Swipe file — a viral reference captured at MINE."""
    id: Optional[int] = Field(default=None, primary_key=True)
    url: str = ""
    hook: str = ""
    structure: str = ""
    why_popped: str = ""
    caption: str = ""
    angle: str = ""
    power_phrases: list = Field(default_factory=list, sa_column=Column(JSON))  # text[]
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Ticket(SQLModel, table=True):
    """One row per piece of content — the lifecycle spine."""
    id: Optional[int] = Field(default=None, primary_key=True)
    brand: str = "NoCrapDiet"          # loads the cartridge
    stage: str = "outlier"             # outlier|scripted|staged|sourced|assembled|ready|scheduled|posted
    angle: str = ""                    # keystone field
    outlier_id: Optional[int] = Field(default=None, foreign_key="outlier.id")
    # intake routing
    format: str = "reel"               # reel | carousel
    capture_mode: str = "native-short" # longform-clip | native-short | repurpose
    # long-form-clip path links to the existing clip engine (native path uses Beats):
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    source_ref: str = ""               # 'LF 02:14' | 'native take 7' | 'b-roll set A'
    hook_text: str = ""                # chosen first-frame hook
    clip_url: Optional[str] = None     # assembler output — BOTH paths write here
    # DEPRECATED — legacy plain POST captions {tt,ig,yt}. Migrated into post_meta;
    # kept only because SQLite can't drop a column. New code should read post_meta.
    captions: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    # Per-platform PUBLISH copy (the "post box") — distinct from Beat.caption (on-screen
    # karaoke text). {tt:{caption,hashtags}, ig:{caption,hashtags}, yt:{title,description,tags}}
    post_meta: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    platforms: list = Field(default_factory=list, sa_column=Column(JSON))   # ['tt','ig','yt']
    scheduled_at: Optional[datetime] = None
    posted_at: Optional[datetime] = None
    # User-assigned Downloads folder (drag-to-move). None -> grouped under the brand.
    folder: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Beat(SQLModel, table=True):
    """The script-as-timeline (native path): one ordered beat = one card."""
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(index=True, foreign_key="ticket.id")
    order_index: int = 0               # position in the script timeline
    spoken_line: str = ""              # voiceover script — teleprompter on the VO screen
    on_screen_text: str = ""           # text overlaid on the video
    caption: str = ""                  # word-synced caption text (TIMED from VO, not transcribed)
    shot_cue: str = ""                 # what to film — shown on the clip-capture view
    clip_path: Optional[str] = None    # uploaded silent video for this beat
    voiceover_path: Optional[str] = None  # recorded VO audio for this beat
    is_proof_beat: bool = False        # states a real number → clip MUST show product/label
    # Per-word caption timing, filled in Phase 4 from the recorded voiceover (the words
    # are known input — `caption` — the audio is only used to time them). e.g.
    # [{word, start, end}, ...]. Nullable until the VO is processed.
    caption_timings: Optional[list] = Field(default=None, sa_column=Column(JSON))


class Perf(SQLModel, table=True):
    """One row per platform per posted ticket (MEASURE)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(index=True, foreign_key="ticket.id")
    platform: str = ""                 # tt | ig | yt
    views: int = 0
    follows: int = 0
    saves: int = 0
    sends: int = 0
    captured_at: datetime = Field(default_factory=datetime.utcnow)


class Angle(SQLModel, table=True):
    """Rollup the board reads for Signal Reader."""
    angle: str = Field(primary_key=True)
    outlier_id: Optional[int] = Field(default=None, foreign_key="outlier.id")
    posts_count: int = 0
    avg_score: float = 0.0             # avg(saves + follows) — the NEEDLE metric, NOT views


_engine = create_engine(f"sqlite:///{settings.DB_PATH}", echo=False,
                        connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(_engine)
    _migrate()
    _backfill_post_meta()


def _migrate() -> None:
    """Tiny additive migration: add columns that create_all won't add to an
    existing table."""
    from sqlalchemy import text
    wanted = {
        "clip": {"style_json": "TEXT", "words_json": "TEXT", "cuts_json": "TEXT",
                 "markers_json": "TEXT", "voiceover_path": "TEXT", "scene_vo_json": "TEXT",
                 "stage": "TEXT DEFAULT ''", "hook": "TEXT DEFAULT ''",
                 "resolution": f"TEXT DEFAULT '{settings.DEFAULT_RESOLUTION}'",
                 "folder": "TEXT"},
        "project": {"transcribe_backend": "TEXT DEFAULT 'local'",
                    "mode": "TEXT DEFAULT 'moments'"},
        "ticket": {"folder": "TEXT", "post_meta": "TEXT"},
        "beat": {"caption_timings": "TEXT"},
    }
    with _engine.connect() as conn:
        for table, cols in wanted.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for col, decl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {decl}"))
        conn.commit()


def _backfill_post_meta() -> None:
    """One-time data migration: fold legacy `Ticket.captions {tt,ig,yt}` (plain strings)
    into the new `post_meta`. Runs only for tickets that have captions but no post_meta yet,
    so it's idempotent and safe on every startup. No code reads post_meta yet — that's the
    P6 publisher rebuild."""
    from sqlmodel import select
    with Session(_engine) as s:
        rows = s.exec(select(Ticket)).all()
        changed = False
        for t in rows:
            if t.post_meta:
                continue
            caps = t.captions if isinstance(t.captions, dict) else None
            if not caps:
                continue
            t.post_meta = {
                "tt": {"caption": caps.get("tt", "") or "", "hashtags": ""},
                "ig": {"caption": caps.get("ig", "") or "", "hashtags": ""},
                "yt": {"title": "", "description": caps.get("yt", "") or "", "tags": ""},
            }
            s.add(t); changed = True
        if changed:
            s.commit()


def get_session() -> Session:
    return Session(_engine)
