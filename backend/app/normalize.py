"""Script normalization + validation — the single guarantee that no malformed script
(pasted free-form OR LLM-generated) can create a broken video plan.

Every beat-writing path routes its beats through `normalize_beats` before they hit the
DB (see main._replace_beats). Normalization is deterministic and total: it cleans and
bounds every field, drops empty scenes, renumbers order, and can never raise on messy
input — so a model that returns extra keys, missing fields, 200 scenes, or empty
strings degrades to a valid (possibly shorter) plan instead of a KeyError or junk rows.

`validate_plan` reports human-readable problems (for the wizard's preview), and
`starter_plan` is the deterministic fallback used when every LLM provider is down.
"""
from __future__ import annotations

import re
from typing import Any

# Safety bounds — a runaway generation can't create an unusable plan.
MAX_BEATS = 12
MIN_BEATS = 1
MAX_SPOKEN = 600      # chars per spoken line
MAX_ONSCREEN = 160    # on-screen text is a short overlay
MAX_CAPTION = 600
MAX_SHOT = 200
MAX_HOOK = 200


def _clean(val: Any, cap: int) -> str:
    """Collapse whitespace, coerce to str, and cap length. Never raises."""
    if val is None:
        return ""
    s = re.sub(r"\s+", " ", str(val)).strip()
    return s[:cap]


def normalize_beats(raw_beats: list[dict] | None, *, max_beats: int = MAX_BEATS) -> list[dict]:
    """Turn any list of loosely-shaped beat dicts into a bounded, fully-formed list.

    Guarantees for every returned beat: all six keys present and typed, non-empty
    spoken_line/caption (each derives from the other when one is missing), sequential
    order_index starting at 0, and at most `max_beats` scenes. Empty scenes are dropped.
    """
    out: list[dict] = []
    for b in (raw_beats or []):
        if not isinstance(b, dict):
            continue
        spoken = _clean(b.get("spoken_line"), MAX_SPOKEN)
        caption = _clean(b.get("caption"), MAX_CAPTION) or spoken
        spoken = spoken or caption  # each backstops the other
        on_screen = _clean(b.get("on_screen_text"), MAX_ONSCREEN)
        shot = _clean(b.get("shot_cue"), MAX_SHOT)
        if not (spoken or caption or on_screen):
            continue  # nothing usable in this scene → drop it
        out.append({
            "order_index": len(out),
            "spoken_line": spoken,
            "on_screen_text": on_screen,
            "caption": caption,
            "shot_cue": shot,
            "is_proof_beat": bool(b.get("is_proof_beat")),
        })
        if len(out) >= max_beats:
            break
    return out


def normalize_plan(
    *,
    beats: list[dict] | None,
    hook: str = "",
    title: str = "",
    fmt: str = "reel",
    target_duration_seconds: int | None = None,
) -> dict:
    """Assemble a canonical plan from parsed/generated parts. Hook backfills from the
    first scene when absent, so a plan always has something to lead with."""
    nb = normalize_beats(beats)
    resolved_hook = _clean(hook, MAX_HOOK) or (nb[0]["spoken_line"] if nb else "")
    return {
        "title": _clean(title, 200),
        "hook": resolved_hook,
        "format": fmt or "reel",
        "target_duration_seconds": target_duration_seconds,
        "beats": nb,
    }


def validate_plan(plan: dict) -> list[str]:
    """Human-readable problems with a plan (empty list == valid). Used by the wizard's
    preview so the user sees exactly why a plan isn't ready, never an opaque error."""
    errs: list[str] = []
    beats = plan.get("beats") or []
    if len(beats) < MIN_BEATS:
        errs.append("The script has no usable scenes yet — add at least one.")
    if len(beats) > MAX_BEATS:
        errs.append(f"Too many scenes ({len(beats)}); a short should stay under {MAX_BEATS}.")
    for i, b in enumerate(beats):
        if not (b.get("spoken_line") or b.get("caption")):
            errs.append(f"Scene {i + 1} has no spoken line or caption.")
        if b.get("order_index") != i:
            errs.append(f"Scene {i + 1} is out of order.")
    return errs


def starter_plan(title: str = "", fmt: str = "reel") -> dict:
    """A deterministic, editable 3-scene skeleton. Used when every LLM provider is
    unavailable so creation is never blocked — the user edits it into shape."""
    topic = _clean(title, 200) or "your topic"
    beats = [
        {"spoken_line": f"Here's the thing about {topic} nobody tells you.",
         "on_screen_text": "WAIT…", "shot_cue": "Talking to camera / hook shot", "is_proof_beat": False},
        {"spoken_line": "Here's what's actually going on and why it matters.",
         "on_screen_text": "", "shot_cue": "B-roll that shows the point", "is_proof_beat": False},
        {"spoken_line": "So here's what to do instead — follow for more.",
         "on_screen_text": "DO THIS", "shot_cue": "Call-to-action shot", "is_proof_beat": False},
    ]
    return normalize_plan(beats=beats, hook=beats[0]["spoken_line"], title=title, fmt=fmt)
