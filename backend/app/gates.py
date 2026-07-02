"""Quality gates — machine checks the orchestrator runs BEFORE a human ever looks.

Each gate returns (ok, reason). They fail closed: anything that doesn't clearly pass is held
back with a human-readable reason, so nothing low-quality slips silently into the approval
queue (let alone gets posted). Deterministic first; an optional LLM self-critique is best-effort
and never blocks when the LLM is unavailable.
"""
from __future__ import annotations

import re
from pathlib import Path

from . import cartridge

Result = tuple[bool, str]  # (ok, reason-if-not-ok)

# Rough spoken-word rate for duration estimates (words / sec).
_WPS = 2.5
_MIN_SECS, _MAX_SECS = 4.0, 120.0


def script_gate(brand: str, hook: str, beats: list[dict]) -> Result:
    """Cartridge-rule + shape check on a freshly written script."""
    if not beats:
        return False, "no scenes were written"
    if not (hook or "").strip():
        return False, "missing a hook (the first line)"

    c = cartridge.load(brand)
    banned = [b.lower() for b in (c.get("voice", {}) or {}).get("banned_phrases", []) if str(b).strip()]
    blob = " ".join(
        f"{b.get('spoken_line','')} {b.get('on_screen_text','')} {b.get('caption','')}"
        for b in beats).lower()
    hit = next((b for b in banned if b in blob), None)
    if hit:
        return False, f'uses an off-brand / non-compliant phrase: "{hit}"'

    # Proof rule: if the cartridge demands proof and a beat states a number, a proof scene
    # must be flagged (so the assembler's proof-guard has footage to show).
    if c.get("proof_rules"):
        states_number = any(re.search(r"\d", f"{b.get('spoken_line','')} {b.get('on_screen_text','')}")
                            for b in beats)
        if states_number and not any(b.get("is_proof_beat") for b in beats):
            return False, "states a real number but no proof scene is marked"

    words = sum(len((b.get("spoken_line") or "").split()) for b in beats)
    secs = words / _WPS
    if secs < _MIN_SECS:
        return False, f"script too short (~{secs:.0f}s of spoken content)"
    if secs > _MAX_SECS:
        return False, f"script too long (~{secs:.0f}s spoken)"
    return True, ""


def reel_gate(path: str | None, duration: float | None, words: list | None) -> Result:
    """The rendered reel is real, sane length, and captioned."""
    if not path or not Path(path).exists():
        return False, "render produced no file"
    if Path(path).stat().st_size < 10_000:
        return False, "rendered file is suspiciously small (render likely failed)"
    if duration is not None and (duration < 3 or duration > 180):
        return False, f"duration {duration:.0f}s is outside platform bounds (3–180s)"
    if not words:
        return False, "the reel has no captions"
    return True, ""


def post_gate(post_meta: dict | None, platforms: list) -> Result:
    """Every target platform has publish copy and there's somewhere to post."""
    if not platforms:
        return False, "no target platforms are set"
    pm = post_meta or {}
    for p in platforms:
        entry = pm.get(p) or {}
        if not any((entry.get(k) or "").strip() for k in ("caption", "title", "description")):
            return False, f"missing post copy for {p}"
    return True, ""


def llm_hook_critique(brand: str, hook: str, floor: int = 6) -> Result:
    """Best-effort LLM self-critique: score the hook 1-10 against the brand, fail below `floor`.
    Never blocks when no LLM is available (returns pass) — deterministic gates already ran."""
    try:
        from . import ai
        prompt = (cartridge.voice_block(brand) +
                  f'Score this short-form video hook from 1 to 10 for stopping the scroll and '
                  f'fitting the brand. Reply with ONLY the integer.\nHook: "{hook}"')
        raw = ai._llm_text(prompt)
        m = re.search(r"\d+", raw or "")
        if not m:
            return True, ""
        score = int(m.group(0))
        if score < floor:
            return False, f"hook scored {score}/10 (below the {floor} floor)"
    except Exception:  # noqa: BLE001 - LLM down => don't block
        return True, ""
    return True, ""
