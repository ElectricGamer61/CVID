"""Brand cartridges — the "who am I posting as" layer.

A cartridge is one JSON file per brand under `backend/brands/{slug}.json` describing the
brand's voice, proof rules, cadence, hook seeds, angle library and autonomy level. The AI
(`ai.py`, `pipeline/brain.py`) loads a cartridge and prepends its voice to generation.

Guard rail — behaviour is IDENTICAL to today when a brand has no cartridge file:
`voice_block()` returns "" (exactly like `learn.winners_prompt_block()` with no data), so the
refactor changes nothing until a cartridge is written. Onboarding a new brand/customer = drop
one JSON file here; no code change. This is the sellability move.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_BRANDS_DIR = Path(__file__).resolve().parent.parent / "brands"

# Default autonomy ladder — a brand is supervised until explicitly promoted.
AUTONOMY_LEVELS = ("off", "supervised", "semi", "hands_off")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")


def _path(name: str) -> Path:
    return _BRANDS_DIR / f"{_slug(name)}.json"


def load(name: str) -> dict[str, Any]:
    """Return the cartridge dict for a brand, or {} when there's no file (→ default behaviour)."""
    p = _path(name)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 - a broken cartridge must not break generation
        print(f"[cartridge] failed to load {p.name}: {e}")
        return {}


def list_brands() -> list[dict[str, Any]]:
    """Every cartridge on disk (name + autonomy + cadence summary), for the UI/orchestrator."""
    out: list[dict[str, Any]] = []
    if not _BRANDS_DIR.exists():
        return out
    for f in sorted(_BRANDS_DIR.glob("*.json")):
        try:
            c = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        out.append({"name": c.get("name", f.stem), "slug": f.stem,
                    "autonomy": c.get("autonomy", "supervised"),
                    "cadence": c.get("cadence", {})})
    return out


def save(name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Validate lightly and write a cartridge. Returns the stored dict."""
    if not _slug(name):
        raise ValueError("brand name is required")
    data = dict(data or {})
    data.setdefault("name", name)
    if data.get("autonomy") and data["autonomy"] not in AUTONOMY_LEVELS:
        raise ValueError(f"autonomy must be one of {AUTONOMY_LEVELS}")
    _BRANDS_DIR.mkdir(parents=True, exist_ok=True)
    _path(name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def autonomy(name: str) -> str:
    """A brand's autonomy level; defaults to 'supervised' (never silently hands-off)."""
    lvl = load(name).get("autonomy")
    return lvl if lvl in AUTONOMY_LEVELS else "supervised"


def cadence(name: str) -> dict[str, Any]:
    return load(name).get("cadence", {}) or {}


def hook_seeds(name: str) -> list[str]:
    return [h for h in load(name).get("hook_seeds", []) if str(h).strip()]


def angle_library(name: str) -> list[str]:
    return [a for a in load(name).get("angle_library", []) if str(a).strip()]


def voice_block(name: str) -> str:
    """A short prompt insert describing the brand's voice + rules. Empty string when the brand
    has no cartridge, so generation behaves exactly as before (mirrors winners_prompt_block)."""
    c = load(name)
    if not c:
        return ""
    voice = c.get("voice", {}) or {}
    lines: list[str] = []
    sys = (voice.get("system_prompt") or "").strip()
    if sys:
        lines.append(f"BRAND VOICE — {c.get('name', name)}: {sys}")
    tone = [t for t in voice.get("tone_rules", []) if str(t).strip()]
    if tone:
        lines.append("Tone rules: " + "; ".join(tone))
    banned = [b for b in voice.get("banned_phrases", []) if str(b).strip()]
    if banned:
        lines.append("NEVER say (off-brand / non-compliant): " + ", ".join(f'"{b}"' for b in banned))
    proof = (c.get("proof_rules") or "").strip() if isinstance(c.get("proof_rules"), str) else ""
    if not proof and isinstance(c.get("proof_rules"), list):
        proof = "; ".join(str(x) for x in c["proof_rules"] if str(x).strip())
    if proof:
        lines.append("Proof requirement: " + proof)
    if not lines:
        return ""
    return "\n".join(lines) + "\n\n"
