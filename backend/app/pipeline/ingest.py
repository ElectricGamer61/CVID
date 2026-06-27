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


def _ydl(opts: dict, url: str, ranges=None) -> dict:
    import yt_dlp
    from yt_dlp.utils import DownloadError

    if ranges is not None:
        from yt_dlp.utils import download_range_func
        opts["download_ranges"] = download_range_func(None, ranges)
        opts["force_keyframes_at_cuts"] = True
    base = {
        "quiet": True, "no_warnings": True, "noprogress": True,
        # yt-dlp's own per-fragment/HTTP retries (handles brief blips in-place).
        "retries": 10, "fragment_retries": 10, "extractor_retries": 3,
    }
    base.update(opts)

    last_err: Exception | None = None
    for attempt in range(1, _MAX_TRIES + 1):
        try:
            with yt_dlp.YoutubeDL(base) as ydl:
                return ydl.extract_info(url, download=True)
        except DownloadError as e:  # noqa: PERF203
            last_err = e
            msg = str(e).lower()
            if attempt == _MAX_TRIES or not any(t in msg for t in _TRANSIENT):
                raise
            # Re-extract from scratch with fresh URLs after a short backoff.
            time.sleep(2 * attempt)
    raise last_err  # pragma: no cover - loop always returns or raises above


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
