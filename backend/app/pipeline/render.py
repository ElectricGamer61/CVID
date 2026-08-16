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


def video_chain(crop: str, look: str, subs: str, zoom: str = "", pad: str = "") -> str:
    """The clip's video-filter chain, in the ONE order every export path uses:

        crop -> LOOK (colour grade) -> captions -> punch-in zoom -> voice pad

    ffmpeg applies filters in order, so putting the grade before `subtitles=` is what keeps
    the captions and the big title crisp and untinted on top of the graded picture. Empty
    parts are dropped, so a clip with no look/zoom/voice yields exactly the chain this
    produced before any of those features existed.
    """
    return ",".join(p for p in (crop, look, subs, zoom, pad) if p)


def has_audio(path: Path) -> bool:
    """Does this file carry an audio stream at all?

    Silent clips are first-class here (B-roll, a muted phone take, footage you voice over
    later), and the cut/concat path used to ask ffmpeg for `[0:a]` unconditionally — on a
    silent source that failed the whole export with a raw
    `Stream specifier ':a' ... matches no streams` dump in the editor. Any probe trouble
    answers "no audio", which only costs a silent render instead of killing it."""
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True)
        return proc.returncode == 0 and bool(proc.stdout.strip())
    except Exception:  # noqa: BLE001 - no ffprobe / unreadable file -> treat as silent
        return False


def _voice_pad_filter(voiceover: "Path | None", video_dur: float) -> str:
    """Video filter that HOLDS the last frame when the voiceover runs longer than
    the video, so `-shortest` can't chop the tail of the voice off (lost spoken words).
    Returns "" (no change -> byte-identical output) when the voice fits the video, which
    is the common case. Voice-first: the recorded voice is the master."""
    if not voiceover:
        return ""
    from .ingest import probe_duration
    try:
        vo_dur = float(probe_duration(Path(voiceover)) or 0.0)
    except Exception:  # noqa: BLE001 - a probe failure just means "don't pad"
        return ""
    extra = vo_dur - float(video_dur or 0.0)
    return f"tpad=stop_mode=clone:stop_duration={extra:.3f}" if extra > 0.05 else ""


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


def remap_keyframes_for_cuts(keyframes: list[dict], segments: list[tuple[float, float]]) -> list[dict]:
    """Map effect keyframes (zoom/sfx, keyed by source-time `t`) onto the post-cut edited
    timeline, dropping any that fall entirely inside a removed range. Shares to_edited() with
    remap_words_for_cuts so previews/exports agree."""
    bounds, base = [], 0.0
    for a, b in segments:
        bounds.append((a, b, base)); base += (b - a)
    total = base

    def to_edited(t: float) -> float:
        for a, b, eb in bounds:
            if t < a:
                return eb
            if t <= b:
                return eb + (t - a)
        return total

    out = []
    for k in keyframes or []:
        t = float(k.get("t", 0))
        if not any(a - 0.001 <= t < b + 0.001 for a, b in segments):
            continue                       # keyframe inside a cut -> gone with the video
        out.append({**k, "t": round(to_edited(t), 3)})
    return out


def _zoom_filter(zoom: list[dict] | None, out_w: int, out_h: int, fps: int = 30) -> str:
    """A zoompan punch-in over the given EDITED-time windows. Empty -> "" (no filter appended,
    so a clip with no zoom renders exactly as before). Applied AFTER the aspect-crop so it never
    re-picks the crop — it just magnifies the finished frame."""
    if not zoom:
        return ""
    terms = []
    for k in zoom:
        t = float(k.get("t", 0)); dur = max(0.2, float(k.get("duration", 0.6)))
        amp = max(0.0, float(k.get("scale", 1.15)) - 1.0)
        terms.append(f"{amp:.3f}*between(on,{int(t * fps)},{int((t + dur) * fps)})")
    zexpr = "min(1.6,1+" + "+".join(terms) + ")"
    return (f"zoompan=z='{zexpr}':d=1:fps={fps}:s={out_w}x{out_h}"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'")


def mix_sfx(video_path: Path, sfx: list[dict], sfx_dir: Path) -> Path:
    """Isolated post-pass: overlay SFX onto a finished render's audio (adelay + amix), replacing
    the file in place. No-op when `sfx` is empty; a failure leaves the original render untouched
    (SFX is opt-in and must never break an export)."""
    cues = [(float(c["t"]), sfx_dir / f"{c['name']}.wav") for c in (sfx or [])
            if (sfx_dir / f"{c['name']}.wav").exists()]
    if not cues:
        return video_path
    tmp = video_path.with_name(video_path.stem + "_sfx" + video_path.suffix)
    cmd = ["ffmpeg", "-y", "-i", str(video_path)]
    for _, p in cues:
        cmd += ["-i", str(p)]
    parts, mix_in = [], "[0:a]"
    for i, (t, _) in enumerate(cues, start=1):
        parts.append(f"[{i}:a]adelay={int(t * 1000)}|{int(t * 1000)}[s{i}];")
        mix_in += f"[s{i}]"
    parts.append(f"{mix_in}amix=inputs={len(cues) + 1}:duration=first:dropout_transition=0[a]")
    cmd += ["-filter_complex", "".join(parts), "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", str(tmp)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"[sfx] mix skipped (kept clean render):\n{proc.stderr[-600:]}")
        tmp.unlink(missing_ok=True)
        return video_path
    tmp.replace(video_path)
    return video_path


def render_clip_segments(source: Path, out_path: Path,
                         segments: list[tuple[float, float]], aspect: str,
                         ass_path: Path, center: float = 0.5,
                         out_w: int = settings.OUT_W, out_h: int = settings.OUT_H,
                         voiceover: Path | None = None,
                         zoom: list[dict] | None = None,
                         look: str = "") -> Path:
    """Render kept segments concatenated into one vertical short (middle parts cut
    out), then crop to aspect + burn captions. ASS must already be retimed to the
    compressed timeline (see remap_words_for_cuts)."""
    src_w, src_h = probe_size(source)
    crop = crop_filter(src_w, src_h, aspect, center, out_w, out_h)
    subs = f"subtitles='{_escape_subtitles_path(ass_path)}'"
    fd = _fonts_dir()
    if fd:
        subs += f":fontsdir='{fd}'"

    # A silent source has no [0:a] to trim — build a video-only concat instead of dying.
    audio = has_audio(source)
    parts = []
    for i, (a, b) in enumerate(segments):
        parts.append(f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{i}];")
        if audio:
            parts.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[a{i}];")
    concat_in = "".join(f"[v{i}]" + (f"[a{i}]" if audio else "") for i in range(len(segments)))
    parts.append(f"{concat_in}concat=n={len(segments)}:v=1:a={1 if audio else 0}"
                 f"{'[vc][ac];' if audio else '[vc];'}")
    chain = video_chain(crop, look, subs, _zoom_filter(zoom, out_w, out_h),
                        _voice_pad_filter(voiceover, sum(b - a for a, b in segments)))
    parts.append(f"[vc]{chain}[vout]")
    filter_complex = "".join(parts)

    cmd = ["ffmpeg", "-y", "-i", str(source)]
    if voiceover:
        cmd += ["-i", str(voiceover)]
    cmd += ["-filter_complex", filter_complex, "-map", "[vout]"]
    if voiceover:
        cmd += ["-map", "1:a:0", "-shortest"]
    elif audio:
        cmd += ["-map", "[ac]"]     # else: silent source -> silent export, not a crash
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    return out_path


def render_clip(source: Path, out_path: Path, start: float, end: float,
                aspect: str, ass_path: Path, center: float = 0.5,
                out_w: int = settings.OUT_W, out_h: int = settings.OUT_H,
                voiceover: Path | None = None, zoom: list[dict] | None = None,
                look: str = "") -> Path:
    src_w, src_h = probe_size(source)
    crop = crop_filter(src_w, src_h, aspect, center, out_w, out_h)
    subs = f"subtitles='{_escape_subtitles_path(ass_path)}'"
    fd = _fonts_dir()
    if fd:
        subs += f":fontsdir='{fd}'"
    # Hold the last frame if the voiceover overruns the clip, so its tail isn't cut.
    vf = video_chain(crop, look, subs, _zoom_filter(zoom, out_w, out_h),
                     _voice_pad_filter(voiceover, end - start))

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
