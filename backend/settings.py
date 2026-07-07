"""Central config for Cvideo backend. Paths, model choices, env-loaded API keys."""
from __future__ import annotations

import os
from pathlib import Path

# --- Paths -------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent

# Load backend/.env (API keys etc.) into the environment if present.
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except Exception:  # noqa: BLE001 - dotenv optional
    pass

PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = Path(os.getenv("CVIDEO_DATA_DIR", PROJECT_ROOT / "data"))
PROJECTS_DIR = DATA_DIR / "projects"
DB_PATH = DATA_DIR / "cvideo.db"

PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

# --- Models / engines --------------------------------------------------------
WHISPER_MODEL = os.getenv("CVIDEO_WHISPER_MODEL", "large-v3")
# Allowed: cuda (float16) -> falls back to cpu (int8) automatically if cuda fails.
WHISPER_DEVICE = os.getenv("CVIDEO_WHISPER_DEVICE", "auto")

OLLAMA_MODEL = os.getenv("CVIDEO_OLLAMA_MODEL", "qwen3.5:9b")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("CVIDEO_GEMINI_MODEL", "gemini-1.5-flash")

# Claude (Anthropic) — the "smart brain": scripts, hooks, post copy, and viral-moment
# picking. Uses the official `anthropic` SDK. When ANTHROPIC_API_KEY is set, Claude becomes
# the DEFAULT brain (falls back to ollama/gemini/heuristic if a call fails). Opus 4.8 rejects
# temperature/top_p — the Claude path ignores those (see pipeline/llm.py).
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CVIDEO_CLAUDE_MODEL", "claude-opus-4-8")

# claude | ollama | gemini | heuristic. Defaults to claude when the key is present.
DEFAULT_BRAIN = os.getenv("CVIDEO_DEFAULT_BRAIN", "claude" if ANTHROPIC_API_KEY else "ollama")

# Transcription backend: local (faster-whisper, free) | elevenlabs (Scribe, paid key)
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_MODEL = os.getenv("CVIDEO_ELEVENLABS_MODEL", "scribe_v1")
# Text-to-speech (read a transcript into a voiceover). Default voice = "Rachel" (public).
ELEVENLABS_VOICE_ID = os.getenv("CVIDEO_ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
ELEVENLABS_TTS_MODEL = os.getenv("CVIDEO_ELEVENLABS_TTS_MODEL", "eleven_turbo_v2_5")
DEFAULT_TRANSCRIBE = os.getenv("CVIDEO_DEFAULT_TRANSCRIBE", "local")

# --- Shoot Drop (batch raw-footage intake) ------------------------------------
# Watched folder: copy raw phone clips here and the backend auto-ingests them
# (transcribe -> match to open video scripts -> attach). Empty = watcher off;
# the in-app drop zone works regardless.
SHOOT_DROP_DIR = os.getenv("SHOOT_DROP_DIR", "")
SHOOTDROP_DIR = DATA_DIR / "shootdrop"

# --- Posting (Phase 6 schedule/post) -----------------------------------------
# Upload-Post API key. When empty, the poster runs in DRY-RUN mode (logs instead
# of sending) — see app/pipeline/poster.py. Real posting is gated on this.
UPLOAD_POST_API_KEY = os.getenv("UPLOAD_POST_API_KEY", "")
# Upload-Post "user" profile name (created in the Upload-Post dashboard, with your
# TikTok/IG/YouTube accounts connected). Required for real posting.
UPLOAD_POST_USER = os.getenv("UPLOAD_POST_USER", "")
# IANA timezone the scheduled times are written in (e.g. America/New_York).
UPLOAD_POST_TIMEZONE = os.getenv("UPLOAD_POST_TIMEZONE", "UTC")
# Platforms we can target (matches the per-platform caption keys tt/ig/yt).
PLATFORMS = ["tt", "ig", "yt"]

# Google Sheet webhook (Apps Script web-app URL). When set, Cvideo POSTs each logged
# performance row to it so the sheet in your Drive stays current (→ cowork engine).
# Empty = no-op (perf logging stays fully local). See app/sheets.py.
PERF_SHEET_WEBHOOK_URL = os.getenv("PERF_SHEET_WEBHOOK_URL", "")

# --- Clip generation defaults ------------------------------------------------
TARGET_CLIP_COUNT = int(os.getenv("CVIDEO_TARGET_CLIPS", "6"))
MIN_CLIP_SEC = float(os.getenv("CVIDEO_MIN_CLIP", "15"))
MAX_CLIP_SEC = float(os.getenv("CVIDEO_MAX_CLIP", "60"))

# Output canvas (9:16 vertical short) — the 1080p baseline. Per-clip exports may
# override via a resolution tier (see RESOLUTIONS / output_dims).
OUT_W = 1080
OUT_H = 1920

# Export resolution tiers, keyed by the vertical short's WIDTH (its short edge).
# Height is derived from the chosen aspect so non-9:16 outputs aren't distorted.
# NOTE: real detail is bounded by the source — a 9:16 crop of a 1080p source has
# ~600px of true width, so 4K is a high-quality (lanczos) upscale. We still fetch
# the best available source (download cap raised to 2160p) to maximise real detail.
RESOLUTIONS = {"1080p": 1080, "1440p": 1440, "4k": 2160}
DEFAULT_RESOLUTION = os.getenv("CVIDEO_DEFAULT_RESOLUTION", "1080p")


def output_dims(aspect: str, resolution: str = DEFAULT_RESOLUTION) -> tuple[int, int]:
    """(width, height) for the given aspect + resolution tier, both even (h264-safe)."""
    from app.pipeline.reframe import ASPECTS
    width = RESOLUTIONS.get(resolution, RESOLUTIONS[DEFAULT_RESOLUTION])
    aw, ah = ASPECTS.get(aspect, (9, 16))
    height = round(width * ah / aw)
    return width - (width % 2), height - (height % 2)


def project_dir(project_id: int) -> Path:
    d = PROJECTS_DIR / str(project_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "clips").mkdir(exist_ok=True)
    return d
