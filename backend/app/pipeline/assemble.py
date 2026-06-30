"""Assemble a native-short ticket's beats into one 9:16 reel — local ffmpeg.

Pure service: ids in, reel path out. No FastAPI/HTTP types so it can later run in
a worker process unchanged. Localhost-first: reads beat media from disk, writes the
reel to disk. The `# FUTURE:` comments mark where disk I/O / dispatch would swap to
object storage + a job queue.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import settings
from .captions import _ts, write_ass
from .ingest import probe_duration
from .reframe import crop_filter, probe_size
from .render import _escape_subtitles_path, _fonts_dir, kept_segments, remap_words_for_cuts

W, H = settings.OUT_W, settings.OUT_H   # 1080 x 1920


def ticket_dir(ticket_id: int) -> Path:
    d = settings.DATA_DIR / "tickets" / str(ticket_id)
    (d / "beats").mkdir(parents=True, exist_ok=True)
    return d


def _even_split(text: str, dur: float) -> list[dict]:
    """Time the KNOWN caption words evenly across the beat's voiceover duration —
    no transcription guess; we already have the words."""
    toks = (text or "").split()
    if not toks:
        return []
    per = dur / len(toks)
    return [{"start": round(i * per, 2), "end": round((i + 1) * per, 2), "word": w}
            for i, w in enumerate(toks)]


def _write_beat_ass(beat: dict, dur: float, ass_path: Path) -> None:
    write_ass(_even_split(beat["caption"], dur), 0.0, dur, "capcut", ass_path)
    osd = (beat.get("on_screen_text") or "").strip()
    if osd:
        # static top-center overlay for the whole beat (reuses the Base style)
        safe = osd.replace("{", "(").replace("}", ")").replace("\n", " ")
        line = f"Dialogue: 0,{_ts(0.0)},{_ts(dur)},Base,,0,0,0,,{{\\an8\\fs64\\b1}}{safe}\n"
        with ass_path.open("a", encoding="utf-8") as f:
            f.write(line)


def _concat_segments(seg_files: list[Path], out_path: Path,
                     out_w: int = W, out_h: int = H) -> None:
    """Join rendered segments into one file with NO inter-clip stutter.

    Uses the concat *filter* (not the demuxer): each segment is normalized to the
    same size/fps/SAR and its PTS reset, then concatenated into a single continuous
    timeline. This avoids the per-segment timestamp resets and AAC encoder-priming
    gaps that the concat demuxer leaves at every boundary (the stutter)."""
    inputs: list[str] = []
    for s in seg_files:
        inputs += ["-i", str(s)]
    n = len(seg_files)
    parts, labels = [], ""
    for i in range(n):
        parts.append(f"[{i}:v:0]fps=30,scale={out_w}:{out_h},setsar=1,setpts=PTS-STARTPTS[v{i}];")
        parts.append(f"[{i}:a:0]aresample=48000,asetpts=PTS-STARTPTS[a{i}];")
        labels += f"[v{i}][a{i}]"
    fc = "".join(parts) + f"{labels}concat=n={n}:v=1:a=1[v][a]"
    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", fc,
           "-map", "[v]", "-map", "[a]",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
           "-preset", "veryfast", "-crf", "20",
           "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
           str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"concat failed:\n{proc.stderr[-1800:]}")


def _render_beat(beat: dict, out_path: Path, work: Path) -> None:
    clip = beat.get("clip_path")
    vo = beat.get("voiceover_path")
    has_clip = bool(clip and Path(clip).exists())
    has_vo = bool(vo and Path(vo).exists())
    # FUTURE: read beat clip/voiceover from object storage instead of local disk.

    if has_vo:
        dur = probe_duration(Path(vo))
    elif has_clip:
        dur = probe_duration(Path(clip))
    else:
        dur = 3.0
    dur = max(0.8, float(dur or 3.0))

    ass = work / (out_path.stem + ".ass")
    _write_beat_ass(beat, dur, ass)
    subs = f"subtitles='{_escape_subtitles_path(ass)}'"
    fd = _fonts_dir()
    if fd:
        subs += f":fontsdir='{fd}'"

    vf = []
    if has_clip:
        sw, sh = probe_size(Path(clip))
        vf.append(crop_filter(sw, sh, "9:16", 0.5, W, H))
    vf.append(subs)

    cmd = ["ffmpeg", "-y"]
    cmd += (["-stream_loop", "-1", "-i", str(clip)] if has_clip
            else ["-f", "lavfi", "-i", f"color=c=0x111318:s={W}x{H}:r=30"])
    cmd += (["-i", str(vo)] if has_vo
            else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
    cmd += ["-t", f"{dur:.3f}", "-vf", ",".join(vf),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
            "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-ar", "48000", "-ac", "2", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"beat render failed:\n{proc.stderr[-1500:]}")


def _render_plain_seg(out_path: Path, dur: float, clip: str | None) -> None:
    """One stitched-preview segment: the beat clip cropped to 9:16 (looped to `dur`)
    with a silent audio track — no captions, no VO. Captions/voice are added live in
    the editor. A beat with no clip gets a dark filler."""
    has_clip = bool(clip and Path(clip).exists())
    cmd = ["ffmpeg", "-y"]
    cmd += (["-stream_loop", "-1", "-i", str(clip)] if has_clip
            else ["-f", "lavfi", "-i", f"color=c=0x111318:s={W}x{H}:r=30"])
    cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{dur:.3f}"]
    if has_clip:
        sw, sh = probe_size(Path(clip))
        cmd += ["-vf", crop_filter(sw, sh, "9:16", 0.5, W, H)]
    cmd += ["-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
            "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-ar", "48000", "-ac", "2", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"segment build failed:\n{proc.stderr[-1500:]}")


def build_edit_video(ticket_id: int, project_dir: Path) -> dict:
    """Stitch a ticket's scene clips (in order) into ONE 9:16 video at
    `project_dir/source.mp4` so the reel can be edited in the normal clip editor.
    No VO/captions are baked in. Returns {duration, scenes[], words[]} where scenes
    are timeline markers and words are the beats' caption text even-split per scene
    (absolute times) so captions show without a transcription pass."""
    from app.db import Beat, get_session
    from sqlmodel import select

    with get_session() as s:
        beats = [b.model_dump() for b in s.exec(
            select(Beat).where(Beat.ticket_id == ticket_id).order_by(Beat.order_index)).all()]
    if not beats:
        raise RuntimeError("ticket has no scenes to build")

    project_dir.mkdir(parents=True, exist_ok=True)
    segdir = project_dir / "segs"
    shutil.rmtree(segdir, ignore_errors=True)
    segdir.mkdir(parents=True, exist_ok=True)

    seg_files: list[Path] = []
    scenes: list[dict] = []
    words: list[dict] = []
    t0 = 0.0
    for i, b in enumerate(beats):
        clip = b.get("clip_path")
        has_clip = bool(clip and Path(clip).exists())
        dur = max(0.8, float((probe_duration(Path(clip)) if has_clip else 0.0) or 3.0))
        seg = segdir / f"seg_{i:03d}.mp4"
        _render_plain_seg(seg, dur, clip)
        seg_files.append(seg)
        label = (b.get("spoken_line") or b.get("caption") or f"Scene {i + 1}").strip()[:40]
        scenes.append({"start": round(t0, 2), "end": round(t0 + dur, 2), "label": label})
        for w in _even_split(b.get("caption") or "", dur):
            words.append({"start": round(t0 + w["start"], 2),
                          "end": round(t0 + w["end"], 2), "word": w["word"]})
        t0 += dur

    source = project_dir / "source.mp4"
    _concat_segments(seg_files, source, W, H)
    return {"duration": round(t0, 2), "scenes": scenes, "words": words}


def render_scene_reel(source: Path, out_path: Path, markers: list[dict],
                      words: list[dict], scene_vos: list, preset_name: str,
                      style: dict | None = None,
                      out_w: int = W, out_h: int = H,
                      cuts: list | None = None) -> Path:
    """Voice-first export of a stitched reel: re-time each scene to its own voiceover.
    For each scene marker [s,e]: take the kept video of that range (with any `cuts`
    REMOVED, not just greyed); if it has a VO, loop the video to the VO duration with
    that scene's caption text even-split across the VO; otherwise keep the natural
    (post-cut) length. Words inside a cut are dropped. Concat the scenes."""
    cuts = cuts or []
    work = out_path.parent / f"_scenes_{out_path.stem}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)

    seg_files: list[Path] = []
    for i, m in enumerate(markers):
        s, e = float(m["start"]), float(m["end"])
        # A scene whose whole range was cut away (e.g. the user deleted that clip) is
        # dropped entirely — its voice goes with it.
        if any(float(c[0]) <= s + 0.05 and float(c[1]) >= e - 0.05 for c in cuts):
            continue
        # The kept pieces of this scene after removing cuts — the scene "as edited".
        scene_segs = kept_segments(s, e, cuts)
        vo = scene_vos[i] if i < len(scene_vos) else None
        has_vo = bool(vo and Path(vo).exists())
        # Only the words that survive the cuts (others are gone with the video).
        scene_words = [w for w in words
                       if any(w["end"] > a and w["start"] < b for a, b in scene_segs)]

        # Build the scene's raw video from its kept pieces (cuts spliced out).
        raw = work / f"raw_{i:03d}.mp4"
        if len(scene_segs) == 1:
            a, b = scene_segs[0]
            cut_cmd = ["ffmpeg", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(source),
                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", str(raw)]
        else:
            parts = [f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{j}];"
                     for j, (a, b) in enumerate(scene_segs)]
            concat_in = "".join(f"[v{j}]" for j in range(len(scene_segs)))
            fc = "".join(parts) + f"{concat_in}concat=n={len(scene_segs)}:v=1:a=0[vout]"
            cut_cmd = ["ffmpeg", "-y", "-i", str(source), "-filter_complex", fc, "-map", "[vout]",
                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", str(raw)]
        proc = subprocess.run(cut_cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"scene {i + 1} cut failed:\n{proc.stderr[-1200:]}")

        kept_dur = sum(b - a for a, b in scene_segs)
        if has_vo:
            dur = max(0.8, float(probe_duration(Path(vo)) or kept_dur))
            local_words = _even_split(" ".join(w["word"] for w in scene_words), dur)
        else:
            dur = max(0.8, float(kept_dur))
            # Re-time captions onto the post-cut (compressed) scene timeline.
            local_words, _ = remap_words_for_cuts(scene_words, scene_segs)

        ass = work / f"seg_{i:03d}.ass"
        write_ass(local_words, 0.0, dur, preset_name, ass, overrides=style)
        subs = f"subtitles='{_escape_subtitles_path(ass)}'"
        fd = _fonts_dir()
        if fd:
            subs += f":fontsdir='{fd}'"
        rw, rh = probe_size(raw)
        vf = f"{crop_filter(rw, rh, '9:16', 0.5, out_w, out_h)},{subs}"

        seg = work / f"seg_{i:03d}.mp4"
        cmd = ["ffmpeg", "-y", "-stream_loop", "-1", "-i", str(raw)]
        cmd += (["-i", str(vo)] if has_vo
                else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
        cmd += ["-t", f"{dur:.3f}", "-vf", vf, "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
                "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac", "-ar", "48000", "-ac", "2", str(seg)]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"scene {i + 1} render failed:\n{proc.stderr[-1200:]}")
        seg_files.append(seg)

    _concat_segments(seg_files, out_path, out_w, out_h)
    return out_path


def assemble_ticket(ticket_id: int, progress=None) -> Path:
    """Stitch a ticket's beats (in order_index) into data/tickets/{id}/reel.mp4.
    Raises on the proof guard or any ffmpeg failure."""
    from app.db import Beat, Ticket, get_session
    from sqlmodel import select

    with get_session() as s:
        if not s.get(Ticket, ticket_id):
            raise RuntimeError("ticket not found")
        beats = [b.model_dump() for b in s.exec(
            select(Beat).where(Beat.ticket_id == ticket_id).order_by(Beat.order_index)).all()]

    if not beats:
        raise RuntimeError("ticket has no beats to assemble")

    # PROOF GUARD — a beat stating a real number must show the product/label on screen.
    gaps = [b for b in beats if b["is_proof_beat"] and not (b["clip_path"] and Path(b["clip_path"]).exists())]
    if gaps:
        raise RuntimeError(
            f"{len(gaps)} proof beat(s) missing a clip — add the product/label footage first")

    td = ticket_dir(ticket_id)
    segdir = td / "segs"
    shutil.rmtree(segdir, ignore_errors=True)
    segdir.mkdir(parents=True, exist_ok=True)

    seg_files: list[Path] = []
    for i, b in enumerate(beats):
        if progress:
            progress(f"Rendering beat {i + 1}/{len(beats)}")
        seg = segdir / f"seg_{i:03d}.mp4"
        _render_beat(b, seg, segdir)
        seg_files.append(seg)

    if progress:
        progress("Stitching reel")
    reel = td / "reel.mp4"
    _concat_segments(seg_files, reel, W, H)
    # FUTURE: write the reel to object storage instead of local disk.
    return reel
