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
_WHISPER_MODEL_ENV = os.getenv("CVIDEO_WHISPER_MODEL", "").strip()
WHISPER_MODEL = _WHISPER_MODEL_ENV or "large-v3"
# The CPU fallback needs its OWN default. A CPU has no float16 tensor cores, so large-v3
# at int8 takes many minutes for a one-minute clip on an ordinary laptop — a "fallback"
# nobody would wait out. Pinning CVIDEO_WHISPER_MODEL explicitly still wins on both
# devices, so anyone who chose large-v3 on purpose keeps it everywhere.
WHISPER_MODEL_CPU = (os.getenv("CVIDEO_WHISPER_MODEL_CPU", "").strip()
                     or _WHISPER_MODEL_ENV or "small")
# auto = use the GPU only when CTranslate2 reports one, else go straight to CPU;
# cuda  = always try the GPU first (still falls back to CPU if it fails);
# cpu   = never touch the GPU. Every path ends on cpu/int8, so transcription always runs.
WHISPER_DEVICE = os.getenv("CVIDEO_WHISPER_DEVICE", "auto").strip().lower()

OLLAMA_MODEL = os.getenv("CVIDEO_OLLAMA_MODEL", "qwen3.5:9b")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("CVIDEO_GEMINI_MODEL", "gemini-1.5-flash")

# OpenAI (GPT) — a cloud brain option: scripts, hooks, post copy, viral-moment picking.
# Uses the official `openai` SDK. Set OPENAI_API_KEY and CVIDEO_DEFAULT_BRAIN=openai.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("CVIDEO_OPENAI_MODEL", "gpt-4o-mini")

# Claude (Anthropic) — the "smart brain": scripts, hooks, post copy, and viral-moment
# picking. Uses the official `anthropic` SDK. When ANTHROPIC_API_KEY is set, Claude becomes
# the DEFAULT brain (falls back to ollama/gemini/heuristic if a call fails). Opus 4.8 rejects
# temperature/top_p — the Claude path ignores those (see pipeline/llm.py).
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CVIDEO_CLAUDE_MODEL", "claude-opus-4-8")

# claude | openai | ollama | gemini | heuristic. Defaults to claude when its key is present,
# else OpenAI when that key is present, else local ollama.
DEFAULT_BRAIN = os.getenv(
    "CVIDEO_DEFAULT_BRAIN",
    "claude" if ANTHROPIC_API_KEY else "openai" if OPENAI_API_KEY else "ollama")

# Closed learning loop (learn.py) — feeds your best-performing hooks/angles back into the
# AI's prompts. Set CVIDEO_LEARNING=off for a bare-bones build that never touches generation.
LEARNING_ENABLED = os.getenv("CVIDEO_LEARNING", "on").strip().lower() not in ("off", "0", "false", "no")

# OPT-IN API token. Empty (default) = no auth, solo/local use is frictionless. Set a value
# and every /api/* call must send it (X-API-Token or `Authorization: Bearer <token>`) —
# the lock to add before exposing the app to anyone else. See main._require_api_token.
API_TOKEN = os.getenv("CVIDEO_API_TOKEN", "")

# Transcription backend: local (faster-whisper, free) | elevenlabs (Scribe, paid key)
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_MODEL = os.getenv("CVIDEO_ELEVENLABS_MODEL", "scribe_v1")
# Text-to-speech (read a transcript into a voiceover). Default voice = "Rachel" (public).
ELEVENLABS_VOICE_ID = os.getenv("CVIDEO_ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
ELEVENLABS_TTS_MODEL = os.getenv("CVIDEO_ELEVENLABS_TTS_MODEL", "eleven_turbo_v2_5")
_DEFAULT_TRANSCRIBE = os.getenv("CVIDEO_DEFAULT_TRANSCRIBE", "local").strip().lower()
# Asking for ElevenLabs without a key is not a choice, it's a dead end: the .env template
# ships `elevenlabs` and the installer lets you skip the key, which left the default
# pointing at a backend that can never run. Demote to local so /api/presets — and the
# picker the UI seeds from it — name the backend that will actually be used.
DEFAULT_TRANSCRIBE = ("local" if _DEFAULT_TRANSCRIBE == "elevenlabs" and not ELEVENLABS_API_KEY
                      else _DEFAULT_TRANSCRIBE)

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
