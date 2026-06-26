"""Render a final vertical short: cut [start,end] -> crop to aspect -> burn captions."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import settings
from .reframe import crop_filter, probe_size


def _escape_subtitles_path(p: Path) -> str:
    """ffmpeg's subtitles filter needs Windows paths sanitised:
    backslashes -> forward slashes, and the drive colon escaped."""
    s = str(p).replace("\\", "/")
    s = s.replace(":", "\\:")
    return s


def _fonts_dir() -> str | None:
    """Windows Fonts dir so libass can always resolve a font (it renders nothing
    if it finds none)."""
    win = os.environ.get("WINDIR", r"C:\Windows")
    fonts = Path(win) / "Fonts"
    return _escape_subtitles_path(fonts) if fonts.is_dir() else None


def render_clip(source: Path, out_path: Path, start: float, end: float,
                aspect: str, ass_path: Path, center: float = 0.5,
                out_w: int = settings.OUT_W, out_h: int = settings.OUT_H) -> Path:
    src_w, src_h = probe_size(source)
    vf = crop_filter(src_w, src_h, aspect, center, out_w, out_h)
    subs = f"subtitles='{_escape_subtitles_path(ass_path)}'"
    fd = _fonts_dir()
    if fd:
        subs += f":fontsdir='{fd}'"
    vf = f"{vf},{subs}"

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(source),
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    return out_path
