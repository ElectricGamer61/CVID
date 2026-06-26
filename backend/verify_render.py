"""Offline verification of the render half of the pipeline.

Synthesizes a 16:9 test video with ffmpeg, then runs reframe + captions + render
to produce a real 1080x1920 vertical mp4 with burned word-by-word captions.
No models, no network, no GPU required — just proves the ffmpeg/ASS/crop code works.

Run:  .\.venv\Scripts\python.exe verify_render.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import settings  # noqa: E402
from app.pipeline import brain, captions, reframe, render  # noqa: E402


def make_test_video(path: Path, seconds: int = 6):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=1280x720:rate=30",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def fake_words():
    text = "this is a test of the cvideo caption and reframe pipeline it works".split()
    words = []
    t = 0.5
    for w in text:
        words.append({"start": round(t, 2), "end": round(t + 0.35, 2), "word": w})
        t += 0.4
    return words


def main():
    out_dir = settings.DATA_DIR / "_verify"
    out_dir.mkdir(parents=True, exist_ok=True)
    src = out_dir / "test_src.mp4"
    print("1. Synthesizing test video…")
    make_test_video(src)
    assert src.exists() and src.stat().st_size > 0, "test video not created"

    print("2. crop_filter math…")
    vf = reframe.crop_filter(1280, 720, "9:16", 0.5, settings.OUT_W, settings.OUT_H)
    print("   ", vf)
    assert "crop=" in vf and f"scale={settings.OUT_W}:{settings.OUT_H}" in vf

    print("3. brain heuristic + normalize…")
    words = fake_words()
    clips = brain.HeuristicScorer().score(words, 2)
    assert clips, "heuristic returned no clips"
    print("   ", clips[0])

    print("4. build ASS captions for each preset…")
    for preset in captions.PRESETS:
        ass = out_dir / f"cap_{preset}.ass"
        captions.write_ass(words, 0.0, 6.0, preset, ass)
        body = ass.read_text(encoding="utf-8")
        assert "Dialogue:" in body, f"no dialogue lines for {preset}"
    print("   presets OK:", list(captions.PRESETS))

    print("5. render a real vertical clip (crop + burn captions)…")
    ass = out_dir / "cap_capcut.ass"
    out = out_dir / "verify_out.mp4"
    render.render_clip(src, out, 0.5, 5.5, "9:16", ass, center=0.5)
    assert out.exists() and out.stat().st_size > 0, "render produced no file"

    # confirm output is 1080x1920
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True,
    )
    print("   output WxH:", probe.stdout.strip())
    assert probe.stdout.strip().startswith(f"{settings.OUT_W},{settings.OUT_H}")

    print(f"\nALL RENDER CHECKS PASSED -> {out}")


if __name__ == "__main__":
    main()
