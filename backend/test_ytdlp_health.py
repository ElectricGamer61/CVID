"""The YouTube downloader must keep ITSELF working, without the user doing anything.

The regression this pins is not a crash - it is four merged "fixes" that each left the
clipper broken:

  * requirements-bare.txt pinned `yt-dlp==2026.7.4`, and the launcher's dependency sync only
    runs pip when that FILE changes. So the pin was not just stale, it was unreachable: the
    self-update could never move yt-dlp, which is the one dependency that goes stale on its
    own because YouTube rewrites its player every few weeks.
  * bare `yt-dlp` has neither the JavaScript challenge solver (`yt-dlp-ejs`, the [default]
    extra) nor a runtime to execute it ([deno]). Without them YouTube answers anonymous
    downloads with "Sign in to confirm you're not a bot" - which reads like a cookie problem,
    which is why three rounds of fixes went after cookies.

No network, no pip, no subprocess: _pip_upgrade is swapped out throughout.
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app import ytdlp_health as health

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


def _swap(**attrs):
    """Replace module attributes, returning a restore callable."""
    old = {k: getattr(health, k) for k in attrs}
    for k, v in attrs.items():
        setattr(health, k, v)
    return lambda: [setattr(health, k, v) for k, v in old.items()]


def test_missing_prerequisites_beat_the_age_gate():
    """An install that cannot download AT ALL must not wait out a 24-hour timer to find out."""
    restore = _swap(js_runtimes=lambda: {}, has_ejs=lambda: True)
    try:
        needed, why = health._needs_check()
        check("no JS runtime forces an immediate check", needed and "runtime" in why)
    finally:
        restore()
    restore = _swap(js_runtimes=lambda: {"deno": {}}, has_ejs=lambda: False)
    try:
        needed, why = health._needs_check()
        check("a missing challenge solver forces an immediate check",
              needed and "yt-dlp-ejs" in why)
    finally:
        restore()


def test_a_healthy_recent_install_is_left_alone(tmp_stamp=None):
    """The check must be cheap when there is nothing to do, or it becomes a startup tax."""
    stamp = Path(health._stamp_path())
    existed = stamp.exists()
    original = stamp.read_bytes() if existed else None
    restore = _swap(js_runtimes=lambda: {"deno": {}}, has_ejs=lambda: True)
    try:
        stamp.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"), encoding="ascii")
        needed, why = health._needs_check()
        check("a fresh stamp with prerequisites present skips pip", not needed)
        check("the reason says when it was last checked", "checked" in why)
    finally:
        restore()
        if original is None:
            stamp.unlink(missing_ok=True)
        else:
            stamp.write_bytes(original)


def test_a_failed_upgrade_is_reported_not_fatal():
    """An offline laptop must still start. Silence is what let this hide for four PRs, so the
    failure has to be *reported* - including the version it is stuck on."""
    restore = _swap(_pip_upgrade=lambda: (False, "no network"),
                    js_runtimes=lambda: {}, has_ejs=lambda: False)
    try:
        line = health.check()
    finally:
        restore()
    check("a failed upgrade does not raise", isinstance(line, str))
    check("a failed upgrade says so", "could not update" in line and "no network" in line)


def test_an_upgrade_that_does_not_fix_it_does_not_claim_success():
    """The exact way the previous fixes misled: pip ran, so it looked fine. If the
    prerequisites are STILL missing afterwards, the line must say so."""
    restore = _swap(_pip_upgrade=lambda: (True, ""),
                    js_runtimes=lambda: {}, has_ejs=lambda: False,
                    _stamp_path=lambda: Path("/dev/null"))
    try:
        line = health.check(force=True)
    finally:
        restore()
    check("a hollow success is reported as not ready", "still not ready" in line)
    check("it names which prerequisite is missing",
          "JS runtime: none" in line and "challenge solver: no" in line)


def test_readiness_is_reportable():
    restore = _swap(js_runtimes=lambda: {"deno": {"path": "/x"}}, has_ejs=lambda: True)
    try:
        state = health.readiness()
    finally:
        restore()
    check("readiness reports the runtime it found", state["js_runtimes"] == ["deno"])
    check("readiness reports the solver", state["ejs"] is True)
    check("a complete install is ready", state["ready"] is True)
    check("readiness names the yt-dlp version", isinstance(state["ytdlp"], str))


def test_auto_update_can_be_turned_off():
    import os
    old = os.environ.get("CVIDEO_AUTO_UPDATE")
    os.environ["CVIDEO_AUTO_UPDATE"] = "off"
    try:
        check("CVIDEO_AUTO_UPDATE=off disables the check", not health.auto_update_enabled())
        check("and check() says so, without running pip",
              "CVIDEO_AUTO_UPDATE is off" in health.check())
    finally:
        if old is None: os.environ.pop("CVIDEO_AUTO_UPDATE", None)
        else: os.environ["CVIDEO_AUTO_UPDATE"] = old


def test_waiting_never_hangs_when_no_check_is_running():
    """ingest waits on this before importing yt_dlp. Tests, one-off scripts and the shootdrop
    worker import ingest without the app's startup hook, and a wait on an event nobody will
    ever set is a five-minute hang, not a safety measure."""
    started = time.time()
    health.wait_until_checked(timeout=300)
    check("wait_until_checked returns immediately when nothing was started",
          time.time() - started < 1.0)


if __name__ == "__main__":
    test_missing_prerequisites_beat_the_age_gate()
    test_a_healthy_recent_install_is_left_alone()
    test_a_failed_upgrade_is_reported_not_fatal()
    test_an_upgrade_that_does_not_fix_it_does_not_claim_success()
    test_readiness_is_reportable()
    test_auto_update_can_be_turned_off()
    test_waiting_never_hangs_when_no_check_is_running()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
