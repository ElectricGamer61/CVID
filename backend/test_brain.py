"""Diagnose the Ollama brain: show the raw LLM response and why clips parse (or don't)."""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import settings  # noqa: E402
from app.pipeline import brain, transcribe  # noqa: E402

SRC = settings.DATA_DIR / "_verify" / "test_speech.wav"


def main():
    print("Transcribing (cached model)…")
    result = transcribe.transcribe(SRC)
    words = result["words"]
    print(f"  {len(words)} words, {words[-1]['end']:.1f}s\n")

    timed = brain.build_timed_transcript(words)
    print("TIMED TRANSCRIPT (first 400 chars):")
    print(" ", timed[:400], "\n")

    import ollama
    client = ollama.Client(host=settings.OLLAMA_HOST)
    prompt = brain._PROMPT.format(
        n=settings.TARGET_CLIP_COUNT, mins=int(settings.MIN_CLIP_SEC),
        maxs=int(settings.MAX_CLIP_SEC), transcript=timed,
    )
    print(f"Calling {settings.OLLAMA_MODEL}…")
    t0 = time.time()
    resp = client.chat(
        model=settings.OLLAMA_MODEL,
        messages=[{"role": "user", "content": prompt}],
        format="json", options={"temperature": 0.4},
    )
    raw = resp["message"]["content"]
    print(f"  done in {time.time()-t0:.1f}s\n")
    print("RAW RESPONSE:")
    print(raw)
    print("\nEXTRACTED ARRAY:")
    arr = brain._extract_json_array(raw)
    print(" ", arr)
    print("\nNORMALIZED CLIPS:")
    for c in brain._normalize(arr, words):
        print("  ", c)


if __name__ == "__main__":
    main()
