"""Push performance rows to a Google Sheet via an Apps Script web-app webhook.

When ``PERF_SHEET_WEBHOOK_URL`` is set, each logged video's metrics are appended to the
sheet in Dennis's Drive (which his cowork content engine reads → weekly improvement).
Empty URL = no-op, so perf logging stays fully local. Best-effort: never raises into the
caller — a Sheets hiccup must never fail the perf log.
"""
from __future__ import annotations

import logging

import settings

log = logging.getLogger("cvideo.sheets")

# Keys the cowork engine's Apps Script reads (columns A–M). NOTE: Cvideo does NOT send a
# score — the Sheet owns scoring (tunable weights, per-brand weighting, 200-view gate).
ROW_FIELDS = ["post_id", "date", "brand", "platform", "journey_stage", "hook",
              "hook_trigger", "angle", "caption_style", "views", "follows", "saves", "sends"]


def is_live() -> bool:
    """True when a Sheet webhook URL is configured (otherwise rows stay local)."""
    return bool(settings.PERF_SHEET_WEBHOOK_URL)


def push_perf_rows(rows: list[dict]) -> dict:
    """POST `rows` (list of dicts keyed by ROW_FIELDS) to the Sheet webhook.
    Returns {pushed, live, error?}. Never raises."""
    if not is_live():
        return {"pushed": 0, "live": False}
    rows = [r for r in (rows or []) if r]
    if not rows:
        return {"pushed": 0, "live": True}
    import requests
    try:
        # Apps Script web apps 302-redirect to the content host; requests follows it,
        # but the append already ran on the initial POST regardless.
        resp = requests.post(settings.PERF_SHEET_WEBHOOK_URL, json=rows, timeout=15,
                             allow_redirects=True)
        if not resp.ok:
            return {"pushed": 0, "live": True, "error": f"{resp.status_code}: {resp.text[:200]}"}
        return {"pushed": len(rows), "live": True}
    except Exception as e:  # noqa: BLE001
        log.warning("sheet push failed: %s", e)
        return {"pushed": 0, "live": True, "error": str(e)}
