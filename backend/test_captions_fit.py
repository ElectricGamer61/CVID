"""Burned captions must never run off the 1080 px frame.

Offline and pure (no ffmpeg). The default "cinematic" style is 126 px, two words at a time,
and libass never wraps it, so two long words used to be drawn past both edges. fit_layout
breaks such a line onto two rows and shrinks only as far as the widest row needs; a line
that fits must come out byte-identical to before. frontend/src/captionFit.test.ts pins the
same numbers for the preview, so the editor and the export cannot disagree.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from app.pipeline import captions as c  # noqa: E402

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


def W(word, start=0.0, end=0.5, **extra):
    return {"start": start, "end": end, "word": word, **extra}


def dialogue_texts(ass: str) -> list[str]:
    # "Dialogue: 0,start,end,Base,,0,0,0,,TEXT" - the text follows the SECOND ",,".
    return [line.split(",,", 2)[2] for line in ass.splitlines() if line.startswith("Dialogue")]


def has_size_override(text: str) -> bool:
    return re.search(r"\\fs\d", text) is not None      # \fs103, not \fscx112


def test_fitting_lines_are_untouched():
    ass = c.build_ass([W("the", 0, .4), W("cat", .4, .8)], 0, 1, "cinematic")
    texts = dialogue_texts(ass)
    check("a short line gets no size override", not any(has_size_override(t) for t in texts))
    check("a short line gets no line break", all("\\N" not in t for t in texts))


def test_two_long_words_go_onto_two_rows():
    line = [W("gratification", 0, .5), W("monkey", .5, 1.0)]
    ass = c.build_ass(line, 0, 1, "cinematic")
    texts = dialogue_texts(ass)
    check("every karaoke frame of the line breaks onto two rows", all("\\N" in t for t in texts))
    sizes = {re.match(r"\{\\fs(\d+)\}", t).group(1) if re.match(r"\{\\fs(\d+)\}", t) else None for t in texts}
    check(f"both frames use one reduced size {sorted(map(str, sizes))}", len(sizes) == 1 and None not in sizes
          and int(next(iter(sizes))) < 126)
    k, split = c.fit_layout([dict(w, word=w["word"].upper()) for w in line], 126, 10, 1080)
    check("split is between the two words", split == 1)


def test_emoji_and_emphasis_are_measured():
    plain = c._word_em(W("MONKEY"))
    with_fx = c._word_em(W("MONKEY", emoji="\U0001F412", emphasis=True))
    check("an emphasised word with an emoji is measured wider than the plain word", with_fx > plain + 1.0)


def test_one_huge_word_shrinks_but_has_a_floor():
    k, split = c.fit_layout([W("PROCRASTINATOR")], 126, 10, 1080)
    check("a single too-wide word shrinks (85 px)", int(126 * k) == 85 and split is None)
    k, _ = c.fit_layout([W("SUPERCALIFRAGILISTICEXPIALIDOCIOUS")], 126, 10, 1080)
    check("never below 45%", abs(k - c.FIT_MIN_SCALE) < 1e-9)


def test_every_preset_keeps_every_frame_inside_the_margins():
    words = "the instant gratification monkey does not seem like a guy you want behind the wheel".split()
    for preset in c.PRESETS:
        st = c.resolve_style(preset)
        local = [W(w.upper() if st.uppercase else w, i * .3, i * .3 + .3) for i, w in enumerate(words)]
        worst = 0.0
        for line in c._group_lines(local, st.max_words):
            k, split = c.fit_layout(line, st.size, st.outline, 1080)
            rows = [line[:split], line[split:]] if split else [line]
            for row in rows:
                em = c._row_em([c._word_em(w) for w in row])
                worst = max(worst, em * st.size * k + 2 * st.outline)
        check(f"{preset}: widest frame {worst:.0f}px fits in 920px", worst <= 920 + 0.5)


if __name__ == "__main__":
    test_fitting_lines_are_untouched()
    test_two_long_words_go_onto_two_rows()
    test_emoji_and_emphasis_are_measured()
    test_one_huge_word_shrinks_but_has_a_floor()
    test_every_preset_keeps_every_frame_inside_the_margins()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
