"""Cinematic **Look** — one colour-grade preset per clip, plus the big **cinematic title**.

Two user-facing ideas, both centralised here so every export path behaves the same:

1. `look_filter(look_id, strength)` → an ffmpeg **video filter chain** (a plain, comma-joined
   string) that makes ordinary footage look graded. `"none"` / unknown ids / strength 0 return
   `""`, so a clip nobody applied a look to renders **byte-identical** to before.
2. `title_events(title, style)` → the ASS style + Dialogue lines for one optional big hook
   line, placed across the frame near the subject. `None` → no events, again byte-identical.
   The everyday big-text experience is the `cinematic` CAPTION preset, not this.

**Filter chains here MUST stay linear** (no `split`/`blend`, no `[label]`s): they are spliced
into both a simple `-vf` chain and the middle of a `filter_complex`, and a label would break
the latter. Everything used (`eq`, `curves`, `colorbalance`, `unsharp`, `vignette`) ships with
stock ffmpeg.

The web preview mirrors these in `frontend/src/looks.ts` (same ids/labels, CSS approximations).
"""
from __future__ import annotations

from dataclasses import dataclass

# --- Looks -------------------------------------------------------------------


@dataclass(frozen=True)
class Look:
    id: str
    label: str
    hint: str


# Canonical order — this is the chip order in the editor. Mirrored in frontend/src/looks.ts.
LOOKS: list[Look] = [
    Look("none", "None", "no colour change"),
    Look("warm_film", "Warm Film", "golden, filmic warmth"),
    Look("cold_cinema", "Cold Cinema", "cool teal blockbuster"),
    Look("punchy", "Punchy", "crisp, high contrast"),
    Look("soft_glow", "Soft Glow", "dreamy, lifted blacks"),
    Look("night", "Night", "moody blue low key"),
]
LOOK_IDS = [l.id for l in LOOKS]
DEFAULT_STRENGTH = 0.6


def _clamp01(v) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return DEFAULT_STRENGTH
    return max(0.0, min(1.0, f))


def _n(v: float) -> str:
    """ffmpeg-safe number: fixed decimals, no exponent, no locale surprises."""
    return f"{v:.4f}".rstrip("0").rstrip(".") or "0"


def _curves(points: list[tuple[float, float]]) -> str:
    return "curves=all='" + " ".join(f"{_n(x)}/{_n(y)}" for x, y in points) + "'"


def _lerp(a: float, b: float, s: float) -> float:
    return a + (b - a) * s


def look_filter(look_id: str | None, strength=DEFAULT_STRENGTH) -> str:
    """The ffmpeg video-filter chain for a look, scaled by `strength` (0..1).

    Returns `""` for "none", an unknown id, a missing id or strength 0 — the caller then
    appends nothing and the render is exactly what it was before looks existed.
    """
    if not look_id or look_id == "none" or look_id not in LOOK_IDS:
        return ""
    s = _clamp01(strength)
    if s <= 0.001:
        return ""
    parts = _CHAINS[look_id](s)
    return ",".join(p for p in parts if p)


def _warm_film(s: float) -> list[str]:
    return [
        f"eq=contrast={_n(1 + 0.14 * s)}:saturation={_n(1 + 0.12 * s)}:gamma={_n(1 - 0.05 * s)}",
        f"colorbalance=rs={_n(0.10 * s)}:bs={_n(-0.07 * s)}"
        f":rm={_n(0.06 * s)}:bm={_n(-0.05 * s)}:rh={_n(0.04 * s)}:bh={_n(-0.03 * s)}",
        _curves([(0, _lerp(0, 0.03, s)), (0.5, 0.5), (1, 1)]),
        f"vignette=a={_n(0.5 * s)}",
    ]


def _cold_cinema(s: float) -> list[str]:
    return [
        f"eq=contrast={_n(1 + 0.18 * s)}:saturation={_n(1 - 0.10 * s)}:gamma={_n(1 - 0.04 * s)}",
        f"colorbalance=bs={_n(0.13 * s)}:rs={_n(-0.06 * s)}"
        f":bm={_n(0.06 * s)}:gm={_n(0.03 * s)}:rh={_n(-0.04 * s)}",
        _curves([(0, _lerp(0, 0.02, s)), (0.5, _lerp(0.5, 0.48, s)), (1, 1)]),
        f"vignette=a={_n(0.55 * s)}",
    ]


def _punchy(s: float) -> list[str]:
    return [
        f"eq=contrast={_n(1 + 0.28 * s)}:saturation={_n(1 + 0.28 * s)}",
        _curves([(0, 0), (0.25, _lerp(0.25, 0.19, s)),
                 (0.75, _lerp(0.75, 0.82, s)), (1, 1)]),
        f"unsharp=5:5:{_n(0.9 * s)}:5:5:0",
    ]


def _soft_glow(s: float) -> list[str]:
    return [
        f"eq=contrast={_n(1 - 0.06 * s)}:saturation={_n(1 + 0.10 * s)}"
        f":brightness={_n(0.03 * s)}",
        _curves([(0, _lerp(0, 0.09, s)), (0.5, _lerp(0.5, 0.54, s)), (1, 1)]),
        f"unsharp=7:7:{_n(-0.7 * s)}:7:7:0",
    ]


def _night(s: float) -> list[str]:
    return [
        f"eq=contrast={_n(1 + 0.22 * s)}:saturation={_n(1 - 0.28 * s)}"
        f":brightness={_n(-0.06 * s)}:gamma={_n(1 - 0.06 * s)}",
        f"colorbalance=bs={_n(0.16 * s)}:bm={_n(0.08 * s)}:rs={_n(-0.05 * s)}",
        _curves([(0, 0), (0.5, _lerp(0.5, 0.44, s)), (1, _lerp(1, 0.96, s))]),
        f"vignette=a={_n(0.7 * s)}",
    ]


_CHAINS = {
    "warm_film": _warm_film,
    "cold_cinema": _cold_cinema,
    "punchy": _punchy,
    "soft_glow": _soft_glow,
    "night": _night,
}


# --- Big cinematic title -----------------------------------------------------

@dataclass(frozen=True)
class TitlePlace:
    id: str
    label: str
    align: int          # ASS numpad alignment


# Placement is pure LAYOUT — a narrow, tall column of big type hugging one edge lands near
# the subject without any matting, so it can never fail the way segmentation can. The labels
# name the FRAME, not the person: nothing here cuts anyone out.
PLACES: list[TitlePlace] = [
    TitlePlace("left", "Left side", 4),
    TitlePlace("right", "Right side", 6),
    TitlePlace("top", "Top", 8),
    TitlePlace("bottom", "Bottom", 2),
    TitlePlace("center", "Across frame", 5),
]
PLACE_IDS = [p.id for p in PLACES]

TITLE_STYLES = [
    {"id": "bold", "label": "Bold"},
    {"id": "glow", "label": "Glow"},
    {"id": "boxed", "label": "Boxed"},
]
TITLE_STYLE_IDS = [t["id"] for t in TITLE_STYLES]

DEFAULT_TITLE_DURATION = 3.0


def wrap_title(text: str, max_chars: int) -> list[str]:
    """Break a title into lines at word boundaries (ASS WrapStyle 2 never auto-wraps, so the
    line breaks have to be explicit). Honors newlines the user typed. Mirrored in looks.ts."""
    lines: list[str] = []
    for para in (text or "").replace("\r", "").split("\n"):
        cur = ""
        for word in para.split():
            cand = f"{cur} {word}".strip()
            if cur and len(cand) > max_chars:
                lines.append(cur)
                cur = word
            else:
                cur = cand
        lines.append(cur)          # keep blank paragraphs as blank lines
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def normalize_title(title: dict | None) -> dict | None:
    """Validate/defaults a stored title dict. Returns None when there's nothing to draw, so
    every caller can just do `if not t: skip`."""
    if not isinstance(title, dict):
        return None
    text = str(title.get("text") or "").strip()
    if not text:
        return None
    place = title.get("place") if title.get("place") in PLACE_IDS else "left"
    style = title.get("style") if title.get("style") in TITLE_STYLE_IDS else "bold"
    try:
        start = max(0.0, float(title.get("start", 0.0)))
    except (TypeError, ValueError):
        start = 0.0
    try:
        duration = float(title.get("duration", DEFAULT_TITLE_DURATION))
    except (TypeError, ValueError):
        duration = DEFAULT_TITLE_DURATION
    duration = max(0.4, min(duration, 120.0))
    return {"text": text, "place": place, "style": style,
            "start": round(start, 3), "duration": round(duration, 3)}


def title_for_span(title: dict | None, span_start: float, span_end: float) -> dict | None:
    """Clip a (normalized) title's [start, start+duration] window to one segment of the export
    and re-base it to that segment's local time. Used by the per-scene reel export, where the
    finished video is concatenated from independently-burned pieces. None = don't draw it here."""
    t = normalize_title(title)
    if not t or span_end <= span_start:
        return None
    a, b = t["start"], t["start"] + t["duration"]
    lo, hi = max(a, span_start), min(b, span_end)
    if hi - lo <= 0.05:
        return None
    return {**t, "start": round(lo - span_start, 3), "duration": round(hi - lo, 3)}


def _place(place_id: str) -> TitlePlace:
    for p in PLACES:
        if p.id == place_id:
            return p
    return PLACES[0]


def title_size(out_h: int, place_id: str = "center") -> int:
    """Big — a cinematic title, not another caption line. A side title runs in a narrow
    column, so it starts a size down; `fit_title` shrinks further only if it must."""
    frac = 0.062 if place_id in ("left", "right") else 0.072
    return max(40, int(out_h * frac))


def title_margins(place_id: str, out_w: int) -> tuple[int, int]:
    """(MarginL, MarginR). A side title lives in a ~58% column hugging its edge, so it lands
    near the subject by layout alone — there is no cut-out and nothing to segment."""
    edge = int(out_w * 0.06)
    gutter = int(out_w * 0.36)
    if place_id == "left":
        return edge, gutter
    if place_id == "right":
        return gutter, edge
    return edge, edge


# Rough advance width of one character as a fraction of the font size, for a bold sans
# (Arial ≈ 0.56 em, the DejaVu fallback ≈ 0.63). Deliberately pessimistic: overflowing the
# column looks broken, a slightly narrow line does not.
_CHAR_EM = 0.60


def fit_title(text: str, place_id: str, out_w: int, out_h: int) -> tuple[list[str], int]:
    """Break the title into lines that FIT its column, shrinking the type if even one word
    is too wide. Returns (lines, fontsize).

    ASS never auto-wraps and never clips, so an unfitted title just runs off the frame —
    this is the one place that decides line breaks + size, and `looks.ts` mirrors it so the
    editor preview breaks in exactly the same places.
    """
    ml, mr = title_margins(place_id, out_w)
    column = max(1, out_w - ml - mr)
    size = title_size(out_h, place_id)
    per_line = max(5, int(column / (_CHAR_EM * size)))
    lines = wrap_title(text, per_line)
    if not lines:
        return [], size
    widest = max(len(l) for l in lines) * _CHAR_EM * size
    if widest > column:
        size = max(24, int(size * column / widest))
    return lines, size
