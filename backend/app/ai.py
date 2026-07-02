"""AI buttons — Script Factory + Hook Forge.

Reuses the same Ollama/Gemini clients as `brain.py`, but for content generation
instead of moment-scoring. Both functions have **heuristic fallbacks** so the
endpoints never hard-fail (e.g. when Ollama isn't running) — the build/smoke
stay green regardless of LLM availability.
"""
from __future__ import annotations

import json
import re

import settings
from . import cartridge, intake, learn
from .pipeline.llm import llm_text as _llm_text  # shared dispatch (also used by gates.py)


# --------------------------------------------------------------------------- #
# Script Factory
# --------------------------------------------------------------------------- #
_SCRIPT_PROMPT = """You are a short-form video scriptwriter for the brand {brand}.
Write a punchy {fmt} script for this angle: "{angle}".
{brief}
Return ordered beats in EXACTLY this labeled format and NOTHING else:

HOOK: <one scroll-stopping first line>

BEAT
Spoken: <what is said out loud>
On-screen: <short on-screen text>
Caption: <the caption line>
Shot: <what to film>
Proof: yes   (include this line ONLY when the beat states a real number/result)

Repeat BEAT 4-7 times. Keep spoken lines tight and natural to say aloud.
"""


def script_factory(brand: str, angle: str, brief: str = "", fmt: str = "reel") -> dict:
    """LLM → labeled script → parsed beats (via intake.parse_script). Falls back to a
    generic skeleton if no LLM is available. Returns {hook, beats[]}."""
    prompt = cartridge.voice_block(brand) + learn.winners_prompt_block(brand=brand) + _SCRIPT_PROMPT.format(
        brand=brand or "the brand", angle=angle or "(general)",
        brief=(f"Extra direction: {brief}" if brief else ""), fmt=fmt or "reel")
    try:
        parsed = intake.parse_script(_llm_text(prompt))
        if parsed["beats"]:
            return parsed
    except Exception as e:  # noqa: BLE001
        print(f"[ai] script_factory fallback: {e}")
    return _fallback_script(angle)


def _fallback_script(angle: str) -> dict:
    a = (angle or "this").strip()
    rows = [
        (f"Here's the truth about {a}.", a.upper(), f"the truth about {a}", "talking head, close"),
        ("Most people get this completely wrong.", "MOST GET THIS WRONG", "most people get this wrong", "b-roll"),
        ("Here's what actually works.", "WHAT WORKS", "what actually works", "demo / product on screen"),
        ("Try it and tell me how it goes.", "TRY IT", "try it", "talking head, CTA"),
    ]
    beats = [{"order_index": i, "spoken_line": s, "on_screen_text": o, "caption": c,
              "shot_cue": sh, "is_proof_beat": False} for i, (s, o, c, sh) in enumerate(rows)]
    return {"hook": f"The truth about {a} nobody tells you", "beats": beats}


# --------------------------------------------------------------------------- #
# Hook Forge
# --------------------------------------------------------------------------- #
_HOOK_PROMPT = """Write 6 scroll-stopping first-line hooks for a short-form video.
Brand: {brand}. Angle: "{angle}". {brief}
Return ONLY a JSON array of 6 short strings, nothing else."""


def hook_forge(brand: str, angle: str, brief: str = "") -> list[str]:
    prompt = cartridge.voice_block(brand) + learn.winners_prompt_block(brand=brand) + _HOOK_PROMPT.format(
        brand=brand or "the brand", angle=angle or "(general)", brief=(brief or ""))
    try:
        arr = _extract_str_array(_llm_text(prompt))
        if arr:
            return arr[:8]
    except Exception as e:  # noqa: BLE001
        print(f"[ai] hook_forge fallback: {e}")
    a = (angle or "this").strip()
    return [
        f"The truth about {a} nobody tells you",
        f"Stop doing {a} wrong",
        f"I tried {a} for 30 days — here's what happened",
        f"{a}: what they don't tell you",
        f"Why your {a} isn't working",
        f"The {a} mistake everyone makes",
    ]


def _extract_str_array(text: str) -> list[str]:
    text = re.sub(r"```[a-zA-Z]*", "", text).strip()  # drop markdown code fences
    candidates = [text]
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        candidates.append(m.group(0))
    for candidate in candidates:
        try:
            d = json.loads(candidate)
            if isinstance(d, list):
                vals = [str(x).strip() for x in d if str(x).strip()]
                if vals:
                    return vals
        except json.JSONDecodeError:
            pass
    # last resort: one hook per non-empty line, stripped of bullets/numbering/brackets/quotes
    lines = [re.sub(r'^[\-\*\d.)\s"\[\]]+', "", ln).strip().strip('",[] ') for ln in text.splitlines()]
    return [ln for ln in lines if ln][:8]
