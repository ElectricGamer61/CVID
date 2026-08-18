"""Ingest layer — efficient "proxy workflow":

For YouTube URLs we never pull the whole full-res video up front. Instead:
  - download_audio()       -> tiny audio only, for transcription + brain
  - download_proxy()       -> small 360p video, for editor preview / trim
  - download_clip_range()  -> full quality, ONLY the exact seconds of a clip, at export

For local uploads, save_upload() keeps the file and extract_audio() pulls the audio.
"""
from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

# Forgiving format selector: grab the best source up to 4K so high-res exports have
# real detail to work with, falling back gracefully to whatever's available.
_FMT_FULL = "bv*[height<=2160]+ba/b[height<=2160]/bv*+ba/b/best"
_FMT_PROXY = "bv*[height<=360]+ba/b[height<=360]/worst[height>=240]/best"

# YouTube's googlevideo URLs expire / throttle and intermittently return HTTP 403.
# A fresh extract_info() re-mints those URLs, so retrying the whole call (not just
# the fragment) clears most transient 403/timeout failures.
_TRANSIENT = ("403", "forbidden", "timed out", "timeout",
              "connection reset", "unable to download video data")
_MAX_TRIES = 4

# Keep this intentionally specific: an ordinary 403/timeout should retain the existing
# transient retry behavior, while a bot challenge is the one case where a local browser
# session can legitimately help.
_BOT_CHALLENGE_MARKERS = (
    "sign in to confirm you're not a bot",
    "sign in to confirm you’re not a bot",
    "confirm you're not a bot",
    "confirm you’re not a bot",
    "not a bot",
    "confirm you are not a bot",
)


def is_bot_challenge(error: object) -> bool:
    """Return whether yt-dlp reported YouTube's interactive bot/sign-in challenge."""
    text = str(error).lower()
    return any(marker in text for marker in _BOT_CHALLENGE_MARKERS)


def is_format_unavailable(error: object) -> bool:
    """Return whether yt-dlp rejected only the requested format selector."""
    text = str(error).lower()
    return any(marker in text for marker in (
        "requested format is not available",
        "requested format not available",
        "format is not available",
    ))


def _format_candidates(opts: dict) -> tuple[dict, ...]:
    """Return preferred options followed by selectors accepted by more videos.

    Keep this here, rather than weakening the primary selectors, so good sources
    still get the requested proxy/full quality while odd YouTube manifests can
    degrade to a playable download.
    """
    selected = opts.get("format")
    if not selected:
        return (opts,)
    if "audio" in selected.lower() and selected == "bestaudio/best":
        formats = (selected, "bestaudio", "best")
    else:
        formats = (selected, "bestvideo+bestaudio", "best", "bv*+ba/b")
    candidates = []
    for fmt in formats:
        if fmt not in {item.get("format") for item in candidates}:
            candidate = dict(opts)
            candidate["format"] = fmt
            candidates.append(candidate)
    return tuple(candidates)


def _browser_order() -> tuple[str, ...]:
    # Imported at call time so tests and long-running local installs can configure this
    # without making local-file ingestion depend on browser state.
    from settings import YOUTUBE_COOKIE_BROWSERS
    allowed = {"chrome", "edge", "firefox"}
    return tuple(browser for browser in YOUTUBE_COOKIE_BROWSERS if browser in allowed)


def _ydl_attempt(opts: dict, url: str, ranges=None, browser: str | None = None) -> dict:
    import yt_dlp
    if ranges is not None:
        from yt_dlp.utils import download_range_func
        opts = dict(opts)
        opts["download_ranges"] = download_range_func(None, ranges)
        opts["force_keyframes_at_cuts"] = True
    base = {
        "quiet": True, "no_warnings": True, "noprogress": True,
        # yt-dlp's own per-fragment/HTTP retries (handles brief blips in-place).
        "retries": 10, "fragment_retries": 10, "extractor_retries": 3,
    }
    if browser:
        # yt-dlp reads the browser cookie database locally. No password scraping or
        # cookie upload is performed by Cvideo.
        base["cookiesfrombrowser"] = (browser,)
    base.update(opts)
    with yt_dlp.YoutubeDL(base) as ydl:
        return ydl.extract_info(url, download=True)


def _ydl(_opts: dict, url: str, ranges=None) -> dict:
    from yt_dlp.utils import DownloadError

    candidates = _format_candidates(_opts)
    format_errors: list[str] = []

    def attempt(opts: dict, browser: str | None = None):
        for retry in range(1, _MAX_TRIES + 1):
            try:
                return _ydl_attempt(opts, url, ranges, browser)
            except DownloadError as error:  # noqa: PERF203
                if is_format_unavailable(error):
                    format_errors.append(str(error))
                    raise
                msg = str(error).lower()
                if retry == _MAX_TRIES or not any(t in msg for t in _TRANSIENT):
                    raise
                time.sleep(2 * retry)

    def try_all(browser: str | None = None):
        for opts in candidates:
            try:
                return attempt(opts, browser)
            except DownloadError as error:
                if not is_format_unavailable(error):
                    raise
        return None

    try:
        result = try_all()
        if result is not None:
            return result
    except DownloadError as anonymous_error:
        if not is_bot_challenge(anonymous_error):
            raise
        browsers = _browser_order()
        if not browsers:
            raise RuntimeError(
                "YouTube asked you to sign in because it detected automated traffic. "
                "No browser-cookie fallback is enabled. Set "
                "CVIDEO_YOUTUBE_COOKIE_BROWSERS=chrome,edge,firefox in backend/.env "
                "and retry, with YouTube already signed in to one of those browsers."
            ) from anonymous_error
        browser_errors = []
        for browser in browsers:
            try:
                result = try_all(browser)
                if result is not None:
                    return result
            except DownloadError as error:
                browser_errors.append(f"{browser}: {error}")
        if browser_errors and not all(is_format_unavailable(e) for e in browser_errors):
            raise RuntimeError(
                "YouTube rejected the request even with the configured browser sessions "
                f"({', '.join(browsers)}). Sign in to YouTube in one configured browser, "
                "close it, then retry; otherwise try again later. "
                f"Details: {'; '.join(browser_errors)}"
            ) from anonymous_error

    if format_errors:
        raise RuntimeError(
            "YouTube has no compatible downloadable format for this video. "
            "Update yt-dlp in the backend environment and retry, or use a local video file. "
            f"Details: {format_errors[-1]}"
        )
    raise RuntimeError("YouTube download failed; retry the project.")


def _finalize(out_path: Path) -> Path:
    """yt-dlp writes <stem>.<ext>; normalise to the requested .mp4 path."""
    produced = out_path.with_suffix(".mp4")
    if produced.exists() and produced != out_path:
        produced.replace(out_path)
    if not out_path.exists():
        for f in sorted(out_path.parent.glob(out_path.stem + ".*")):
            if f.suffix not in (".part", ".ytdl"):
                f.replace(out_path)
                break
    if not out_path.exists():
        raise RuntimeError(f"yt-dlp produced no file at {out_path}")
    return out_path


# --------------------------------------------------------------------------- #
# YouTube (proxy workflow)
# --------------------------------------------------------------------------- #
def download_audio(url: str, audio_wav: Path) -> tuple[Path, float]:
    """Download audio only, then transcode to 16 kHz mono WAV for Whisper.
    Returns (wav_path, duration_seconds)."""
    stem = audio_wav.parent / "_audiodl"
    info = _ydl(
        {"format": "bestaudio/best", "outtmpl": str(stem) + ".%(ext)s"}, url
    )
    downloaded = None
    for f in sorted(audio_wav.parent.glob("_audiodl.*")):
        if f.suffix not in (".part", ".ytdl"):
            downloaded = f
            break
    if not downloaded:
        raise RuntimeError("audio download produced no file")
    extract_audio(downloaded, audio_wav)
    downloaded.unlink(missing_ok=True)
    return audio_wav, float(info.get("duration") or 0.0)


def download_proxy(url: str, proxy_mp4: Path) -> Path:
    """Download a small 360p preview/trim proxy."""
    _ydl(
        {"format": _FMT_PROXY, "merge_output_format": "mp4",
         "outtmpl": str(proxy_mp4.with_suffix("")) + ".%(ext)s"},
        url,
    )
    return _finalize(proxy_mp4)


def download_full(url: str, out_mp4: Path) -> Path:
    """Download the full-quality video once (cached, reused for all clip exports)."""
    _ydl(
        {"format": _FMT_FULL, "merge_output_format": "mp4",
         "outtmpl": str(out_mp4.with_suffix("")) + ".%(ext)s"},
        url,
    )
    return _finalize(out_mp4)


def download_clip_range(url: str, out_mp4: Path, start: float, end: float) -> Path:
    """Download ONLY [start, end] at full quality (accurate, keyframe-forced cut).
    The resulting file is clip-local (begins at 0).

    NOTE: yt-dlp's force_keyframes_at_cuts re-encode is unreliable on some Windows
    setups; export currently uses download_full() + cache instead. Kept for reference."""
    _ydl(
        {"format": _FMT_FULL, "merge_output_format": "mp4",
         "outtmpl": str(out_mp4.with_suffix("")) + ".%(ext)s"},
        url, ranges=[(start, end)],
    )
    return _finalize(out_mp4)


# --------------------------------------------------------------------------- #
# Local files
# --------------------------------------------------------------------------- #
def save_upload(src_file: Path, out_path: Path) -> Path:
    shutil.copy(src_file, out_path)
    return out_path


def extract_audio(video_path: Path, audio_path: Path) -> Path:
    """Extract 16 kHz mono WAV for Whisper."""
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(audio_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return audio_path


def extract_voiceover(src_path: Path, audio_path: Path) -> Path:
    """Full-quality voiceover WAV (48 kHz stereo) — for recorded voice that ends up
    in the export, NOT the 16 kHz mono Whisper path."""
    cmd = [
        "ffmpeg", "-y", "-i", str(src_path),
        "-vn", "-ac", "2", "-ar", "48000",
        "-c:a", "pcm_s16le", str(audio_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return audio_path


def probe_duration(video_path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(video_path),
    ]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0
