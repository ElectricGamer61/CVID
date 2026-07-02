"""AI auto-effects (Submagic-style) — suggest emphasis words, emoji, punch-in zooms and SFX
for a clip. One shared LLM analysis; every function is fail-safe (returns empty on any error) so
the endpoint degrades to "no change" rather than breaking. Nothing here runs unless the user ticks
a checkbox in the AI Effects panel.
"""
from __future__ import annotations

import json
import re

from .llm import llm_text

# Bundled SFX names (files live in backend/assets/sfx/<name>.wav + frontend/public/sfx/ for preview).
SFX_NAMES = ["whoosh", "pop", "ding", "swoosh"]

# Cheap keyword→emoji map for the heuristic fallback (no LLM needed).
_EMOJI = {
    "money": "💰", "cash": "💰", "dollar": "💵", "free": "🆓", "fire": "🔥", "hot": "🔥",
    "best": "🏆", "win": "🏆", "love": "❤️", "heart": "❤️", "stop": "✋", "warning": "⚠️",
    "sugar": "🍬", "water": "💧", "fast": "⚡", "energy": "⚡", "brain": "🧠", "time": "⏰",
    "secret": "🤫", "wow": "🤯", "shock": "🤯", "food": "🍽️", "health": "💪", "strong": "💪",
}


def _compact(words: list[dict]) -> str:
    return "\n".join(f"{i}: {w.get('word','')}" for i, w in enumerate(words))


def suggest(words: list[dict], want_emphasis: bool, want_zoom: bool, want_sfx: bool) -> dict:
    """Return {emphasis:[idx], emoji:{idx:emoji}, zoom:[{t,scale,duration}], sfx:[{t,name}]}.
    Only the requested sub-effects are populated. Never raises."""
    words = [w for w in words if (w.get("word") or "").strip()]
    if not words or not (want_emphasis or want_zoom or want_sfx):
        return {"emphasis": [], "emoji": {}, "zoom": [], "sfx": []}
    out = _llm_suggest(words) if _try_llm(words) else {}
    if not out:
        out = _heuristic(words)
    # keep only requested sub-effects
    emphasis = out.get("emphasis", []) if want_emphasis else []
    emoji = out.get("emoji", {}) if want_emphasis else {}
    zoom = out.get("zoom", []) if want_zoom else []
    sfx = out.get("sfx", []) if want_sfx else []
    return {"emphasis": emphasis, "emoji": emoji, "zoom": zoom, "sfx": sfx}


def _try_llm(words: list[dict]) -> bool:
    return True  # suggest() falls back to heuristics if the call/parse fails


_PROMPT = """You are a short-form video editor adding punchy auto-effects to a captioned clip.
Here are the transcript words, one per line as "index: word":

{transcript}

Pick the highest-impact moments. Return ONLY a JSON object, no prose, with these keys:
- "emphasis": array of word indices to visually punch (the 5-12 strongest words).
- "emoji": object mapping a FEW emphasis indices (as strings) to ONE relevant emoji each.
- "zoom": array of up to 5 indices to punch-in the camera on (the biggest beats).
- "sfx": array of up to 4 objects {{"index": <int>, "name": <one of whoosh|pop|ding|swoosh>}}.
Indices must be valid. Keep it tasteful, not every word."""


def _llm_suggest(words: list[dict]) -> dict:
    try:
        raw = llm_text(_PROMPT.format(transcript=_compact(words)), temperature=0.4)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group(0) if m else raw)
    except Exception as e:  # noqa: BLE001
        print(f"[effects] LLM suggest fell back to heuristics: {e}")
        return {}
    n = len(words)
    valid = lambda i: isinstance(i, int) and 0 <= i < n

    emphasis = [i for i in data.get("emphasis", []) if valid(i)][:14]
    emoji = {int(k): str(v) for k, v in (data.get("emoji") or {}).items()
             if str(k).isdigit() and valid(int(k)) and str(v).strip()}
    zoom = [_zoom_at(words[i]) for i in data.get("zoom", []) if valid(i)][:5]
    sfx = [{"t": round(words[o["index"]]["start"], 3), "name": o["name"]}
           for o in data.get("sfx", [])
           if isinstance(o, dict) and valid(o.get("index")) and o.get("name") in SFX_NAMES][:4]
    return {"emphasis": emphasis, "emoji": emoji, "zoom": zoom, "sfx": sfx}


def _zoom_at(w: dict) -> dict:
    """A short punch-in keyframe centered on a word (source seconds)."""
    return {"t": round(float(w["start"]), 3), "scale": 1.15,
            "duration": round(max(0.4, float(w["end"]) - float(w["start"]) + 0.5), 3)}


def _heuristic(words: list[dict]) -> dict:
    """No-LLM fallback: emphasize numbers/long/ALL-CAPS words, map known keywords to emoji,
    punch-in + whoosh on the first few emphasized moments."""
    emphasis, emoji = [], {}
    for i, w in enumerate(words):
        tok = (w.get("word") or "").strip()
        low = re.sub(r"[^a-z]", "", tok.lower())
        strong = bool(re.search(r"\d", tok)) or (tok.isupper() and len(tok) > 2) or len(low) >= 8
        if strong:
            emphasis.append(i)
        if low in _EMOJI and len(emoji) < 6:
            emoji[i] = _EMOJI[low]
    emphasis = emphasis[:12]
    zoom = [_zoom_at(words[i]) for i in emphasis[:4]]
    sfx = [{"t": round(float(words[i]["start"]), 3), "name": "whoosh"} for i in emphasis[:3]]
    return {"emphasis": emphasis, "emoji": emoji, "zoom": zoom, "sfx": sfx}
