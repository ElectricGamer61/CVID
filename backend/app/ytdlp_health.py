"""Keep the YouTube downloader able to actually download - without asking the user.

WHY THIS EXISTS
Cvideo has now shipped four merged fixes for "the YouTube clipper is broken" (PRs #15, #17,
#18, #20) and the clipper stayed broken after every one of them. Two failure modes kept
combining, and each one hides the other:

1. THE DOWNLOADER GOES STALE. yt-dlp is not an ordinary dependency. YouTube changes its
   player and its anti-bot challenge on the order of weeks, so a yt-dlp that was correct
   when someone last edited requirements-bare.txt stops working on its own, with no code
   change and no user action. requirements-bare.txt pinned `yt-dlp==2026.7.4` and the
   launcher's dependency sync only runs pip when that FILE changes - so the pin was not
   merely stale, it was unreachable: the self-update could never move past it.

2. THE PREREQUISITES WERE NEVER INSTALLED AT ALL. yt-dlp no longer descrambles YouTube's
   player itself. Since the EJS rewrite it runs YouTube's own JavaScript challenge in an
   EXTERNAL JavaScript runtime, using solver scripts from the `yt-dlp-ejs` package. Both
   ship as extras - `yt-dlp[default]` for the solver, `yt-dlp[deno]` for a Deno binary
   (there is a Windows wheel, so it lands inside backend\\.venv with no manual install).
   Cvideo required bare `yt-dlp`, so it had neither. yt-dlp says so, loudly:
       WARNING: No supported JavaScript runtime could be found ...
       YouTube extraction without a JS runtime has been deprecated
   ...and ingest.py passed `no_warnings: True`, which threw that line away. What the user
   saw instead was "Sign in to confirm you're not a bot", which reads exactly like a cookie
   problem - so three rounds of fixes went after cookies and player clients.

The launchers already re-sync dependencies, but only some of them, only on a cold start,
and only on a checkout that has already been updated once by hand. The backend is the one
component that is guaranteed to run on every path, so the check lives here too. It is
best-effort in every direction: no network, no pip, a read-only install or a refused
upgrade all just leave the app exactly as it was and let it start.

Set CVIDEO_AUTO_UPDATE=off to disable (a dev checkout, an air-gapped box).
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path

# The package spec, extras included. The extras are the fix, not decoration - see above.
YTDLP_SPEC = "yt-dlp[default,deno]"

_OFF_WORDS = ("off", "no", "0", "false", "never", "disabled")
_DEFAULT_MAX_AGE_HOURS = 24.0

# Set once the startup check has finished (or been skipped). ingest waits on this before its
# first yt_dlp import so an upgrade cannot land half-applied under a download already running.
ready = threading.Event()
# ...but only ever WAIT for a check that was actually started. ingest is imported by tests,
# one-off scripts and the shootdrop worker, none of which run the app's startup hook, and a
# wait on an event nobody will set is a five-minute hang, not a safety measure.
_started = threading.Event()

_last_report = "not checked"


def _stamp_path() -> Path:
    """Where the last successful check is recorded. Beside the venv, not in data/, so a
    wiped projects folder does not silently re-trigger a pip run on the next launch."""
    return Path(sys.prefix) / ".cvideo-ytdlp.stamp"


def auto_update_enabled() -> bool:
    value = os.getenv("CVIDEO_AUTO_UPDATE")
    if value is None:
        return True
    return value.strip().lower() not in _OFF_WORDS


def _max_age_hours() -> float:
    try:
        return max(0.0, float(os.getenv("CVIDEO_YTDLP_MAX_AGE_HOURS", "")))
    except ValueError:
        return _DEFAULT_MAX_AGE_HOURS


def js_runtimes() -> dict:
    try:
        import settings
        return dict(getattr(settings, "YOUTUBE_JS_RUNTIMES", None) or {})
    except Exception:  # noqa: BLE001 - diagnostics must never break startup
        return {}


def has_ejs() -> bool:
    try:
        import yt_dlp_ejs  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def ytdlp_version() -> str:
    try:
        import yt_dlp
        return str(yt_dlp.version.__version__)
    except Exception:  # noqa: BLE001
        return "unknown"


def readiness() -> dict:
    """Can this install actually download from YouTube? Surfaced on /api/health so the
    answer is one request away instead of a log-reading exercise."""
    runtimes = js_runtimes()
    ejs = has_ejs()
    return {
        "ytdlp": ytdlp_version(),
        "js_runtimes": sorted(runtimes),
        "ejs": ejs,
        # "ready" is about the PREREQUISITES only. YouTube can still refuse an individual
        # video; it cannot be satisfied at all without these two.
        "ready": bool(runtimes) and ejs,
        "auto_update": auto_update_enabled(),
        "last_check": _last_report,
    }


def _needs_check() -> tuple[bool, str]:
    """(should we run pip, why). Missing prerequisites beat the age gate: an install that
    cannot download at all should not wait out a 24-hour timer to find out."""
    runtimes = js_runtimes()
    if not runtimes:
        return True, "no JavaScript runtime is installed"
    if not has_ejs():
        return True, "the yt-dlp challenge solver (yt-dlp-ejs) is not installed"
    max_age = _max_age_hours()
    if max_age <= 0:
        return True, "the age check is disabled (always upgrade)"
    stamp = _stamp_path()
    if not stamp.exists():
        return True, "yt-dlp has never been checked for updates"
    age_hours = (time.time() - stamp.stat().st_mtime) / 3600.0
    if age_hours >= max_age:
        return True, f"yt-dlp was last checked {age_hours:.0f}h ago"
    return False, f"yt-dlp was checked {age_hours:.0f}h ago"


def _pip_upgrade() -> tuple[bool, str]:
    """Run the upgrade in a SUBPROCESS. Never import pip in-process: it would rewrite files
    under a running interpreter that has already imported some of them."""
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade",
           "--disable-pip-version-check", YTDLP_SPEC]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except Exception as error:  # noqa: BLE001 - no pip, no network, no permission
        return False, f"{type(error).__name__}: {error}"
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()
        return False, tail[-1][:200] if tail else f"pip exited {proc.returncode}"
    return True, ""


def check(force: bool = False) -> str:
    """Bring yt-dlp (and its JS-challenge prerequisites) up to date if it is due.

    Returns one line for the log. Never raises: this runs on the startup path, and an app
    that refuses to start because it could not reach PyPI would be a worse bug than the one
    it is here to prevent."""
    global _last_report
    try:
        if not force and not auto_update_enabled():
            _last_report = "skipped (CVIDEO_AUTO_UPDATE is off)"
            return f"[ytdlp] {_last_report}"

        needed, why = (True, "forced") if force else _needs_check()
        before = ytdlp_version()
        if not needed:
            _last_report = f"up to date ({why})"
            return f"[ytdlp] yt-dlp {before}: {why} - skipping the update check"

        print(f"[ytdlp] checking for a newer YouTube downloader ({why})...")
        ok, error = _pip_upgrade()
        if not ok:
            # Deliberately not fatal, and deliberately not silent: the version we are stuck
            # on is the first thing a support log needs.
            _last_report = f"update failed: {error}"
            return (f"[ytdlp] could not update yt-dlp ({error}); continuing with "
                    f"yt-dlp {before}")

        _stamp_path().write_text(time.strftime("%Y-%m-%dT%H:%M:%S"), encoding="ascii")
        state = readiness()
        after = state["ytdlp"]
        moved = f"yt-dlp {before} -> {after}" if before != after else f"yt-dlp {after} is current"
        if not state["ready"]:
            # The upgrade ran and the prerequisites are STILL missing: say exactly which, so
            # this does not read as a success the way the last three fixes did.
            return (f"[ytdlp] {moved}, but YouTube downloads are still not ready "
                    f"(JS runtime: {', '.join(state['js_runtimes']) or 'none'}; "
                    f"challenge solver: {'yes' if state['ejs'] else 'no'})")
        _last_report = moved
        return (f"[ytdlp] {moved}; YouTube ready "
                f"(JS runtime: {', '.join(state['js_runtimes'])})")
    except Exception as error:  # noqa: BLE001 - see docstring
        _last_report = f"check errored: {type(error).__name__}"
        return f"[ytdlp] update check failed ({type(error).__name__}: {error}); continuing"


def check_in_background() -> None:
    """Start the check off the startup path, then release `ready`.

    A pip run can take a minute and the Windows launcher gives the backend 60 seconds to
    answer /api/health, so this must not block startup. ingest waits on `ready` instead,
    which is a wait no one can reach before the server is already serving."""
    def run() -> None:
        try:
            print(check())
        finally:
            ready.set()

    _started.set()
    if not auto_update_enabled():
        globals()["_last_report"] = "skipped (CVIDEO_AUTO_UPDATE is off)"
        ready.set()
        return
    threading.Thread(target=run, name="ytdlp-health", daemon=True).start()


def wait_until_checked(timeout: float = 300.0) -> None:
    """Block until the startup check has finished, so a download never starts against a
    package that pip is in the middle of replacing. A no-op when no check is running."""
    if not _started.is_set():
        return
    ready.wait(timeout)
