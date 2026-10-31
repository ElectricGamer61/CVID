"""An exported clip's picture must stay in sync with its sound - including with AI zoom.

Real ffmpeg renders of a synthetic clip (no network, no project, no server). The bug this
pins: the punch-in zoom forced 30 fps on every source, so a 24 fps source's 1,042 frames were
stamped as 34.7 s of video against 43.4 s of audio - picture and captions ran 25% ahead of
the voice. Skipped with a printed reason when ffmpeg is not installed.
"""
from __future__ import annotations
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from app.pipeline import captions, render  # noqa: E402

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


def probe(path: Path, stream: str, entry: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", stream,
                          "-show_entries", f"stream={entry}", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout.strip()
    try:
        num, _, den = out.partition("/")
        return float(num) / float(den or 1)
    except ValueError:
        return 0.0


def video_seconds(path: Path) -> float:
    frames = probe(path, "v:0", "nb_frames")
    rate = probe(path, "v:0", "avg_frame_rate")
    return frames / rate if rate else 0.0


def make_source(folder: Path, rate: str, seconds: float = 4.0) -> Path:
    src = folder / f"src_{rate.replace('/', '_')}.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error",
                    "-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate={rate}:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
                    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(src)],
                   check=True)
    return src


def render_with_zoom(folder: Path, src: Path, cuts: bool) -> Path:
    words = [{"start": i * 0.5, "end": i * 0.5 + 0.4, "word": w}
             for i, w in enumerate("one two three four five six seven".split())]
    zoom = [{"t": 0.5, "scale": 1.15, "duration": 0.6}, {"t": 2.0, "scale": 1.15, "duration": 0.6}]
    ass = folder / "c.ass"
    out = folder / f"out_{src.stem}_{'cuts' if cuts else 'plain'}.mp4"
    if cuts:
        segments = render.kept_segments(0.0, 4.0, [[1.5, 2.0]])
        local, total = render.remap_words_for_cuts(words, segments)
        captions.write_ass(local, 0.0, total, "cinematic", ass)
        render.render_clip_segments(src, out, segments, "9:16", ass, 0.5, 540, 960, zoom=zoom)
    else:
        captions.write_ass(words, 0.0, 4.0, "cinematic", ass)
        render.render_clip(src, out, 0.0, 4.0, "9:16", ass, 0.5, 540, 960, zoom=zoom)
    return out


def test_zoom_keeps_sync():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for rate in ("24/1", "30000/1001", "25/1", "60/1"):
            src = make_source(folder, rate)
            for cuts in (False, True):
                out = render_with_zoom(folder, src, cuts)
                v = video_seconds(out)
                a = probe(out, "a:0", "duration")
                expect = 3.5 if cuts else 4.0
                label = f"{rate} {'with a cut' if cuts else 'plain'}"
                check(f"{label}: video {v:.2f}s matches audio {a:.2f}s",
                      abs(v - a) < 0.15 and abs(v - expect) < 0.15)
                check(f"{label}: keeps the source frame rate",
                      abs(probe(out, "v:0", "avg_frame_rate") - render._rate_value(rate)) < 0.05)


if __name__ == "__main__":
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        print("SKIPPED: ffmpeg/ffprobe not installed")
        raise SystemExit(0)
    test_zoom_keeps_sync()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
