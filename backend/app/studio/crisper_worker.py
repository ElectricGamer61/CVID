"""CrisperWhisper 2.0 speech worker. Runs on the CrisperWhisper engine's OWN Python
(settings.CRISPER_PYTHON), never Cvideo's: it needs PyTorch, which Cvideo does not install.
So it imports nothing from Cvideo except the standard-library protocol module next to it.

Verbatim mode: every um, stutter, cut-off word and laugh is written down, which is what the
Cut room needs to find them. Weights are licensed for non-commercial use only.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import worker_protocol as wp  # noqa: E402


def load(job):
    from crisperwhisper import CrisperWhisperModel
    wp.say("PROGRESS", 0, 0, "Loading CrisperWhisper (first run downloads about 3 GB)")
    return CrisperWhisperModel(job.get("model") or "large")


def transcribe(model, audio, job, progress):
    r = model.transcribe(audio, language=job.get("language") or None, mode="verbatim",
                         word_timestamps=True)
    progress(100)
    # Audio with no speech in it comes back with words=None, not an empty list.
    return [{"start": float(w.start), "end": float(w.end), "word": w.word}
            for w in (r.words or []) if (w.word or "").strip()]


if __name__ == "__main__":
    sys.exit(wp.run(transcribe, load))
