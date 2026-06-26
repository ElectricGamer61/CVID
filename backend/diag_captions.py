"""Diagnose whether captions actually burn in.

Renders the same clip WITH and WITHOUT the subtitles filter, extracts a frame at a
caption timestamp from each, and reports the mean pixel difference. ~0 difference =
captions are NOT rendering (the bug). Large difference = captions are visible.
"""
from __future__ import annotations

import io
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import settings  # noqa: E402
from app.pipeline import captions, render  # noqa: E402
from app.pipeline.reframe import crop_filter, probe_size  # noqa: E402

WORK = settings.DATA_DIR / "_verify"
SRC = WORK / "test_speech.mp4"


def words_for():
    text = "this is the cvideo caption test the words should appear on screen now".split()
    out, t = [], 1.0
    for w in text:
        out.append({"start": round(t, 2), "end": round(t + 0.4, 2), "word": w})
        t += 0.45
    return out


def render_plain(src, out, start, end):
    sw, sh = probe_size(src)
    vf = crop_filter(sw, sh, "9:16", 0.5, settings.OUT_W, settings.OUT_H)
    cmd = ["ffmpeg", "-y", "-ss", f"{start}", "-to", f"{end}", "-i", str(src),
           "-vf", vf, "-c:v", "libx264", "-an", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)


def frame_at(video, t, out_png):
    cmd = ["ffmpeg", "-y", "-ss", f"{t}", "-i", str(video), "-frames:v", "1", str(out_png)]
    subprocess.run(cmd, check=True, capture_output=True)


def main():
    assert SRC.exists(), f"missing {SRC}"
    words = words_for()
    start, end = 0.0, 8.0
    cap_t = 3.0  # a timestamp with a caption

    ass = WORK / "diag.ass"
    captions.write_ass(words, start, end, "capcut", ass)
    print("ASS sample (first 3 dialogue lines):")
    for ln in [l for l in ass.read_text(encoding="utf-8").splitlines()
               if l.startswith("Dialogue")][:3]:
        print("  ", ln)

    with_subs = WORK / "diag_with.mp4"
    no_subs = WORK / "diag_plain.mp4"
    render.render_clip(SRC, with_subs, start, end, "9:16", ass, center=0.5)
    render_plain(SRC, no_subs, start, end)

    fa, fb = WORK / "f_with.png", WORK / "f_plain.png"
    frame_at(with_subs, cap_t, fa)
    frame_at(no_subs, cap_t, fb)

    a = cv2.imread(str(fa)).astype(np.int16)
    b = cv2.imread(str(fb)).astype(np.int16)
    diff = np.abs(a - b)
    mean_diff = float(diff.mean())
    changed = int((diff.sum(axis=2) > 30).sum())
    print(f"\nmean pixel diff = {mean_diff:.3f}")
    print(f"changed pixels  = {changed}")
    if mean_diff < 0.5:
        print("=> CAPTIONS NOT RENDERING (frames identical)")
    else:
        print("=> captions ARE rendering (frames differ)")


if __name__ == "__main__":
    main()
