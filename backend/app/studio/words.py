"""One word format for every speech engine, with the junk already labelled.

Each engine writes disfluencies its own way: CrisperWhisper "[UM]" and "s-", Scribe "Uh,"
and "keeps--", Parakeet "uh", sound events as "[laughter]" or "(laughs)". The Cut room only
ever sees this shape:

    {"start": 1.23, "end": 1.41, "word": "uh", "kind": "filler"}

kind is "filler" (um/uh), "cutoff" (a word abandoned half way: "th-"), "event" (laughter,
music, coughs) or absent for ordinary speech. Words come out in time order, with no zero or
negative lengths, because every later step assumes both.
"""
from __future__ import annotations

import re

FILLERS = {"um", "umm", "uhm", "uh", "uhh", "er", "erm", "ah", "ahh", "hmm", "hm", "mhm",
           "mm", "mmm", "eh"}
MIN_WORD = 0.02  # seconds; engines sometimes emit 0-length words


def _letters(text: str) -> str:
    return re.sub(r"[^a-z']", "", text.lower())


def classify(raw: str, is_event: bool = False) -> tuple[str, str | None]:
    """(display text, kind) for one engine token."""
    text = raw.strip()
    if is_event:
        return text, "event"
    if (text.startswith("[") and text.endswith("]")) or (text.startswith("(") and text.endswith(")")):
        inner = text[1:-1].strip()
        if _letters(inner) in FILLERS:
            return inner.lower(), "filler"
        return text, "event"
    core = text.rstrip(".,!?;:\"')]")
    if _letters(core) in FILLERS:
        return text, "filler"
    if core.endswith("-") and _letters(core):
        # "keeps--" (Scribe) and "s-" (CrisperWhisper) both mean an abandoned word
        return core.rstrip("-") + "-", "cutoff"
    return text, None


def normalize(raw_words: list[dict]) -> list[dict]:
    """raw_words: [{start, end, word|text, type?}] from any engine -> the Cut room format."""
    out: list[dict] = []
    for w in raw_words:
        text = (w.get("word") if w.get("word") is not None else w.get("text")) or ""
        if not text.strip():
            continue
        try:
            start, end = float(w["start"]), float(w["end"])
        except (KeyError, TypeError, ValueError):
            continue
        display, kind = classify(text, is_event=w.get("type") == "audio_event")
        if end - start < MIN_WORD:
            end = start + MIN_WORD
        item = {"start": round(start, 3), "end": round(end, 3), "word": display}
        if kind:
            item["kind"] = kind
        out.append(item)
    out.sort(key=lambda x: x["start"])
    # Overlaps make "which word is under the playhead" ambiguous; clip each word at the next.
    for a, b in zip(out, out[1:]):
        if a["end"] > b["start"] and b["start"] - a["start"] >= MIN_WORD:
            a["end"] = b["start"]
    return out
