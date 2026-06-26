"""Verify pt.4: upgraded brain (hooks + criteria), chunking, sentence snapping."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import settings  # noqa: E402
from app.pipeline import brain  # noqa: E402


def load_words():
    f = settings.PROJECTS_DIR / "1" / "words.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8")).get("words", [])
    # fallback: synthetic
    return [{"start": i * 0.4, "end": i * 0.4 + 0.35, "word": w}
            for i, w in enumerate(("this is a test sentence. and here is another one! "
                                   "now a third thought? final words here.").split())]


def main():
    words = load_words()
    print(f"Loaded {len(words)} words, {words[-1]['end']:.0f}s\n")

    print("== Brain (ollama) with virality framework ==")
    clips = brain.find_moments(words, "ollama")
    for c in clips[:6]:
        print(f"  [{c['start']:.0f}-{c['end']:.0f}] score={c['score']:.0f}")
        print(f"     title: {c['title']}")
        print(f"     hook:  {c.get('hook','')[:80]}")
        print(f"     why:   {c['reason'][:90]}")
    assert clips, "no clips"
    has_hooks = sum(1 for c in clips if c.get("hook"))
    print(f"\n  clips={len(clips)}, with hook_sentence={has_hooks}")

    print("\n== Chunking on a synthetic ~40-min transcript ==")
    long_words = []
    base = words or load_words()
    span = (base[-1]["end"] - base[0]["start"]) or 60
    reps = int(2400 / span) + 1  # ~40 min
    for r in range(reps):
        off = r * span
        for w in base:
            long_words.append({"start": w["start"] + off, "end": w["end"] + off, "word": w["word"]})
    chunks = brain._chunk_words(long_words)
    print(f"  synthetic duration={long_words[-1]['end']:.0f}s -> {len(chunks)} chunks")
    assert len(chunks) > 1, "long transcript should chunk"

    print("\n== Sentence snapping ==")
    snap = brain._snap_sentence(base[2]["start"] + 0.2, base, use_end=False)
    print(f"  start snap near a sentence boundary -> {snap}")

    print("\nPT4 BRAIN CHECKS PASSED")


if __name__ == "__main__":
    main()
