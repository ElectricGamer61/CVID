"""Hyphenated words Whisper splits ("decision" + "-maker") must read and caption as one word.

Offline and pure.
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from app.pipeline.transcribe import merge_word_pieces  # noqa: E402

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


W = lambda s, e, t: {"start": s, "end": e, "word": t}

words = [W(0.0, 0.4, " the"), W(0.4, 0.9, " decision"), W(0.9, 1.3, "-maker"), W(1.3, 1.6, " will"),
         W(2.0, 2.3, " all"), W(2.3, 2.8, "-nighters."), W(3.0, 3.2, " -"), W(3.2, 3.5, " wait")]
merged = merge_word_pieces(words)
check("a hyphen piece joins the word before it",
      [w["word"] for w in merged][:3] == [" the", " decision-maker", " will"])
check("the joined word spans both timings", merged[1]["start"] == 0.4 and merged[1]["end"] == 1.3)
check("punctuation on the piece is kept", any(w["word"] == " all-nighters." for w in merged))
check("a spoken dash with a leading space is a word of its own", any(w["word"] == " -" for w in merged))
check("idempotent", merge_word_pieces(merged) == merged)
check("input is not mutated", words[1]["word"] == " decision")
check("a leading piece with nothing before it is kept", merge_word_pieces([W(0, 1, "-x")])[0]["word"] == "-x")

if __name__ == "__main__":
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
