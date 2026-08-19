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
_WHISPER_MODEL_CPU_ENV = os.getenv("CVIDEO_WHISPER_MODEL_CPU", "").strip()
WHISPER_MODEL_CPU = _WHISPER_MODEL_CPU_ENV or _WHISPER_MODEL_ENV or "small"
# Did a human actually ask for these weights? Only then may Cvideo start a large
# first-run download; a *default* never should. See WHISPER_MAX_AUTO_DOWNLOAD_MB.
WHISPER_MODEL_PINNED = bool(_WHISPER_MODEL_ENV)
WHISPER_MODEL_CPU_PINNED = bool(_WHISPER_MODEL_CPU_ENV or _WHISPER_MODEL_ENV)
# Biggest first-run download Cvideo will start on its own, in MB. This app is local-first
# and offline-friendly: the default GPU model (large-v3) is 3.1 GB, and fetching that
# because a default said so is what left the first upload frozen on "Transcribing" for a
# quarter of an hour and then failed on a dropped connection. An already-cached model is
# used whatever its size, and CVIDEO_WHISPER_MODEL still forces any model you want.
WHISPER_MAX_AUTO_DOWNLOAD_MB = int(os.getenv("CVIDEO_WHISPER_MAX_DOWNLOAD_MB", "700"))
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

# --- YouTube browser-cookie fallback -----------------------------------------
# When YouTube answers an anonymous download with "Sign in to confirm you're not a bot",
# Cvideo can retry through the cookie store of a browser you are already signed in to on
# THIS machine. yt-dlp reads that local database and sends the cookies only to the YouTube
# request it is already making: nothing is copied into the project, logged, or uploaded to
# Cvideo, and local-file projects never reach this code at all.
#
# On Windows this is ON by default (chrome, then edge, then firefox) because a desktop
# install is a single signed-in user's own machine and the alternative is a dead end they
# have to read a log to diagnose. Turn it off with CVIDEO_YOUTUBE_COOKIE_BROWSERS=off.
# Elsewhere (servers, CI, shared boxes) it stays opt-in; `=auto` enables the same order.
SUPPORTED_COOKIE_BROWSERS = ("brave", "chrome", "chromium", "edge", "firefox",
                             "opera", "safari", "vivaldi", "whale")
DEFAULT_COOKIE_BROWSERS = ("chrome", "edge", "firefox")
_COOKIE_BROWSERS_OFF = ("off", "none", "no", "0", "false", "disabled")
_COOKIE_BROWSERS_AUTO = ("auto", "default", "on", "yes", "1", "true")


def resolve_cookie_browsers(raw: str | None, *, windows: bool | None = None) -> tuple[str, ...]:
    """Browsers to try after an anonymous YouTube download hits a bot challenge.

    `raw` is the CVIDEO_YOUTUBE_COOKIE_BROWSERS value: None = never configured (the
    platform default applies), "" or an off-word = explicitly disabled, anything else =
    an ordered list. Unsupported names are dropped rather than passed to yt-dlp, which
    would fail the retry with a confusing "unsupported browser" error instead of the
    YouTube problem the user actually has."""
    if windows is None:
        windows = os.name == "nt"
    if raw is None:
        return DEFAULT_COOKIE_BROWSERS if windows else ()
    text = raw.strip().lower()
    if not text or text in _COOKIE_BROWSERS_OFF:
        return ()
    if text in _COOKIE_BROWSERS_AUTO:
        return DEFAULT_COOKIE_BROWSERS
    seen: list[str] = []
    for item in (part.strip() for part in text.split(",")):
        if item in SUPPORTED_COOKIE_BROWSERS and item not in seen:
            seen.append(item)
    return tuple(seen)


# Kept for diagnostics: the ingest error tells the user what their setting actually said
# when it resolves to "no browsers", which is otherwise indistinguishable from "off".
YOUTUBE_COOKIE_BROWSERS_RAW = os.getenv("CVIDEO_YOUTUBE_COOKIE_BROWSERS")
YOUTUBE_COOKIE_BROWSERS = resolve_cookie_browsers(YOUTUBE_COOKIE_BROWSERS_RAW)

# An exported cookies.txt file. This exists because reading a *browser* cookie store is not
# actually possible for the two browsers Windows users have: since Chrome 127, Chrome and
# Edge seal their cookies with App-Bound Encryption, and yt-dlp cannot decrypt them
# (yt-dlp#10927 - the real error on the laptop was "Failed to decrypt with DPAPI"). A
# cookies.txt exported from the signed-in browser works everywhere and is what yt-dlp's own
# FAQ recommends. Default location: backend\youtube-cookies.txt, so dropping the file in
# is the whole setup. It is read locally and sent only to YouTube, exactly like the
# browser path.
DEFAULT_COOKIES_FILE = BACKEND_DIR / "youtube-cookies.txt"
YOUTUBE_COOKIES_FILE_RAW = os.getenv("CVIDEO_YOUTUBE_COOKIES_FILE", "")


def resolve_cookies_file(raw: str | None, default_path: Path) -> Path | None:
    """The cookies.txt to hand yt-dlp, or None.

    An explicit setting wins even when the file is missing: `raw` is reported back in the
    ingest error so a typo'd path reads as a typo instead of as "the fallback did nothing"."""
    text = (raw or "").strip().strip('"').strip("'")
    if text:
        path = Path(text).expanduser()
        return path if path.is_file() else None
    return default_path if default_path.is_file() else None


YOUTUBE_COOKIES_FILE = resolve_cookies_file(YOUTUBE_COOKIES_FILE_RAW, DEFAULT_COOKIES_FILE)

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
