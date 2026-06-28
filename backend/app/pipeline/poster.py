"""Phase 6 — schedule/post adapter for the Upload-Post API, behind a DRY-RUN guard.

When ``UPLOAD_POST_API_KEY`` is unset (the default on this machine) every call is a
DRY RUN: it logs what *would* be posted and returns a synthetic result instead of
touching the network. With a key set it calls the real Upload-Post REST API
(https://docs.upload-post.com/api/upload-video/) to post now or schedule.
"""
from __future__ import annotations

import logging
from pathlib import Path

import settings

log = logging.getLogger("cvideo.poster")

# Our internal platform codes -> display name + Upload-Post API name.
PLATFORM_NAMES = {"tt": "TikTok", "ig": "Instagram", "yt": "YouTube"}
PLATFORM_API = {"tt": "tiktok", "ig": "instagram", "yt": "youtube"}
API_URL = "https://api.upload-post.com/api/upload"


def is_live() -> bool:
    """True when a real Upload-Post key is configured (otherwise dry-run)."""
    return bool(settings.UPLOAD_POST_API_KEY)


def configured() -> dict:
    """Readiness info for the UI (key set? user profile set?)."""
    return {"live": is_live(), "user_set": bool(settings.UPLOAD_POST_USER),
            "user": settings.UPLOAD_POST_USER}


def post_reel(*, ticket_id: int, video_path: str | None, caption: str,
              platforms: list[str], when: str | None = None) -> dict:
    """Post (or schedule) a reel to the given platforms.

    ``when`` (ISO datetime) schedules for that time; ``None`` posts now. In dry-run
    mode nothing leaves the machine — we only log.
    """
    targets = [p for p in platforms if p in PLATFORM_NAMES] or list(PLATFORM_NAMES)
    action = "schedule" if when else "post"
    verb = "Scheduled" if when else "Posted"
    names = ", ".join(PLATFORM_NAMES[p] for p in targets)

    if not is_live():
        for p in targets:
            log.info("[DRY-RUN] would %s ticket %s to %s (caption=%r, when=%s, file=%s)",
                     action, ticket_id, PLATFORM_NAMES[p], (caption or "")[:60], when, video_path)
        return {
            "dry_run": True, "action": action, "platforms": targets,
            "results": {p: f"DRY-RUN — would {action} to {PLATFORM_NAMES[p]}" for p in targets},
            "message": f"Dry run: would {action} to {names} "
                       f"(set UPLOAD_POST_API_KEY + UPLOAD_POST_USER in backend/.env to post for real).",
        }

    # --- Real posting via the Upload-Post REST API ---------------------------
    if not settings.UPLOAD_POST_USER:
        raise RuntimeError(
            "UPLOAD_POST_USER isn't set in backend/.env — that's the profile name from your "
            "Upload-Post dashboard (with your TikTok/Instagram/YouTube accounts connected).")
    if not video_path or not Path(video_path).exists():
        raise FileNotFoundError("no assembled reel to post")

    import requests

    api_platforms = [PLATFORM_API[p] for p in targets if p in PLATFORM_API]
    data = [("user", settings.UPLOAD_POST_USER), ("title", caption or "")]
    for ap in api_platforms:
        data.append(("platform[]", ap))
    if when:
        # API wants ISO-8601; datetime-local may omit seconds — pad it. The timezone
        # field tells Upload-Post how to interpret the (naive) local time.
        data.append(("scheduled_date", when if len(when) > 16 else when + ":00"))
        data.append(("timezone", settings.UPLOAD_POST_TIMEZONE))
    headers = {"Authorization": f"Apikey {settings.UPLOAD_POST_API_KEY}"}

    # FUTURE: storage swap — streams the local file. For a cloud store, pass the file's
    # URL as the `video` field instead of uploading bytes.
    with open(video_path, "rb") as fh:
        resp = requests.post(API_URL, headers=headers, data=data,
                             files={"video": ("reel.mp4", fh, "video/mp4")}, timeout=600)
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if resp.status_code not in (200, 202) or body.get("success") is False:
        detail = body.get("error") or body.get("message") or resp.text[:300]
        raise RuntimeError(f"Upload-Post {resp.status_code}: {detail}")

    api_results = body.get("results") or {}
    results = {}
    for p in targets:
        r = api_results.get(PLATFORM_API.get(p, ""))
        if isinstance(r, dict):
            results[p] = r.get("url") or ("posted" if r.get("success") else f"failed: {r.get('error', '?')}")
        elif body.get("job_id"):
            results[p] = f"scheduled (job {body['job_id']})"
        else:
            results[p] = "submitted"
    return {"dry_run": False, "action": action, "platforms": targets, "results": results,
            "job_id": body.get("job_id"), "request_id": body.get("request_id"),
            "message": f"{verb} to {names} via Upload-Post."}
