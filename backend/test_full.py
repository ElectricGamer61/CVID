"""Full AI-pipeline test on a local spoken video (no YouTube needed):
extract audio -> transcribe (faster-whisper) -> brain (ollama) -> render clip 0.
"""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

# Windows consoles default to cp1252; force UTF-8 so prints never crash.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import settings  # noqa: E402
from app.pipeline import brain, captions, ingest, render, transcribe  # noqa: E402

SRC = settings.DATA_DIR / "_verify" / "test_speech.mp4"


def main():
    assert SRC.exists(), f"missing {SRC} (run the TTS step first)"
    work = settings.DATA_DIR / "_verify"
    audio = work / "test_speech.wav"

    print("1. Extract audio…")
    ingest.extract_audio(SRC, audio)

    print("2. Transcribe (downloads model on first run)…")
    t0 = time.time()
    result = transcribe.transcribe(audio)
    print(f"   device={result['device']} lang={result['language']} "
          f"words={len(result['words'])} in {time.time()-t0:.1f}s")
    print("   text:", result["text"][:200], "…")
    assert result["words"], "no words transcribed"

    print("3. Brain (ollama)…")
    t0 = time.time()
    clips = brain.find_moments(result["words"], "ollama")
    print(f"   {len(clips)} clips in {time.time()-t0:.1f}s")
    for c in clips:
        print(f"     [{c['start']:.1f}-{c['end']:.1f}] score={c['score']:.0f} {c['title']}")
    assert clips, "brain returned no clips"

    print("4. Render clip 0 (crop + captions)…")
    c = clips[0]
    ass = work / "full_clip0.ass"
    captions.write_ass(result["words"], c["start"], c["end"], "capcut", ass)
    out = work / "full_clip0.mp4"
    render.render_clip(SRC, out, c["start"], c["end"], "9:16", ass, center=0.5)
    print(f"   rendered -> {out} ({out.stat().st_size} bytes)")
    assert out.exists() and out.stat().st_size > 0

    print("\nFULL PIPELINE PASSED")


if __name__ == "__main__":
    main()
