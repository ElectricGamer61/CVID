"""Phase 6 — schedule/post adapter (Upload-Post SDK) behind a DRY-RUN guard.

When ``UPLOAD_POST_API_KEY`` is unset (the default on this machine) every call is a
DRY RUN: it logs what *would* be posted and returns a synthetic result instead of
touching the network. Real posting is gated on the key being present in
``backend/.env``. This keeps the build green with no external creds.
"""
from __future__ import annotations

import logging
from pathlib import Path

import settings

log = logging.getLogger("cvideo.poster")

PLATFORM_NAMES = {"tt": "TikTok", "ig": "Instagram", "yt": "YouTube"}


def is_live() -> bool:
    """True when a real Upload-Post key is configured (otherwise dry-run)."""
    return bool(settings.UPLOAD_POST_API_KEY)


def post_reel(*, ticket_id: int, video_path: str | None, caption: str,
              platforms: list[str], when: str | None = None) -> dict:
    """Post (or schedule) a reel to the given platforms.

    Returns a result dict the API hands back to the UI. In dry-run mode nothing
    leaves the machine — we only log. ``when`` (ISO datetime) means schedule-for;
    ``None`` means post now.
    """
    targets = [p for p in platforms if p in PLATFORM_NAMES] or list(PLATFORM_NAMES)
    action = "schedule" if when else "post"

    if not is_live():
        for p in targets:
            log.info("[DRY-RUN] would %s ticket %s to %s (caption=%r, when=%s, file=%s)",
                     action, ticket_id, PLATFORM_NAMES[p], (caption or "")[:60], when, video_path)
        return {
            "dry_run": True, "action": action, "platforms": targets,
            "results": {p: f"DRY-RUN — would {action} to {PLATFORM_NAMES[p]}" for p in targets},
            "message": f"Dry run: would {action} to "
                       f"{', '.join(PLATFORM_NAMES[p] for p in targets)} "
                       f"(set UPLOAD_POST_API_KEY in backend/.env to post for real).",
        }

    # --- Real posting path (only when a key is configured) -------------------
    # FUTURE: wire the Upload-Post SDK here. Kept behind the key so the default
    # build never needs the dependency or the network.
    if not video_path or not Path(video_path).exists():
        raise FileNotFoundError("no assembled reel to post")
    try:
        from upload_post import UploadPostClient  # type: ignore
    except ImportError as e:  # SDK not installed
        raise RuntimeError(
            "UPLOAD_POST_API_KEY is set but the upload-post SDK isn't installed "
            "(pip install upload-post)."
        ) from e
    client = UploadPostClient(settings.UPLOAD_POST_API_KEY)
    results = {p: client.upload(video=video_path, caption=caption, platform=p, schedule=when)
               for p in targets}
    return {"dry_run": False, "action": action, "platforms": targets, "results": results,
            "message": f"{action.title()}ed to "
                       f"{', '.join(PLATFORM_NAMES[p] for p in targets)}."}
