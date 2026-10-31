"""Shot-aware reframe: the 9:16 crop moves at camera cuts, and only there.

A synthetic two-shot clip (no faces, no network): shot 1 is red | blue, then a hard cut to
green | yellow. Checks that the cut is found, that an export with a track really moves its
crop window at the cut (left half of shot 1, right half of shot 2), that the pure helpers
agree, and that dragging the crop by hand drops the automatic track.
Real ffmpeg renders; skipped with a printed reason when ffmpeg is missing.
"""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.TemporaryDirectory()
os.environ["CVIDEO_DATA_DIR"] = _TMP.name            # must precede the settings import
sys.path.insert(0, str(Path(__file__).parent))

import cv2                                            # noqa: E402
from app.pipeline import captions, reframe, render    # noqa: E402

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


def make_two_shots(folder: Path) -> Path:
    src = folder / "two_shots.mp4"
    inputs = []
    for color in ("red", "blue", "green", "yellow"):
        inputs += ["-f", "lavfi", "-i", f"color=c={color}:s=640x720:d=2:r=24"]
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs,
                    "-f", "lavfi", "-i", "sine=frequency=330:duration=4",
                    "-filter_complex", "[0][1]hstack[a];[2][3]hstack[b];[a][b]concat=n=2:v=1:a=0[v]",
                    "-map", "[v]", "-map", "4:a", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src)], check=True)
    return src


def mean_bgr(video: Path, t: float):
    cap = cv2.VideoCapture(str(video))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    cap.release()
    return frame.reshape(-1, 3).mean(axis=0) if ok else None


def test_cut_detection(src: Path):
    cuts = reframe.detect_cuts(src, 0.0, 4.0)
    check(f"finds exactly one cut, at 2s (got {cuts})", len(cuts) == 2 and abs(cuts[1] - 2.0) <= 0.3)
    track = reframe.detect_track(src, 0.0, 4.0)
    check("faceless shots stay centered and merge into one position",
          len(track["shots"]) == 1 and track["shots"][0]["center"] == 0.5)


def test_export_follows_the_track(folder: Path, src: Path):
    track = {"start": 0.0, "end": 4.0, "shots": [{"start": 0.0, "center": 0.2}, {"start": 2.0, "center": 0.8}]}
    ass = folder / "c.ass"
    captions.write_ass([], 0.0, 4.0, "clean", ass)
    out = folder / "tracked.mp4"
    render.render_clip(src, out, 0.0, 4.0, "9:16", ass, 0.5, 360, 640, track=track)
    b, g, r = mean_bgr(out, 1.0)
    check(f"shot 1 is cropped on the left (red) - bgr {b:.0f},{g:.0f},{r:.0f}", r > 180 and g < 80 and b < 80)
    b, g, r = mean_bgr(out, 3.0)
    check(f"shot 2 is cropped on the right (yellow) - bgr {b:.0f},{g:.0f},{r:.0f}", r > 180 and g > 180 and b < 80)
    # Same track across a cut that removes 1.5-2.5 s: shot 2 now starts at 1.5 s of output.
    out2 = folder / "tracked_cut.mp4"
    segments = render.kept_segments(0.0, 4.0, [[1.5, 2.5]])
    render.render_clip_segments(src, out2, segments, "9:16", ass, 0.5, 360, 640, track=track)
    b, g, r = mean_bgr(out2, 2.0)
    check(f"with a cut, the switch moves to the seam (yellow at 2.0s) - bgr {b:.0f},{g:.0f},{r:.0f}",
          r > 180 and g > 180 and b < 80)


def test_pure_helpers():
    track = {"start": 10, "end": 40, "shots": [{"start": 10, "center": 0.6}, {"start": 20, "center": 0.3}]}
    check("center holds until the next cut",
          reframe.track_center_at(track, 19.9) == 0.6 and reframe.track_center_at(track, 20) == 0.3)
    check("median is weighted by shot length", abs(reframe.track_median(track) - (0.6 * 10 + 0.3 * 20) / 30) < 1e-3)
    check("coverage", reframe.track_covers(track, 12, 38) and not reframe.track_covers(track, 5, 38))
    expr = reframe.track_x_expr(track, 1280, 405, [0.0, 10.0])
    check(f"x expression switches at the cut ({expr})", expr == "if(lt(t,10.000),566,182)")


def test_each_thread_gets_its_own_detector():
    """A shared detector let two concurrent exports corrupt each other's face search."""
    import threading
    mine = reframe._yunet_detector()
    if mine is None:
        print("  skip per-thread detector check (YuNet model unavailable offline)")
        return
    other = []
    th = threading.Thread(target=lambda: other.append(reframe._yunet_detector()))
    th.start(); th.join()
    check("the same thread reuses its detector", reframe._yunet_detector() is mine)
    check("another thread gets its own detector", other and other[0] is not None and other[0] is not mine)


def test_hand_placed_crop_drops_the_track():
    import json
    from app import main
    from app.db import Clip, Project, get_session, init_db
    init_db()
    with get_session() as s:
        p = Project(name="t", source_type="file"); s.add(p); s.commit(); s.refresh(p)
        c = Clip(project_id=p.id, start=0, end=4, crop_center=0.62,
                 crop_track_json=json.dumps({"start": 0, "end": 4, "shots": [{"start": 0, "center": 0.62}]}))
        s.add(c); s.commit(); s.refresh(c); cid = c.id
    main.patch_clip(cid, main.ClipPatch(crop_center=0.62, title="autosave"))
    with get_session() as s:
        check("an autosave that does not move the crop keeps the track", s.get(Clip, cid).crop_track_json is not None)
    main.patch_clip(cid, main.ClipPatch(crop_center=0.3))
    with get_session() as s:
        check("moving the crop by hand drops the track", s.get(Clip, cid).crop_track_json is None)
    from app import db
    db._engine.dispose()


if __name__ == "__main__":
    test_pure_helpers()
    test_hand_placed_crop_drops_the_track()
    test_each_thread_gets_its_own_detector()
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            src = make_two_shots(folder)
            test_cut_detection(src)
            test_export_follows_the_track(folder, src)
    else:
        print("SKIPPED render checks: ffmpeg/ffprobe not installed")
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
