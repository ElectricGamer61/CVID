"""The pasted-script parser: what Create promises ("plain lines work") must hold.

Offline, deterministic - no server, no LLM.
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from app import intake  # noqa: E402

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


def test_plain_lines_become_scenes():
    """A script typed one sentence per line (no blank lines) used to collapse into ONE scene."""
    parsed = intake.parse_script("Stop eating sugar for breakfast.\nMost cereals are candy.\nTry eggs.\n")
    check("one line = one scene", len(parsed["beats"]) == 3)
    check("scenes keep their order",
          [b["spoken_line"] for b in parsed["beats"]] ==
          ["Stop eating sugar for breakfast.", "Most cereals are candy.", "Try eggs."])
    check("captions default to the spoken line", parsed["beats"][1]["caption"] == "Most cereals are candy.")


def test_paragraphs_still_become_scenes():
    parsed = intake.parse_script("First scene line one.\nstill scene one.\n\nSecond scene.\n")
    check("blank lines separate scenes", len(parsed["beats"]) == 2)
    check("lines inside a paragraph join", parsed["beats"][0]["spoken_line"] == "First scene line one. still scene one.")


def test_labeled_single_scene_stays_one_scene():
    parsed = intake.parse_script("Spoken: Hello there.\nShot: close-up of the label\nOn-screen: HELLO\n")
    check("labeled fields describe one scene", len(parsed["beats"]) == 1)
    check("fields land where they belong",
          parsed["beats"][0]["shot_cue"] == "close-up of the label" and parsed["beats"][0]["on_screen_text"] == "HELLO")


def test_labeled_format_and_hook():
    parsed = intake.parse_script("HOOK: The one line\n\nBEAT\nSpoken: A\nShot: a\n\nBEAT\nSpoken: B has 3 grams\n")
    check("hook is lifted off the top", parsed["hook"] == "The one line")
    check("BEAT delimiters split scenes", len(parsed["beats"]) == 2)
    check("a number flags a proof scene", parsed["beats"][1]["is_proof_beat"] and not parsed["beats"][0]["is_proof_beat"])


def test_single_line_is_one_scene():
    parsed = intake.parse_script("Just one line.")
    check("a single line is a single scene", len(parsed["beats"]) == 1)


if __name__ == "__main__":
    test_plain_lines_become_scenes()
    test_paragraphs_still_become_scenes()
    test_labeled_single_scene_stays_one_scene()
    test_labeled_format_and_hook()
    test_single_line_is_one_scene()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
