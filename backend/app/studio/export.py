"""Render the edit: what is left after the cuts, from the ORIGINAL clips, in one ffmpeg pass.

Every clip is read once and split into the pieces that survive its cuts; the pieces of all
clips are joined with the concat FILTER (not the demuxer: Cvideo learned the demuxer leaves
timestamp and AAC-priming gaps at every join, see assemble._concat_segments). Each piece
starts at its own sync point, so rounding to whole frames never accumulates into drift
across hundreds of cuts.

Every seam gets an 8 ms audio fade out and in. A cut almost never lands on a zero crossing,
and without the fade each one clicks; 8 ms is far too short to hear as a dip.

One encode only: picture and sound go from the originals straight to the final file.

Every piece is cut to a WHOLE number of output frames, in picture and sound alike, and the
captions are timed with those same lengths. Left to ffmpeg, each piece rounded up by a part
of a frame: 51 cuts made a real 4-minute talk 0.2 s longer than planned, and the captions
(timed on the plan) slid behind; a 1-hour edit with 1,000 cuts would drift by seconds.
"""
from __future__ import annotations

import re
import subprocess
import threading
import traceback
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from . import store
from .media import _rate

SEAM_FADE = 0.008
_jobs: dict[str, dict] = {}
_procs: dict[str, subprocess.Popen] = {}
_guard = threading.Lock()


@dataclass(frozen=True)
class Segment:
    clip: str
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def frames_of(s: Segment, fmt: dict) -> int:
    return max(1, round(s.duration * fmt["rate"]))


def out_length(s: Segment, fmt: dict) -> float:
    """How long this piece is in the finished video: whole frames, exactly."""
    return float(frames_of(s, fmt) / fmt["frac"])


def merged_cuts(p: store.Project, clip_id: str, duration: float) -> list[tuple[float, float]]:
    rs = sorted((max(0.0, c.start), min(duration, c.end)) for c in p.cuts
                if c.clip == clip_id and c.end > c.start)
    out: list[list[float]] = []
    for a, b in rs:
        if out and a <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out if b > a]


def target_format(p: store.Project) -> dict:
    """Output size and frame rate: the project's export setting, else the first video clip's."""
    want = p.settings.get("export") or {}
    first = next((c for c in p.clips if c.width and c.height), None)
    w = int(want.get("width") or (first.width if first else 1920))
    h = int(want.get("height") or (first.height if first else 1080))
    fps = str(want.get("fps") or (first.fps if first and first.fps else "30"))
    rate = _rate(fps) or 30.0
    if rate > 60:
        fps, rate = "60", 60.0
    frac = Fraction(fps) if rate == _rate(fps) else Fraction(30)
    return {"width": w - w % 2, "height": h - h % 2, "fps": fps, "rate": float(frac), "frac": frac}


def kept_segments(p: store.Project, min_len: float | None = None) -> list[Segment]:
    """Timeline order: clips in order, each clip's surviving pieces in time order."""
    if min_len is None:
        min_len = 1.0 / target_format(p)["rate"]   # anything shorter than a frame is nothing
    segs: list[Segment] = []
    for c in p.clips:
        if c.duration <= 0:                 # never probed: nothing Studio can read
            continue
        t = 0.0
        for a, b in merged_cuts(p, c.id, c.duration):
            if a - t >= min_len:
                segs.append(Segment(c.id, t, a))
            t = max(t, b)
        if c.duration - t >= min_len:
            segs.append(Segment(c.id, t, c.duration))
    return segs


def build_graph(p: store.Project, segs: list[Segment], media_of) -> tuple[list[str], str]:
    """(input files, filter_complex text) producing [vout] and [aout]."""
    fmt = target_format(p)
    W, H, FPS = fmt["width"], fmt["height"], fmt["fps"]
    clips = {c.id: c for c in p.clips}
    inputs: list[str] = []
    index: dict[str, int] = {}
    uses: dict[str, int] = {}
    for s in segs:
        if s.clip not in index:
            index[s.clip] = len(inputs)
            inputs.append(str(media_of(clips[s.clip])))
        uses[s.clip] = uses.get(s.clip, 0) + 1

    lines: list[str] = []
    for cid, k in index.items():
        c, n = clips[cid], uses[cid]
        if c.width and c.height:                       # has a picture
            lines.append(f"[{k}:v]" + (f"split={n}" if n > 1 else "null")
                         + "".join(f"[v{k}_{i}]" for i in range(n)))
        if c.has_audio:
            lines.append(f"[{k}:a]" + (f"asplit={n}" if n > 1 else "anull")
                         + "".join(f"[a{k}_{i}]" for i in range(n)))

    taken: dict[str, int] = {}
    pairs = []
    for j, s in enumerate(segs):
        c, k = clips[s.clip], index[s.clip]
        i = taken.get(s.clip, 0)
        taken[s.clip] = i + 1
        a, b = f"{s.start:.6f}", f"{s.end:.6f}"
        n, d = frames_of(s, fmt), out_length(s, fmt)
        if c.width and c.height:
            # fps can leave a piece a frame short or long: pad with a copy of its last frame,
            # then keep exactly n frames.
            lines.append(
                f"[v{k}_{i}]trim=start={a}:end={b},setpts=PTS-STARTPTS,"
                f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={FPS},"
                f"tpad=stop_mode=clone:stop_duration=0.2,trim=end_frame={n},setpts=PTS-STARTPTS,"
                f"format=yuv420p[sv{j}]")
        else:                                          # sound-only clip: black picture
            lines.append(f"color=c=black:s={W}x{H}:r={FPS}:d={d:.6f},format=yuv420p,setsar=1[sv{j}]")
        if c.has_audio:
            # Fade out where the SOUND ends: the real piece or the frame-rounded length,
            # whichever is shorter. Fading at the padded end left the real sound stopping
            # dead before the padding: a click at every seam (caught by test_studio.py).
            heard = min(d, s.duration)
            fade = ""
            if heard > 4 * SEAM_FADE:
                fade = (f"afade=t=in:d={SEAM_FADE},"
                        f"afade=t=out:st={heard - SEAM_FADE:.6f}:d={SEAM_FADE},")
            lines.append(f"[a{k}_{i}]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,"
                         f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                         f"atrim=end={heard:.6f},{fade}apad=whole_dur={d:.6f},atrim=end={d:.6f}[sa{j}]")
        else:
            lines.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.6f}[sa{j}]")
        pairs.append(f"[sv{j}][sa{j}]")
    lines.append("".join(pairs) + f"concat=n={len(segs)}:v=1:a=1[vout][aout]")
    return inputs, ";\n".join(lines)


def _fmt_ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def edited_words(p: store.Project, segs: list[Segment], words_of) -> list[dict]:
    """The words that survive, re-timed onto the edited timeline (fillers and noises dropped).
    Offsets add up the frame-exact piece lengths the render really produces."""
    fmt = target_format(p)
    out: list[dict] = []
    offset = 0.0
    cache: dict[str, list[dict]] = {}
    for s in segs:
        ws = cache.setdefault(s.clip, words_of(s.clip))
        for w in ws:
            if w.get("kind") in ("filler", "event", "cutoff"):
                continue
            mid = (w["start"] + w["end"]) / 2
            if s.start <= mid < s.end:
                out.append({"word": w["word"],
                            "start": offset + max(0.0, w["start"] - s.start),
                            "end": offset + min(out_length(s, fmt), w["end"] - s.start)})
        offset += out_length(s, fmt)
    return out


def srt(words: list[dict], max_chars: int = 42, max_dur: float = 3.5, gap: float = 0.6) -> str:
    cues: list[list[dict]] = []
    for w in words:
        cur = cues[-1] if cues else None
        if (cur is None
                or w["start"] - cur[-1]["end"] > gap
                or w["end"] - cur[0]["start"] > max_dur
                or len(" ".join(x["word"] for x in cur + [w])) > max_chars
                or re.search(r"[.!?]$", cur[-1]["word"])):
            cues.append([w])
        else:
            cur.append(w)
    blocks = []
    for n, cue in enumerate(cues, 1):
        blocks.append(f"{n}\n{_fmt_ts(cue[0]['start'])} --> {_fmt_ts(cue[-1]['end'])}\n"
                      + " ".join(x["word"] for x in cue) + "\n")
    return "\n".join(blocks)


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip().replace(" ", "-")
    return s[:60] or "studio-export"


def status(pid: str) -> dict:
    return dict(_jobs.get(pid) or {"state": "idle"})


def start(pid: str, words_of) -> dict:
    with _guard:
        if (_jobs.get(pid) or {}).get("state") == "running":
            return status(pid)
        p = store.load(pid)
        segs = kept_segments(p)
        if not segs:
            raise ValueError("nothing left to export: every clip is cut or still processing")
        fmt = target_format(p)
        total = sum(out_length(s, fmt) for s in segs)
        out_dir = store.project_dir(pid) / "exports"
        out_dir.mkdir(exist_ok=True)
        base = _slug(p.name)
        _jobs[pid] = {"state": "running", "pct": 0, "duration": round(total, 2),
                      "file": f"{base}.mp4", "srt": f"{base}.srt", "error": ""}
    threading.Thread(target=_render, args=(pid, p, segs, total, out_dir, base, words_of),
                     daemon=True).start()
    return status(pid)


def cancel(pid: str) -> None:
    proc = _procs.get(pid)
    if proc and proc.poll() is None:
        _jobs[pid]["state"] = "cancelled"
        proc.kill()


def _render(pid, p, segs, total, out_dir: Path, base: str, words_of) -> None:
    job = _jobs[pid]
    try:
        inputs, graph = build_graph(p, segs, lambda c: store.media_path(pid, c))
        script = out_dir / "graph.txt"
        script.write_text(graph, encoding="utf-8")
        tmp = out_dir / f"{base}.part.mp4"
        cmd = ["ffmpeg", "-v", "error", "-y"]
        for f in inputs:
            cmd += ["-i", f]
        cmd += ["-/filter_complex", str(script), "-map", "[vout]", "-map", "[aout]",
                "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
                "-progress", "pipe:1", "-nostats", str(tmp)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace")
        _procs[pid] = proc
        err: list[str] = []
        threading.Thread(target=lambda: err.extend(proc.stderr), daemon=True).start()
        for line in proc.stdout:          # type: ignore[union-attr]
            if line.startswith("out_time_us="):
                try:
                    job["pct"] = min(99, int(int(line.split("=", 1)[1]) / 1e6 / total * 100))
                except ValueError:
                    pass
        code = proc.wait()
        if job["state"] == "cancelled":
            tmp.unlink(missing_ok=True)
            return
        if code != 0:
            raise RuntimeError(" ".join("".join(err).strip().splitlines()[-3:]) or f"ffmpeg exit {code}")
        tmp.replace(out_dir / f"{base}.mp4")
        script.unlink(missing_ok=True)   # kept only when a render fails, to debug it
        (out_dir / f"{base}.srt").write_text(srt(edited_words(p, segs, words_of)), encoding="utf-8")
        job.update(state="done", pct=100)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        job.update(state="error", error=" ".join(str(e).split()) or type(e).__name__)
    finally:
        _procs.pop(pid, None)
