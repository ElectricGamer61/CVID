"""Studio backend, offline: word labels, project storage, and a REAL ffmpeg export.

The export check builds three generated clips (different sizes and frame rates, one with no
picture at all), cuts pieces out of them, renders through the actual pipeline, and checks:
  - the result is exactly as long as what the cuts leave (no drift across many joins)
  - sound and picture end together
  - it has the first clip's size
  - no seam clicks (the 8 ms fades work)
  - the SRT only holds surviving words, re-timed

Run:  .venv\\Scripts\\python.exe test_studio.py      (prints ALL PASSED or the failures)
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

import settings

failures: list[str] = []
# Measured 2026-11-06: 0.005 with the seam fades, 0.40 with SEAM_FADE = 0.
CLICK_LIMIT = 0.03


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


tmp_root = Path(tempfile.mkdtemp(prefix="studio-test-"))
settings.STUDIO_DIR = tmp_root / "studio"

from app.studio import export, store, words  # noqa: E402

# ---------------------------------------------------------------- word labels
n = words.normalize([
    {"start": 0.0, "end": 0.2, "word": "[UM]"},            # CrisperWhisper filler
    {"start": 0.3, "end": 0.5, "word": "s-"},              # CrisperWhisper cut-off
    {"start": 0.6, "end": 0.9, "word": "[laughter]"},      # CrisperWhisper event
    {"start": 1.0, "end": 1.2, "word": "Uh,"},             # Scribe filler
    {"start": 1.3, "end": 1.6, "word": "keeps--"},         # Scribe cut-off
    {"start": 1.7, "end": 1.9, "text": "(laughs)", "type": "audio_event"},  # Scribe event
    {"start": 2.0, "end": 2.0, "word": "sugar."},          # zero length gets a minimum
    {"start": 2.5, "end": 2.6, "word": "co-op"},           # a hyphen INSIDE is a real word
    {"start": 3.0, "end": 3.1, "word": "   "},             # empty dropped
])
kinds = [(w["word"], w.get("kind")) for w in n]
check("labels CrisperWhisper filler", kinds[0] == ("um", "filler"), str(kinds[0]))
check("labels cut-off word", kinds[1] == ("s-", "cutoff"), str(kinds[1]))
check("labels sound event", kinds[2][1] == "event" and kinds[5][1] == "event", str(kinds))
check("labels Scribe filler, keeps display text", kinds[3] == ("Uh,", "filler"), str(kinds[3]))
check("Scribe 'keeps--' becomes 'keeps-'", kinds[4] == ("keeps-", "cutoff"), str(kinds[4]))
check("ordinary words unlabelled", kinds[6] == ("sugar.", None) and kinds[7] == ("co-op", None),
      str(kinds[6:8]))
check("zero-length word gets a length", n[6]["end"] > n[6]["start"])
check("empty tokens dropped", len(n) == 8, str(len(n)))

# ---------------------------------------------------------------- silent clips
from app.studio import media as smedia  # noqa: E402
from app.studio.processing import SILENT_BELOW_S  # noqa: E402

sr = 16000
t = np.arange(sr * 5) / sr
silence = np.zeros(sr * 5, dtype=np.float32)                       # an all-zero B-roll track
hiss = (np.random.default_rng(1).normal(0, 0.002, sr * 5)).astype(np.float32)  # camera noise
voice = (0.3 * np.sin(2 * np.pi * 180 * t) * (np.sin(2 * np.pi * 2 * t) > 0)).astype(np.float32)
check("silent track counts as silent",
      smedia.seconds_of_sound(smedia.loudness(silence, sr)) < SILENT_BELOW_S)
check("camera hiss counts as silent",
      smedia.seconds_of_sound(smedia.loudness(hiss, sr)) < SILENT_BELOW_S,
      str(smedia.seconds_of_sound(smedia.loudness(hiss, sr))))
check("speech-level sound is not silent",
      smedia.seconds_of_sound(smedia.loudness(voice, sr)) > 2.0,
      str(smedia.seconds_of_sound(smedia.loudness(voice, sr))))

# ---------------------------------------------------------------- storage
p = store.create("Test edit")
check("create writes project.json", (store.project_dir(p.id) / "project.json").exists())
p2 = store.mutate(p.id, lambda x: setattr(x, "name", "Renamed"), base_rev=0)
check("editor write bumps edit_rev", p2.edit_rev == 1 and p2.name == "Renamed")
try:
    store.mutate(p.id, lambda x: setattr(x, "name", "Stale"), base_rev=0)
    check("stale editor write is refused", False)
except store.StaleEdit as e:
    check("stale editor write is refused", e.current.name == "Renamed")
try:
    store.project_dir("../../etc")
    check("ids cannot escape the studio folder", False)
except store.NotFound:
    check("ids cannot escape the studio folder", True)

# ---------------------------------------------------------------- the API's view of a project
# What GET /api/studio/projects/{id} sends must be plain JSON (a Fraction once leaked into
# export_format and every project page answered 500).
from app.studio import routes  # noqa: E402
try:
    json.dumps(routes._view(store.load(p.id)))
    check("project view is plain JSON", True)
except TypeError as e:
    check("project view is plain JSON", False, str(e))

# ---------------------------------------------------------------- real export
media = store.project_dir(p.id) / "media"
media.mkdir(parents=True, exist_ok=True)


def gen(cmd: list[str]) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *cmd], check=True)


# A: 1280x720 @ 30, 6 s, 440 Hz tone. B: 640x360 @ 25, 4 s, 660 Hz. C: sound only, 3 s.
gen(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=6", "-f", "lavfi", "-i",
     "sine=f=440:r=48000:d=6,volume=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
     "-c:a", "aac", str(media / "aaaaaaaa.mp4")])
gen(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=4", "-f", "lavfi", "-i",
     "sine=f=660:r=44100:d=4,volume=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
     "-c:a", "aac", str(media / "bbbbbbbb.mp4")])
gen(["-f", "lavfi", "-i", "sine=f=330:r=48000:d=3,volume=6", str(media / "cccccccc.wav")])

clips = [
    store.Clip(id="aaaaaaaa", name="A", file="media/aaaaaaaa.mp4", duration=6.0, width=1280,
               height=720, fps="30", proxy="done", transcript="done"),
    store.Clip(id="bbbbbbbb", name="B", file="media/bbbbbbbb.mp4", duration=4.0, width=640,
               height=360, fps="25", proxy="done", transcript="done"),
    store.Clip(id="cccccccc", name="C", file="media/cccccccc.wav", duration=3.0, proxy="done",
               transcript="done"),
]
# Cut points sit mid-wave on purpose (a tenth of a second is a whole number of 440 Hz
# cycles, so round times would land on zero crossings and hide a missing fade).
cuts = [store.Cut(clip="aaaaaaaa", start=1.0, end=1.5), store.Cut(clip="aaaaaaaa", start=1.4, end=2.0006),
        store.Cut(clip="aaaaaaaa", start=3.3006, end=3.7), store.Cut(clip="aaaaaaaa", start=5.5, end=9.0),
        store.Cut(clip="bbbbbbbb", start=0.0, end=0.5), store.Cut(clip="bbbbbbbb", start=2.0, end=2.01),
        store.Cut(clip="cccccccc", start=1.0009, end=2.0)]


def setup(x: store.Project) -> None:
    x.clips, x.cuts = clips, cuts


store.mutate(p.id, setup)
p = store.load(p.id)
segs = export.kept_segments(p)
expect = sum(s.duration for s in segs)
# A keeps 0-1, 2-3.3, 3.7-5.5 (overlapping cuts merged, the cut past its end clamped).
# B's 10 ms cut is a real cut (a click or a breath is that short): B splits in two.
# C (sound only) keeps 0-1 and 2-3.
got = [(s.clip[0], round(s.start, 2), round(s.end, 2)) for s in segs]
check("cuts merge, clamp and split clips into pieces", got ==
      [("a", 0, 1), ("a", 2.0, 3.3), ("a", 3.7, 5.5), ("b", 0.5, 2.0), ("b", 2.01, 4.0),
       ("c", 0, 1.0), ("c", 2, 3)], str(got))

word_files = {
    "aaaaaaaa": [{"start": 0.2, "end": 0.6, "word": "Hello"}, {"start": 1.1, "end": 1.3, "word": "um", "kind": "filler"},
                 {"start": 2.2, "end": 2.6, "word": "world."}, {"start": 3.4, "end": 3.6, "word": "gone"}],
    "bbbbbbbb": [{"start": 1.0, "end": 1.4, "word": "Second"}],
    "cccccccc": [],
}
export.start(p.id, lambda cid: word_files.get(cid, []))
t0 = time.time()
while export.status(p.id)["state"] == "running" and time.time() - t0 < 120:
    time.sleep(0.3)
st = export.status(p.id)
check("export finishes", st["state"] == "done", str(st))
out = store.project_dir(p.id) / "exports" / st.get("file", "missing.mp4")
if st["state"] == "done":
    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json",
                                    "-show_streams", "-show_format", str(out)],
                                   capture_output=True, text=True).stdout)
    v = next(s for s in pr["streams"] if s["codec_type"] == "video")
    a = next(s for s in pr["streams"] if s["codec_type"] == "audio")
    vd, ad = float(v["duration"]), float(a["duration"])
    fmt = export.target_format(p)
    exact = sum(export.out_length(s, fmt) for s in segs)
    check("output is exactly what the cuts leave, to the frame", abs(vd - exact) < 0.5 / fmt["rate"]
          and abs(exact - expect) < len(segs) / fmt["rate"], f"video {vd:.4f}s vs planned {exact:.4f}s")
    check("sound and picture end together", abs(vd - ad) < 0.06, f"video {vd:.3f} audio {ad:.3f}")
    check("output takes the first clip's size", (v["width"], v["height"]) == (1280, 720),
          f"{v['width']}x{v['height']}")
    check("output frame rate is the first clip's", v["r_frame_rate"] == "30/1", v["r_frame_rate"])

    wav = tmp_root / "out.wav"
    gen(["-i", str(out), "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(wav)])
    from app.studio.media import read_wav
    samples, sr = read_wav(wav)
    # A click is broadband: the tones are all below 700 Hz, so the second difference of a
    # clean signal stays tiny (~0.006), while a seam that lands mid-wave spikes it even after
    # AAC has smoothed the step. Calibrated both ways: SEAM_FADE = 0 must fail this.
    hf = np.abs(np.diff(samples, n=2))
    worst = float(hf[sr // 10: -sr // 10].max())     # skip the file's own start and end
    check("no clicks at the seams", worst < CLICK_LIMIT, f"largest HF spike {worst:.4f}")

    srt = (out.with_suffix(".srt")).read_text(encoding="utf-8")
    check("SRT keeps surviving words", "Hello" in srt and "world." in srt and "Second" in srt, srt)
    check("SRT drops cut words and fillers", "gone" not in srt and "um" not in srt, srt)
    # "world." ends 2.6 s into A; A's cut before it runs 1.0-2.0006 -> 1.599 s in the edit.
    # "Second" starts 1.0 s into B: A keeps 1.0 + 1.3 + 1.8 = 4.1 s, B's first 0.5 s is cut
    # -> 4.6 s in the edit.
    check("SRT is re-timed onto the edit",
          "--> 00:00:01,599" in srt and "00:00:04,600 -->" in srt, srt)

print()
print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {', '.join(failures)}")
sys.exit(1 if failures else 0)
