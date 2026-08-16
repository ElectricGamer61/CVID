"""Generate styled, word-synced ASS captions (the TikTok/CapCut look).

Style is expressed in web-friendly terms (hex colors, px size, position) so the
SAME values drive both the browser live-preview and the burned ASS — what you see
in the editor is what you export.

We emit one Dialogue event per word, redrawing the whole line with the current word
highlighted (color + slight scale pop). Times are clip-local (the source is cut
before burning), so word times are shifted by clip_start.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import settings

from . import look as look_mod


@dataclass
class CaptionStyle:
    font: str = "Arial"
    size: int = 92                 # ASS fontsize on the 1080x1920 canvas
    color: str = "#FFFFFF"         # text color (web hex)
    highlight: str = "#FFD400"     # active word color
    outline_color: str = "#000000"
    outline: int = 7
    shadow: int = 0
    bold: int = 1
    uppercase: bool = False
    position: str = "bottom"       # top|mid|bottom
    max_words: int = 4


# Canonical presets — mirrored on the frontend in src/captionStyles.ts.
PRESETS: dict[str, CaptionStyle] = {
    "capcut": CaptionStyle(font="Arial", size=92, color="#FFFFFF", highlight="#FFD400",
                           outline=7, uppercase=False, max_words=4, position="bottom"),
    "hormozi": CaptionStyle(font="Arial", size=104, color="#FFFFFF", highlight="#22FF55",
                            outline=8, bold=1, uppercase=True, max_words=3, position="mid"),
    "beasty": CaptionStyle(font="Arial", size=110, color="#FFFFFF", highlight="#00E5FF",
                           outline=6, shadow=3, uppercase=True, max_words=3, position="mid"),
    "clean": CaptionStyle(font="Arial", size=72, color="#F2F2F2", highlight="#FFFFFF",
                          outline=3, uppercase=False, max_words=6, position="bottom"),
}


def resolve_style(preset_name: str, overrides: dict | None = None) -> CaptionStyle:
    base = PRESETS.get(preset_name, PRESETS["capcut"])
    data = asdict(base)
    if overrides:
        for k, v in overrides.items():
            if k in data and v is not None:
                data[k] = v
    return CaptionStyle(**data)


# --- color helpers: web hex <-> ASS &HAABBGGRR -------------------------------
def _hex_rgb(hexcol: str) -> tuple[str, str, str]:
    h = hexcol.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return h[0:2], h[2:4], h[4:6]


def _ass_style_color(hexcol: str, alpha: str = "00") -> str:
    r, g, b = _hex_rgb(hexcol)
    return f"&H{alpha}{b}{g}{r}".upper()      # 8-digit for Style fields


def _ass_inline_color(hexcol: str) -> str:
    r, g, b = _hex_rgb(hexcol)
    return f"&H{b}{g}{r}&".upper()            # 6-digit + trailing & for \1c


def _align(position: str) -> int:
    return {"top": 8, "mid": 5, "bottom": 2}.get(position, 2)


# --- big cinematic title -----------------------------------------------------
# Extra ASS styles + Dialogue events, written into the SAME .ass as the captions so every
# export path picks them up from the single `subtitles=` filter it already has.

def _ass_escape(text: str) -> str:
    """Neutralise ASS markup in user text; explicit newlines become hard breaks."""
    return (text.replace("\\", "∖").replace("{", "(").replace("}", ")")
            .replace("\r", "").replace("\n", "\\N"))


def _title_geometry(t: dict, out_w: int, out_h: int) -> tuple[int, int, int, int, int, list[str]]:
    """(align, marginL, marginR, marginV, fontsize, lines) for a title placement — the size
    and the line breaks both come from look.fit_title, so the title always fits its column."""
    place = look_mod._place(t["place"])
    ml, mr = look_mod.title_margins(t["place"], out_w)
    # A bottom title has to clear the caption band (captions sit at 10% of the height).
    margin_v = int(out_h * (0.10 if t["place"] == "top" else 0.26 if t["place"] == "bottom" else 0.0))
    lines, size = look_mod.fit_title(t["text"], t["place"], out_w, out_h)
    return place.align, ml, mr, margin_v, size, lines


def _title_styles(t: dict, p: CaptionStyle, out_w: int, out_h: int) -> list[str]:
    """The style line(s) the title needs. "glow" gets TWO passes — a wide blurred halo
    underneath and a crisp, thinly-outlined copy on top — because libass has only one
    outline per style, and a coloured halo alone loses legibility over bright footage."""
    align, ml, mr, mv, size, _ = _title_geometry(t, out_w, out_h)
    white = _ass_style_color("#FFFFFF")
    black = _ass_style_color("#000000")
    # Border/shadow are sized off the type so a shrunk title keeps the same proportions.
    k = size / 138.0

    def line(name: str, outline_c: str, back_c: str, border: int, outline: float, shadow: float) -> str:
        return (f"Style: {name},{p.font},{size},{white},{white},{outline_c},{back_c},1,0,0,0,"
                f"100,100,1,0,{border},{max(1, round(outline * k))},{round(shadow * k)},"
                f"{align},{ml},{mr},{mv},1")

    if t["style"] == "glow":
        return [line("TitleGlow", _ass_style_color(p.highlight, "40"), "&H00000000", 1, 20, 0),
                line("Title", black, "&HA0000000", 1, 4, 4)]
    if t["style"] == "boxed":
        # BorderStyle 3 = filled box behind the text (max contrast over any footage).
        return [line("Title", "&H20000000", "&H20000000", 3, 14, 0)]
    return [line("Title", black, "&H90000000", 1, 9, 5)]     # "bold"


def _title_events(t: dict, out_w: int, out_h: int) -> list[str]:
    """Fade in/out plus a small scale-up entrance. Clip-local seconds, layered ABOVE the
    captions. The glow variant draws its halo pass first, in perfect registration."""
    _, _, _, _, _, lines = _title_geometry(t, out_w, out_h)
    if not lines:
        return []
    text = _ass_escape("\n".join(lines))
    start = max(0.0, float(t["start"]))
    end = start + max(0.4, float(t["duration"]))
    fade = int(min(400, max(150, t["duration"] * 1000 / 6)))
    pop = "\\fscx86\\fscy86\\t(0,%d,\\fscx100\\fscy100)" % (fade + 60)

    def event(layer: int, style: str, extra: str = "") -> str:
        return (f"Dialogue: {layer},{_ts(start)},{_ts(end)},{style},,0,0,0,,"
                f"{{\\fad({fade},{fade}){extra}{pop}}}{text}")

    if t["style"] == "glow":
        # libass has no Blur style field, but \blur softens the border into a real halo.
        return [event(1, "TitleGlow", "\\blur14"), event(2, "Title")]
    return [event(1, "Title")]


def _ass_header(p: CaptionStyle, out_w: int, out_h: int, title: dict | None = None) -> str:
    margin_v = int(out_h * (0.10 if p.position == "bottom" else 0.0))
    title_style = "".join("\n" + l for l in _title_styles(title, p, out_w, out_h)) if title else ""
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {out_w}
PlayResY: {out_h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,{p.font},{p.size},{_ass_style_color(p.color)},{_ass_style_color(p.color)},{_ass_style_color(p.outline_color)},&H90000000,{p.bold},0,0,0,100,100,0,0,1,{p.outline},{p.shadow},{_align(p.position)},80,80,{margin_v},1{title_style}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ts(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs == 100:
        cs, s = 0, s + 1
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _group_lines(words: list[dict], max_words: int) -> list[list[dict]]:
    lines, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= max_words or w["word"].strip().endswith((".", "!", "?")):
            lines.append(cur)
            cur = []
    if cur:
        lines.append(cur)
    return lines


def build_ass(words: list[dict], clip_start: float, clip_end: float,
              preset_name: str, overrides: dict | None = None,
              out_w: int = settings.OUT_W, out_h: int = settings.OUT_H,
              title: dict | None = None) -> str:
    p = resolve_style(preset_name, overrides)
    # Optional big cinematic title (clip-local times). None/blank → not a single byte changes.
    t = look_mod.normalize_title(title)
    base_c = _ass_inline_color(p.color)
    hi_c = _ass_inline_color(p.highlight)

    local = [
        {"start": w["start"] - clip_start, "end": w["end"] - clip_start,
         "word": (w["word"].upper() if p.uppercase else w["word"]).strip(),
         # Opt-in AI auto-effect keys (absent on normal words → rendering unchanged).
         "emphasis": bool(w.get("emphasis")), "emoji": (w.get("emoji") or "").strip()}
        for w in words
        if w["end"] > clip_start and w["start"] < clip_end and w["word"].strip()
    ]

    def _render(lw: dict) -> str:
        """A single word span, honoring optional emphasis (persistent pop in the highlight
        color) and a trailing emoji. Plain words with neither key are byte-identical to before."""
        txt = lw["word"]
        if lw.get("emoji"):
            txt = f"{txt} {lw['emoji']}"
        if lw.get("emphasis"):
            return f"{{\\1c{hi_c}\\b1\\fscx118\\fscy118}}{txt}{{\\1c{base_c}\\b0\\fscx100\\fscy100}}"
        return txt

    body = []
    for line in _group_lines(local, p.max_words):
        if not line:
            continue
        for i, w in enumerate(line):
            start = max(0.0, w["start"])
            end = max(start + 0.05, w["end"])
            parts = []
            for j, lw in enumerate(line):
                if j == i:
                    # active word: highlight color + slight scale pop (+ emoji if any)
                    active = lw["word"] + (f" {lw['emoji']}" if lw.get("emoji") else "")
                    parts.append(
                        f"{{\\1c{hi_c}\\fscx112\\fscy112}}{active}"
                        f"{{\\1c{base_c}\\fscx100\\fscy100}}"
                    )
                else:
                    parts.append(_render(lw))
            text = " ".join(parts)
            body.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Base,,0,0,0,,{text}")
    if t:
        body.extend(_title_events(t, out_w, out_h))
    return _ass_header(p, out_w, out_h, t) + "\n".join(body) + "\n"


def write_ass(words: list[dict], clip_start: float, clip_end: float,
              preset_name: str, out_path: Path, overrides: dict | None = None,
              out_w: int = settings.OUT_W, out_h: int = settings.OUT_H,
              title: dict | None = None) -> Path:
    out_path.write_text(
        build_ass(words, clip_start, clip_end, preset_name, overrides, out_w, out_h, title),
        encoding="utf-8",
    )
    return out_path
