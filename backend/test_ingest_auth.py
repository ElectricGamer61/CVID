"""YouTube cookie fallback checks; no network or browser profile is needed."""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from yt_dlp.utils import DownloadError
except ModuleNotFoundError:  # the standalone suite does not require yt-dlp/network access
    import types
    class DownloadError(Exception):
        pass
    yt_dlp = types.ModuleType("yt_dlp")
    yt_dlp_utils = types.ModuleType("yt_dlp.utils")
    yt_dlp_utils.DownloadError = DownloadError
    sys.modules["yt_dlp"] = yt_dlp
    sys.modules["yt_dlp.utils"] = yt_dlp_utils

from app.pipeline import ingest
import settings

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


def test_challenge_detection():
    check("detects YouTube bot challenge", ingest.is_bot_challenge(
        "Sign in to confirm you're not a bot"))
    check("does not classify a transient 403 as a challenge",
          not ingest.is_bot_challenge("HTTP Error 403: Forbidden"))


def test_browser_fallback_order():
    old_order, old_attempt = settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt
    settings.YOUTUBE_COOKIE_BROWSERS = ("edge", "chrome", "firefox")
    calls = []
    def fake(opts, url, ranges=None, browser=None):
        calls.append(browser)
        if browser is None or browser == "edge":
            raise DownloadError("Sign in to confirm you're not a bot")
        return {"id": "ok"}
    ingest._ydl_attempt = fake
    try:
        result = ingest._ydl({}, "https://youtube.example/video")
    finally:
        settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt = old_order, old_attempt
    check("tries configured browsers in order", calls == [None, "edge", "chrome"])
    check("returns successful browser extraction", result == {"id": "ok"})


def test_no_cookie_error_and_local_path():
    old_order, old_attempt = settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt
    settings.YOUTUBE_COOKIE_BROWSERS = ()
    ingest._ydl_attempt = lambda *args, **kwargs: (_ for _ in ()).throw(
        DownloadError("Sign in to confirm you're not a bot"))
    try:
        try:
            ingest._ydl({}, "https://youtube.example/video")
        except RuntimeError as error:
            message = str(error)
        else:
            message = ""
    finally:
        settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt = old_order, old_attempt
    check("no browser session gives actionable setup error",
          "CVIDEO_YOUTUBE_COOKIE_BROWSERS" in message and "retry" in message.lower())
    with __import__("tempfile").TemporaryDirectory() as directory:
        source, target = Path(directory) / "clip.mov", Path(directory) / "source.mp4"
        source.write_bytes(b"local clip")
        ingest.save_upload(source, target)
        check("local upload does not invoke YouTube cookies", target.read_bytes() == b"local clip")


if __name__ == "__main__":
    test_challenge_detection(); test_browser_fallback_order(); test_no_cookie_error_and_local_path()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
