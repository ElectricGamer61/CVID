"""Closed learning loop — the moat.

Reads what has ACTUALLY performed (saves + follows on real exported videos, logged on
the Results screen) and surfaces the winning patterns, so generation can emulate proven
winners instead of guessing from a static prompt. Pure, read-only, and fully guarded: with
no performance history it returns empty and changes nothing about today's behavior.

Wired into `ai.py` (Script Factory / Hook Forge) and `pipeline/brain.py` (moment picking).
"""
from __future__ import annotations

from collections import defaultdict


def perf_score(views: int = 0, follows: int = 0, saves: int = 0, sends: int = 0) -> float:
    """The ONE in-app ranking score for a video / angle / platform.

    Weights the needle metrics (a save and a follow are worth far more than a view) and
    finally counts sends, which the app tracks but historically never scored. This is the
    single source of truth for ordering INSIDE Cvideo (Results, top videos, angle ranking).
    The Google Sheet still owns its own scoring for the content engine — see sheets.ROW_FIELDS.
    Weights are deliberately simple; tune here and every ranking updates together."""
    return round((saves or 0) * 3 + (follows or 0) * 5 + (sends or 0) * 2
                 + (views or 0) * 0.001, 3)


def winning_patterns(limit: int = 5, brand: str | None = None, min_views: int = 0) -> dict:
    """Aggregate logged performance into the account's top hooks / angles / caption styles,
    ranked by **saves + follows** (the needle metric, never views). Returns lists (possibly
    empty). Cheap: one pass over Perf + a lookup per winning video.

    `brand` filters to one brand's videos (per-brand learning); None = whole account.
    `min_views` is the signal gate (the "200-view rule") — a video below it is treated as
    noise and ignored, so cold/low-signal posts don't steer generation."""
    from .db import Clip, Perf, Ticket, get_session
    from sqlmodel import select

    hooks: dict[str, int] = defaultdict(int)
    angles: dict[str, int] = defaultdict(int)
    presets: dict[str, int] = defaultdict(int)
    want = (brand or "").strip().lower() or None
    with get_session() as s:
        for p in s.exec(select(Perf)).all():
            score = (p.saves or 0) + (p.follows or 0)
            if score <= 0 or (p.views or 0) < min_views:
                continue
            kind = p.video_kind or "reel"
            vid = p.video_id if p.video_id is not None else p.ticket_id
            if vid is None:
                continue
            if kind == "clip":
                c = s.get(Clip, vid)
                if not c:
                    continue
                if want and (c.brand or "").strip().lower() != want:
                    continue
                key = (c.hook or c.title or "").strip()
                if key:
                    hooks[key] += score
                if c.caption_preset:
                    presets[c.caption_preset] += score
            else:
                t = s.get(Ticket, vid)
                if not t:
                    continue
                if want and (t.brand or "").strip().lower() != want:
                    continue
                if (t.hook_text or "").strip():
                    hooks[t.hook_text.strip()] += score
                if (t.angle or "").strip():
                    angles[t.angle.strip()] += score

    top = lambda d: [k for k, _ in sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:limit]]
    return {"top_hooks": top(hooks), "top_angles": top(angles), "top_presets": top(presets)}


def winners_prompt_block(brand: str | None = None, min_views: int = 0) -> str:
    """A short prompt insert describing what's worked (optionally for one brand). Empty string
    when learning is turned off (CVIDEO_LEARNING=off) or there's no qualifying performance data
    yet — so generation behaves exactly as a plain prompt would."""
    import settings
    if not settings.LEARNING_ENABLED:
        return ""
    w = winning_patterns(brand=brand, min_views=min_views)
    if not (w["top_hooks"] or w["top_angles"]):
        return ""
    lines = ["WHAT'S WORKED FOR THIS ACCOUNT — emulate these proven winners "
             "(they earned the most saves + follows, which is the goal):"]
    for h in w["top_hooks"]:
        lines.append(f'  - hook that landed: "{h}"')
    if w["top_angles"]:
        lines.append("  - angles that performed: " + ", ".join(w["top_angles"]))
    return "\n".join(lines) + "\n\n"
