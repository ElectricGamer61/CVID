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


def kept_segments(start: float, end: float,
                  cuts: list) -> list[tuple[float, float]]:
    """The parts of [start,end] that survive after removing `cuts` (the middle
    pieces the user deleted). Cuts are clamped, sorted and merged first."""
    ranges = []
    for c in cuts or []:
        a, b = float(c[0]), float(c[1])
        a = max(start, min(a, end))
        b = max(start, min(b, end))
        if b > a:
            ranges.append((a, b))
    ranges.sort()
    merged: list[tuple[float, float]] = []
    for a, b in ranges:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    segs: list[tuple[float, float]] = []
    cur = start
    for a, b in merged:
        if a > cur:
            segs.append((cur, a))
        cur = max(cur, b)
    if end > cur:
        segs.append((cur, end))
    return segs


def remap_words_for_cuts(words: list[dict],
                         segments: list[tuple[float, float]]) -> tuple[list[dict], float]:
    """Re-time caption words onto the post-cut (compressed) timeline. A cut removes
    the video AND its audio, so a word spoken inside a cut is no longer heard — we DROP
    it (keeping it just piled the caption up at the seam, as if the cut were still
    there). Words straddling a cut edge are clamped to the seam. Returns (local_words,
    total_duration) — times are clip-local (start=0)."""
    bounds = []  # (src_start, src_end, edited_base)
    base = 0.0
    for a, b in segments:
        bounds.append((a, b, base))
        base += (b - a)
    total = base

    def to_edited(t: float) -> float:
        for a, b, eb in bounds:
            if t < a:
                return eb          # inside a removed gap before this segment -> the seam
            if t <= b:
                return eb + (t - a)
        return total

    out: list[dict] = []
    for w in words:
        if not any(w["end"] > a and w["start"] < b for a, b in segments):
            continue               # word lives entirely inside a cut -> drop it
        s = to_edited(w["start"])
        e = to_edited(w["end"])
        if e <= s:
            e = s + 0.15
        out.append({"start": s, "end": e, "word": w["word"]})
    out.sort(key=lambda x: x["start"])
    return out, total


def render_clip_segments(source: Path, out_path: Path,
                         segments: list[tuple[float, float]], aspect: str,
                         ass_path: Path, center: float = 0.5,
                         out_w: int = settings.OUT_W, out_h: int = settings.OUT_H,
                         voiceover: Path | None = None) -> Path:
    """Render kept segments concatenated into one vertical short (middle parts cut
    out), then crop to aspect + burn captions. ASS must already be retimed to the
    compressed timeline (see remap_words_for_cuts)."""
    src_w, src_h = probe_size(source)
    crop = crop_filter(src_w, src_h, aspect, center, out_w, out_h)
    subs = f"subtitles='{_escape_subtitles_path(ass_path)}'"
    fd = _fonts_dir()
    if fd:
        subs += f":fontsdir='{fd}'"

    parts = []
    for i, (a, b) in enumerate(segments):
        parts.append(f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{i}];")
        parts.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[a{i}];")
    concat_in = "".join(f"[v{i}][a{i}]" for i in range(len(segments)))
    parts.append(f"{concat_in}concat=n={len(segments)}:v=1:a=1[vc][ac];")
    parts.append(f"[vc]{crop},{subs}[vout]")
    filter_complex = "".join(parts)

    cmd = ["ffmpeg", "-y", "-i", str(source)]
    if voiceover:
        cmd += ["-i", str(voiceover)]
    cmd += ["-filter_complex", filter_complex, "-map", "[vout]"]
    cmd += (["-map", "1:a:0", "-shortest"] if voiceover else ["-map", "[ac]"])
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    return out_path


def render_clip(source: Path, out_path: Path, start: float, end: float,
                aspect: str, ass_path: Path, center: float = 0.5,
                out_w: int = settings.OUT_W, out_h: int = settings.OUT_H,
                voiceover: Path | None = None) -> Path:
    src_w, src_h = probe_size(source)
    vf = crop_filter(src_w, src_h, aspect, center, out_w, out_h)
    subs = f"subtitles='{_escape_subtitles_path(ass_path)}'"
    fd = _fonts_dir()
    if fd:
        subs += f":fontsdir='{fd}'"
    vf = f"{vf},{subs}"

    cmd = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(source)]
    if voiceover:
        cmd += ["-i", str(voiceover)]
    cmd += ["-vf", vf]
    if voiceover:
        cmd += ["-map", "0:v:0", "-map", "1:a:0", "-shortest"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    return out_path
