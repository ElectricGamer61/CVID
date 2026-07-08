"""Autopilot orchestrator — the autonomous driver.

A background tick loop (same single-worker pattern as jobs.py) that walks each autopilot-owned
Ticket through the EXISTING lifecycle by calling the existing pipeline (script_factory →
assemble → schedule → post), running quality gates between stages, and pausing at approval /
footage gates according to the brand cartridge's autonomy level.

State lives entirely on the Ticket row (autopilot/gate/gate_reason/attempts_json), so the loop
is stateless and crash-safe: restart and it resumes exactly where it paused.

Honesty: the executors call real, dependency-heavy steps (LLM, ffmpeg, Upload-Post). When a
step's dependency is unavailable or fails, the ticket is PARKED with a reason rather than
posting junk — gates fail closed. The pure decision core (`plan_next`, `gates_for`) and the
queue/approve/toggle flow are unit-testable without those dependencies.
"""
from __future__ import annotations

import json
import os
import threading
import time
import traceback
from datetime import datetime, timedelta

from . import cartridge, gates

# Lifecycle order (mirrors main.STAGES). The orchestrator advances one hop per tick.
STAGES = ["outlier", "scripted", "staged", "sourced", "assembled", "ready", "scheduled", "posted"]

# Which stage-completions require a human OK, per autonomy level. A "gate point" is named by the
# stage the ticket is ENTERING when it would pause.
_GATE_POINTS = {
    "off":        set(),                                  # orchestrator does nothing
    "supervised": {"scripted", "ready", "scheduled"},     # approve script, reel, and the post
    "semi":       {"scheduled"},                           # approve only the post
    "hands_off":  set(),                                   # nothing — digest only
}
_MAX_RETRIES = 2


def gates_for(brand: str) -> set[str]:
    """The set of stage-entries that pause for human approval for this brand."""
    return _GATE_POINTS.get(cartridge.autonomy(brand), _GATE_POINTS["supervised"])


def plan_next(stage: str) -> str | None:
    """Pure: the next stage after `stage`, or None if terminal/unknown."""
    if stage not in STAGES:
        return None
    i = STAGES.index(stage)
    return STAGES[i + 1] if i + 1 < len(STAGES) else None


# --------------------------------------------------------------------------- #
# Retry bookkeeping (attempts_json on the ticket row)
# --------------------------------------------------------------------------- #
def _attempts(t) -> dict:
    try:
        return json.loads(t.attempts_json) if t.attempts_json else {}
    except Exception:  # noqa: BLE001
        return {}


def _bump_attempt(t, stage: str, err: str) -> int:
    a = _attempts(t)
    row = a.get(stage, {"tries": 0, "last_error": ""})
    row["tries"] += 1
    row["last_error"] = err[:400]
    a[stage] = row
    t.attempts_json = json.dumps(a)
    return row["tries"]


# --------------------------------------------------------------------------- #
# Human actions (called from the API / queue screen)
# --------------------------------------------------------------------------- #
def set_autopilot(ticket_id: int, on: bool) -> dict:
    from .db import Ticket, get_session
    with get_session() as s:
        t = s.get(Ticket, ticket_id)
        if not t:
            raise ValueError("ticket not found")
        t.autopilot = bool(on)
        if not on:
            t.gate = t.gate_reason = None
        s.add(t); s.commit(); s.refresh(t)
        return t.model_dump()


def approve(ticket_id: int) -> dict:
    """Clear an approval gate and let the ticket advance on the next tick."""
    from .db import Ticket, get_session
    with get_session() as s:
        t = s.get(Ticket, ticket_id)
        if not t:
            raise ValueError("ticket not found")
        if t.gate in ("awaiting_approval", "awaiting_footage"):
            t.gate = t.gate_reason = None
            s.add(t); s.commit(); s.refresh(t)
        return t.model_dump()


def reject(ticket_id: int) -> dict:
    """Kill: turn autopilot off and leave the ticket where it is for manual handling."""
    return set_autopilot(ticket_id, False)


def regenerate(ticket_id: int, note: str = "") -> dict:
    """Re-run the current stage's generator (e.g. rewrite the script) with an optional note,
    clearing the gate and the retry counter so the orchestrator tries again."""
    from .db import Ticket, get_session
    with get_session() as s:
        t = s.get(Ticket, ticket_id)
        if not t:
            raise ValueError("ticket not found")
        # Step the stage back one hop so the executor re-runs it.
        i = STAGES.index(t.stage) if t.stage in STAGES else 0
        t.stage = STAGES[max(0, i - 1)]
        t.gate = t.gate_reason = t.attempts_json = None
        if note:
            t.angle = (t.angle + f"  [note: {note}]") if t.angle else note
        s.add(t); s.commit(); s.refresh(t)
        return t.model_dump()


def queue() -> list[dict]:
    """Everything the human needs to act on: gated autopilot tickets, newest first."""
    from .db import Ticket, get_session
    from sqlmodel import select
    with get_session() as s:
        rows = s.exec(select(Ticket).where(Ticket.autopilot == True)  # noqa: E712
                      .order_by(Ticket.id.desc())).all()
        out = []
        for t in rows:
            out.append({**t.model_dump(),
                        "queue_kind": t.gate or ("running" if t.stage != "posted" else "done")})
        return out


# --------------------------------------------------------------------------- #
# Stage executors — each returns (ok, reason). Guarded; a failure parks the ticket.
# --------------------------------------------------------------------------- #
def _do_script(t) -> gates.Result:
    """outlier → scripted: write the script, persist beats, run the script gate."""
    from . import ai
    from .db import get_session
    from .main import _replace_beats  # reuse the exact beat-persist path
    res = ai.script_factory(t.brand, t.angle, "", t.format)
    if not res.get("beats"):
        return False, "script generation returned no scenes"
    ok, reason = gates.script_gate(t.brand, res.get("hook") or t.hook_text, res["beats"])
    if not ok:
        return False, reason
    crit_ok, crit_reason = gates.llm_hook_critique(t.brand, res.get("hook") or t.hook_text)
    if not crit_ok:
        return False, crit_reason
    with get_session() as s:
        row = s.get(type(t), t.id)
        if res.get("hook") and not row.hook_text:
            row.hook_text = res["hook"]
        row.ai_generated = True
        s.add(row)
        _replace_beats(s, t.id, res["beats"])
        s.commit()
    return True, ""


def _do_footage_check(t) -> gates.Result:
    """sourced gate for native-short: every proof/scene beat needs its clip before assembling."""
    if t.capture_mode != "native-short":
        return True, ""
    from .db import Beat, get_session
    from pathlib import Path
    from sqlmodel import select
    with get_session() as s:
        beats = s.exec(select(Beat).where(Beat.ticket_id == t.id)).all()
    missing = [b for b in beats if not (b.clip_path and Path(b.clip_path).exists())]
    if missing:
        return False, f"{len(missing)} scene(s) still need footage"
    return True, ""


def _do_assemble(t) -> gates.Result:
    """sourced → assembled: render the reel (laying one whole-reel AI voiceover over it when
    the ticket's auto_voiceover toggle is on), then run the reel gate."""
    from .pipeline import assemble
    from .db import get_session
    try:
        out = assemble.assemble_reel(t.id)
    except Exception as e:  # noqa: BLE001
        return False, f"assemble failed: {e}"
    dur = None
    try:
        from .pipeline.assemble import probe_duration
        dur = probe_duration(out)
    except Exception:  # noqa: BLE001
        pass
    ok, reason = gates.reel_gate(str(out), dur, [1])  # native reels always carry beat captions
    if not ok:
        return False, reason
    with get_session() as s:
        row = s.get(type(t), t.id)
        row.clip_url = str(out)
        s.add(row); s.commit()
    return True, ""


def _do_postmeta(t) -> gates.Result:
    """assembled → ready: write real per-platform post copy (LLM via ai.post_copy — captions,
    hashtags, YT title/description/tags from the ticket's own script) + run the post gate.
    Hand-edited copy is kept; only missing platforms are filled."""
    from sqlmodel import select
    from . import ai
    from .db import Beat, get_session
    platforms = t.platforms or cartridge.cadence(t.brand).get("platforms") or ["tt", "ig", "yt"]
    pm = t.post_meta or {}
    missing = [p for p in platforms if not (pm.get(p) or {})]
    if missing:
        with get_session() as s:
            beats = s.exec(select(Beat).where(Beat.ticket_id == t.id)
                           .order_by(Beat.order_index)).all()
            script = "\n".join((b.spoken_line or b.caption) for b in beats)
        generated = ai.post_copy(t.brand, t.hook_text, script)  # LLM w/ heuristic fallback
        for p in missing:
            if generated.get(p):
                pm[p] = generated[p]
    for p in platforms:
        if not (pm.get(p) or {}):
            cap = t.hook_text or t.angle or "New video"
            pm[p] = ({"title": cap, "description": t.angle or ""} if p == "yt"
                     else {"caption": cap, "hashtags": ""})
    ok, reason = gates.post_gate(pm, platforms)
    if not ok:
        return False, reason
    with get_session() as s:
        row = s.get(type(t), t.id)
        row.post_meta = pm
        row.platforms = platforms
        s.add(row); s.commit()
    return True, ""


def _do_schedule(t) -> gates.Result:
    """ready → scheduled: pick the next cadence slot and queue it."""
    from .db import get_session
    slot = _next_slot(t.brand)
    with get_session() as s:
        row = s.get(type(t), t.id)
        row.scheduled_at = slot
        s.add(row); s.commit()
    return True, ""


def _do_post(t) -> gates.Result:
    """scheduled → posted: hand to the publisher (dry-run without creds)."""
    from .pipeline import poster
    when = t.scheduled_at.isoformat() if t.scheduled_at else None
    # Post with the generated publish copy (caption + hashtags), not just the hook.
    platforms = t.platforms or ["tt", "ig", "yt"]
    pm = t.post_meta or {}
    entry = next((pm.get(p) for p in platforms if pm.get(p)), None) or {}
    caption = " ".join(x for x in (
        entry.get("caption") or entry.get("title") or t.hook_text or t.angle or "",
        entry.get("hashtags") or "") if x).strip()
    try:
        poster.post_reel(ticket_id=t.id, video_path=t.clip_url,
                         caption=caption or (t.hook_text or t.angle or ""),
                         platforms=platforms, when=when)
    except Exception as e:  # noqa: BLE001
        return False, f"publish failed: {e}"
    from .db import get_session
    with get_session() as s:
        row = s.get(type(t), t.id)
        if not row.posted_at:
            row.posted_at = datetime.utcnow()
        s.add(row); s.commit()
    return True, ""


# stage the ticket is LEAVING -> executor that produces the NEXT stage
_EXECUTORS = {
    "outlier": _do_script,
    "scripted": lambda t: (True, ""),   # staging is a no-op hop for now
    "staged": _do_footage_check,        # entering sourced needs footage (native)
    "sourced": _do_assemble,
    "assembled": _do_postmeta,
    "ready": _do_schedule,
    "scheduled": _do_post,
}


def _next_slot(brand: str) -> datetime:
    """A near-future scheduling time. Uses the cartridge cadence count to space posts out."""
    per_week = int(cartridge.cadence(brand).get("reels_per_week") or 3)
    gap_hours = max(6, int(7 * 24 / max(1, per_week)))
    return datetime.utcnow() + timedelta(hours=gap_hours)


# --------------------------------------------------------------------------- #
# The tick
# --------------------------------------------------------------------------- #
def advance_ticket(ticket_id: int) -> str:
    """Run ONE hop for a single autopilot ticket. Returns a short status word for logging."""
    from .db import Ticket, get_session
    with get_session() as s:
        t = s.get(Ticket, ticket_id)
        if not t or not t.autopilot:
            return "skip"
        if t.gate == "awaiting_footage":
            # Footage gates self-clear: once every scene has its clip, the ticket
            # continues on the next tick without a click (as the UI promises).
            ok, _ = _do_footage_check(t)
            if not ok:
                return "waiting"
            t.gate = t.gate_reason = None
            s.add(t); s.commit(); s.refresh(t)
        elif t.gate in ("awaiting_approval", "parked"):
            return "waiting"
        if t.stage == "posted":
            t.gate = "done"; s.add(t); s.commit()
            return "done"
        stage, brand = t.stage, t.brand

    executor = _EXECUTORS.get(stage)
    if not executor:
        return "noop"
    # Re-load a detached copy for the executor to read (executors re-open sessions to write).
    with get_session() as s:
        t = s.get(Ticket, ticket_id)
    ok, reason = executor(t)

    with get_session() as s:
        t = s.get(Ticket, ticket_id)
        if not ok:
            # Footage is a human gate, not a failure to retry.
            if reason.endswith("need footage") or "need footage" in reason:
                t.gate, t.gate_reason = "awaiting_footage", reason
                s.add(t); s.commit()
                return "footage"
            tries = _bump_attempt(t, stage, reason)
            if tries > _MAX_RETRIES:
                t.gate, t.gate_reason = "parked", reason
            s.add(t); s.commit()
            return "parked" if tries > _MAX_RETRIES else "retry"
        # Success → the ticket enters the next stage; pause there if it's a gate point.
        nxt = plan_next(stage) or stage
        entering_gate = nxt in gates_for(brand)
        t.stage = nxt
        if entering_gate:
            t.gate = "awaiting_approval"
            t.gate_reason = {"scripted": "review the script",
                             "ready": "review the reel",
                             "scheduled": "approve the post"}.get(nxt, "review")
        s.add(t); s.commit()
        return "gated" if entering_gate else "advanced"


def _in_flight(brand: str) -> int:
    """Autopilot tickets for a brand that haven't posted yet (the cadence backlog)."""
    from .db import Ticket, get_session
    from sqlmodel import select
    with get_session() as s:
        return len([t for t in s.exec(
            select(Ticket).where(Ticket.autopilot == True)).all()  # noqa: E712
            if (t.brand or "") == brand and t.stage != "posted"])


def feed() -> list[int]:
    """Ideation feeder: for each brand whose cartridge opts in (`"feed": true`), keep the
    pipeline topped up to its weekly cadence by minting new autopilot tickets from the brand's
    rotating angle library. Opt-in and conservative — a brand never auto-generates unless its
    cartridge explicitly enables it. Returns the ids of any tickets created."""
    from .db import Ticket, get_session
    created: list[int] = []
    for meta in cartridge.list_brands():
        brand = meta["name"]
        c = cartridge.load(brand)
        if not c.get("feed"):                      # opt-in only
            continue
        target = int((c.get("cadence") or {}).get("reels_per_week") or 3)
        angles = cartridge.angle_library(brand)
        if not angles or _in_flight(brand) >= target:
            continue
        with get_session() as s:
            # Rotate the angle library by how many tickets this brand already has.
            from sqlmodel import select
            n = len([t for t in s.exec(select(Ticket)).all() if (t.brand or "") == brand])
            angle = angles[n % len(angles)]
            t = Ticket(brand=brand, angle=angle, format="reel",
                       capture_mode="native-short", stage="outlier", autopilot=True)
            s.add(t); s.commit(); s.refresh(t)
            created.append(t.id)
    return created


def tick() -> dict:
    """One orchestrator cycle: feed new ideas (opt-in brands), then advance every eligible
    autopilot ticket by one hop. Returns a per-ticket status map."""
    from .db import Ticket, get_session
    from sqlmodel import select
    try:
        fed = feed()
    except Exception:  # noqa: BLE001
        traceback.print_exc(); fed = []
    with get_session() as s:
        ids = [t.id for t in s.exec(
            select(Ticket).where(Ticket.autopilot == True)).all()]  # noqa: E712
    out: dict[int, str] = {}
    for fid in fed:
        out[fid] = "fed"
    for tid in ids:
        try:
            out.setdefault(tid, advance_ticket(tid))
        except Exception as e:  # noqa: BLE001 - one bad ticket must not stall the loop
            traceback.print_exc()
            out[tid] = f"error:{e}"
    return out


# --------------------------------------------------------------------------- #
# Background loop (opt-in via env or the API toggle)
# --------------------------------------------------------------------------- #
_thread: threading.Thread | None = None
_running = threading.Event()
INTERVAL = int(os.environ.get("AUTOPILOT_INTERVAL", "60"))


def _loop():
    while _running.is_set():
        try:
            tick()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        time.sleep(INTERVAL)


def start() -> bool:
    global _thread
    if _running.is_set():
        return False
    _running.set()
    _thread = threading.Thread(target=_loop, name="autopilot", daemon=True)
    _thread.start()
    return True


def stop() -> bool:
    if not _running.is_set():
        return False
    _running.clear()
    return True


def status() -> dict:
    return {"running": _running.is_set(), "interval": INTERVAL}
