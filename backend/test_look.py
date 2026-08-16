"""Cinematic Look + big title — standalone checks (no pytest, no ffmpeg, no server).

Run: python test_look.py

Guards the two things that would hurt users most:
  * a clip with NO look/title must render exactly as it did before this feature existed;
  * the generated filter chain must be safe to splice into a `filter_complex` (linear only).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "app"))

from app.pipeline import captions as caps  # noqa: E402
from app.pipeline import look  # noqa: E402

FAILED = []


def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond:
        FAILED.append(name)


WORDS = [{"start": 1.0, "end": 1.4, "word": "hello"},
         {"start": 1.4, "end": 2.0, "word": "world"}]


def test_presets():
    print("\n[looks] preset data")
    check("six presets, 'none' first", look.LOOK_IDS[0] == "none" and len(look.LOOK_IDS) == 6,
          look.LOOK_IDS)
    check("expected ids", look.LOOK_IDS == ["none", "warm_film", "cold_cinema", "punchy",
                                            "soft_glow", "night"], look.LOOK_IDS)
    check("ids unique", len(set(look.LOOK_IDS)) == len(look.LOOK_IDS))
    check("every preset has a label + hint", all(l.label and l.hint for l in look.LOOKS))
    check("every non-none preset builds a filter",
          all(look.look_filter(i, 1.0) for i in look.LOOK_IDS[1:]))


def test_no_look_is_no_change():
    print("\n[looks] no look chosen => no change at all")
    for arg in (None, "", "none", "does_not_exist"):
        check(f"look_filter({arg!r}) == ''", look.look_filter(arg, 1.0) == "")
    check("strength 0 disables the grade", look.look_filter("punchy", 0) == "")
    check("no title => ass identical",
          caps.build_ass(WORDS, 0, 3, "capcut") == caps.build_ass(WORDS, 0, 3, "capcut", title=None))
    for empty in ({}, {"text": "   "}, {"text": ""}, None, "nope", 7):
        check(f"normalize_title({empty!r}) is None", look.normalize_title(empty) is None)
    check("blank title leaves the ass untouched",
          caps.build_ass(WORDS, 0, 3, "capcut", title={"text": "  "})
          == caps.build_ass(WORDS, 0, 3, "capcut"))


def test_filter_is_render_chain_safe():
    print("\n[looks] filter chain is safe to splice into a filter_complex")
    for lid in look.LOOK_IDS[1:]:
        for s in (0.1, 0.5, 1.0):
            f = look.look_filter(lid, s)
            check(f"{lid}@{s}: no filtergraph labels", "[" not in f and "]" not in f, f)
            check(f"{lid}@{s}: no split/blend (needs labels)",
                  "split" not in f and "blend" not in f, f)
            check(f"{lid}@{s}: no stray semicolon/newline/quote-break",
                  ";" not in f and "\n" not in f and f.count("'") % 2 == 0, f)
            check(f"{lid}@{s}: no empty chain link", ",," not in f
                  and not f.startswith(",") and not f.endswith(","), f)
            check(f"{lid}@{s}: no scientific notation", "e-" not in f and "e+" not in f, f)


def test_strength():
    print("\n[looks] strength")
    check("strength changes the chain",
          look.look_filter("warm_film", 0.2) != look.look_filter("warm_film", 1.0))
    check("out-of-range strength is clamped, not crashed",
          look.look_filter("night", 5) == look.look_filter("night", 1.0)
          and look.look_filter("night", -3) == "")
    check("garbage strength falls back to the default",
          look.look_filter("night", "abc") == look.look_filter("night", look.DEFAULT_STRENGTH))


def test_title_normalize():
    print("\n[title] normalize")
    t = look.normalize_title({"text": " Big News ", "place": "bogus", "style": "bogus",
                              "start": -4, "duration": 9999})
    check("text trimmed", t["text"] == "Big News")
    check("bad place falls back to left", t["place"] == "left")
    check("bad style falls back to bold", t["style"] == "bold")
    check("negative start clamped to 0", t["start"] == 0.0)
    check("silly duration clamped", t["duration"] == 120.0)
    t2 = look.normalize_title({"text": "x", "start": "nope", "duration": None})
    check("garbage times fall back to defaults",
          t2["start"] == 0.0 and t2["duration"] == look.DEFAULT_TITLE_DURATION)


def test_title_fit():
    print("\n[title] fitting the column (ASS never wraps AND never clips)")
    for place in look.PLACE_IDS:
        ml, mr = look.title_margins(place, 1080)
        column = 1080 - ml - mr
        for text in ["the one habit that changed everything", "supercalifragilisticexpialidocious",
                     "STOP", "why nobody talks about this one thing"]:
            lines, size = look.fit_title(text, place, 1080, 1920)
            widest = max(len(l) for l in lines) * look._CHAR_EM * size
            check(f"{place}: {text[:14]!r} fits its column", widest <= column + 1,
                  f"{widest:.0f} > {column}")
            check(f"{place}: {text[:14]!r} keeps every word",
                  " ".join(lines).split() == text.split())
            check(f"{place}: {text[:14]!r} stays readable", size >= 24)
    check("a long single word shrinks the type rather than overflowing",
          look.fit_title("supercalifragilisticexpialidocious", "left", 1080, 1920)[1]
          < look.fit_title("STOP", "left", 1080, 1920)[1])
    check("blank text fits to nothing", look.fit_title("  ", "left", 1080, 1920)[0] == [])
    check("side columns take fewer characters per line than full width",
          len(look.fit_title("one two three four five six", "left", 1080, 1920)[0])
          > len(look.fit_title("one two three four five six", "top", 1080, 1920)[0]))


def test_title_wrap():
    print("\n[title] wrapping (ASS never auto-wraps)")
    lines = look.wrap_title("the one habit that changed everything", 11)
    check("wraps to the column width", all(len(l) <= 11 for l in lines), lines)
    check("keeps every word",
          " ".join(lines).split() == "the one habit that changed everything".split(), lines)
    check("honors typed newlines", look.wrap_title("a\nb", 40) == ["a", "b"])
    check("a too-long word still survives on its own line",
          look.wrap_title("supercalifragilistic", 5) == ["supercalifragilistic"])
    check("blank text wraps to nothing", look.wrap_title("   ", 10) == [])


def test_title_ass():
    print("\n[title] ass output")
    ass = caps.build_ass(WORDS, 0, 3, "capcut",
                         title={"text": "MONEY TALKS", "place": "left", "style": "glow",
                                "start": 0.5, "duration": 2.0})
    check("declares a Title style", "\nStyle: Title," in ass)
    check("emits a Title dialogue on layer 1", "Dialogue: 1," in ass and ",Title,," in ass)
    check("has an entrance/exit fade", "\\fad(" in ass)
    check("still emits the caption events", ",Base,," in ass)
    check("left placement uses ASS align 4", ",4," in ass.split("Style: Title,")[1])
    fitted = look.fit_title("MONEY TALKS", "left", 1080, 1920)[1]
    check("uses the fitted title size",
          ass.split("Style: Title,")[1].split(",")[1] == str(fitted))
    check("a title is much bigger than the captions", fitted > caps.PRESETS["capcut"].size)
    braces = caps.build_ass(WORDS, 0, 3, "capcut", title={"text": "{\\an8}hack\nme"})
    body = [l for l in braces.splitlines() if l.startswith("Dialogue: 1,")][0]
    check("user braces/backslashes cannot inject ASS override tags",
          "{\\an8}" not in body and body.endswith("(∖an8)hack\\Nme"), body)


def test_title_for_span():
    print("\n[title] per-scene slicing (reel export)")
    t = {"text": "hi", "start": 2.0, "duration": 4.0}          # covers 2..6
    check("scene fully before the title => none", look.title_for_span(t, 0, 1.5) is None)
    check("scene fully after the title => none", look.title_for_span(t, 7, 9) is None)
    mid = look.title_for_span(t, 1.0, 4.0)
    check("overlap is re-based to the scene", mid["start"] == 1.0 and mid["duration"] == 2.0, mid)
    tail = look.title_for_span(t, 4.0, 8.0)
    check("tail starts at the scene head", tail["start"] == 0.0 and tail["duration"] == 2.0, tail)
    check("no title => none", look.title_for_span(None, 0, 5) is None)


def test_margins():
    print("\n[title] placement margins")
    l_ml, l_mr = look.title_margins("left", 1080)
    r_ml, r_mr = look.title_margins("right", 1080)
    check("left title hugs the left edge", l_ml < l_mr)
    check("right title hugs the right edge", r_mr < r_ml)
    check("left/right are mirrors", (l_ml, l_mr) == (r_mr, r_ml))
    c_ml, c_mr = look.title_margins("center", 1080)
    check("center is symmetric", c_ml == c_mr)


if __name__ == "__main__":
    test_presets()
    test_no_look_is_no_change()
    test_filter_is_render_chain_safe()
    test_strength()
    test_title_normalize()
    test_title_wrap()
    test_title_fit()
    test_title_ass()
    test_title_for_span()
    test_margins()
    print("\n" + ("ALL PASSED" if not FAILED else f"{len(FAILED)} FAILED: {FAILED}"))
    sys.exit(1 if FAILED else 0)
