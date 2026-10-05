"""The built-in moment finder: what a keyless, Ollama-less install uses.

Offline and deterministic. It must behave like an editor, not a metronome: prefer a
scroll-stopping opening over filler, give clips real titles, keep lengths inside the
configured bounds, and never overlap itself.
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import settings                                   # noqa: E402
from app.pipeline import brain, local_scorer      # noqa: E402

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


def _words(sentences: list[str], start: float = 0.0, wps: float = 2.8) -> list[dict]:
    """Turn sentences into evenly timed word dicts."""
    out, t = [], start
    for s in sentences:
        for w in s.split():
            out.append({"start": round(t, 3), "end": round(t + 1 / wps, 3), "word": w})
            t += 1 / wps
        t += 0.3
    return out


FILLER = "and then we went to the store and we looked at the things on the shelves for a while."
HOOK = "Why do most people fail at this? Nobody tells you the one mistake that costs you money."
BODY = "I lost everything in my first year. It was the hardest thing I ever did. But it worked."


def test_hooky_section_outranks_filler():
    # 5 minutes of filler with one strong passage in the middle.
    sentences = [FILLER] * 40 + [HOOK, BODY] + [FILLER] * 40
    words = _words(sentences)
    clips = brain.find_moments(words, "heuristic", n=6)
    check("returns clips", len(clips) > 0)
    top = max(clips, key=lambda c: c["score"])
    hook_start = next(w["start"] for w in words if w["word"] == "Why")
    check("the strongest clip starts at the hook", abs(top["start"] - hook_start) < 2.0)
    check("the hook is quoted", top["hook"].startswith("Why do most people fail"))
    check("the reason names the signal", "question" in top["reason"])
    check("scores are spread, not flat", max(c["score"] for c in clips) - min(c["score"] for c in clips) >= 10)


def test_shape_and_titles():
    words = _words([FILLER, HOOK, BODY] * 20)
    clips = brain.find_moments(words, "heuristic", n=6)
    check("at most n clips", len(clips) <= 6)
    check("every clip inside the length bounds",
          all(settings.MIN_CLIP_SEC - 0.5 <= c["end"] - c["start"] <= settings.MAX_CLIP_SEC + 0.5 for c in clips))
    check("no clip is called Moment N", all(not c["title"].startswith("Moment ") for c in clips))
    check("titles are title-cased from the opening words",
          all(c["title"][:1].isupper() for c in clips))
    ordered = sorted(clips, key=lambda c: c["start"])
    check("clips do not overlap",
          all(b["start"] >= a["end"] - 0.01 for a, b in zip(ordered, ordered[1:])))


def test_unpunctuated_transcript_still_yields_clips():
    words = _words([s.replace(".", "").replace("?", "") for s in [FILLER, HOOK, BODY] * 15])
    clips = brain.find_moments(words, "heuristic", n=4)
    check("works without sentence punctuation", 1 <= len(clips) <= 4)


def test_short_video_is_one_clip():
    words = _words([HOOK])                        # ~6 seconds, under MIN_CLIP_SEC
    clips = local_scorer.pick_moments(words, 6)
    check("a video shorter than one clip becomes a single whole clip", len(clips) == 1)


def test_empty():
    try:
        brain.find_moments([], "heuristic")
        check("a silent video is a clear error, not a crash or a silent empty list", False)
    except RuntimeError as e:
        check("a silent video is a clear error, not a crash or a silent empty list",
              "no speech was found" in str(e))


if __name__ == "__main__":
    test_hooky_section_outranks_filler()
    test_shape_and_titles()
    test_unpunctuated_transcript_still_yields_clips()
    test_short_video_is_one_clip()
    test_empty()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
