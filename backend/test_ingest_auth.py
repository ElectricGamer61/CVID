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
    def fake(opts, url, ranges=None, browser=None, cookiefile=None, player_client=None):
        calls.append(player_client or browser)
        if player_client or browser is None or browser == "edge":
            raise DownloadError("Sign in to confirm you're not a bot")
        return {"id": "ok"}
    ingest._ydl_attempt = fake
    try:
        result = ingest._ydl({}, "https://youtube.example/video")
    finally:
        settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt = old_order, old_attempt
    check("browsers are tried in order, and only after the anonymous players",
          calls == [None, *ingest._known_player_clients(), "edge", "chrome"])
    check("returns successful browser extraction", result == {"id": "ok"})


def test_format_fallback_order():
    old_attempt = ingest._ydl_attempt
    calls = []
    def fake(opts, url, ranges=None, browser=None, cookiefile=None, player_client=None):
        calls.append(opts.get("format"))
        if opts.get("format") != "best":
            raise DownloadError("Requested format is not available")
        return {"id": "fallback"}
    ingest._ydl_attempt = fake
    try:
        result = ingest._ydl({"format": ingest._FMT_FULL}, "https://youtube.example/video")
    finally:
        ingest._ydl_attempt = old_attempt
    check("tries preferred selector before simpler fallbacks", calls == [
        ingest._FMT_FULL, "bestvideo+bestaudio", "best"
    ])
    check("returns the first compatible fallback", result == {"id": "fallback"})


def test_format_fallback_final_error_is_actionable():
    old_attempt = ingest._ydl_attempt
    ingest._ydl_attempt = lambda *args, **kwargs: (_ for _ in ()).throw(
        DownloadError("Requested format is not available"))
    try:
        try:
            ingest._ydl({"format": ingest._FMT_PROXY}, "https://youtube.example/video")
        except RuntimeError as error:
            message = str(error)
        else:
            message = ""
    finally:
        ingest._ydl_attempt = old_attempt
    check("format exhaustion explains how to recover",
          "no compatible downloadable format" in message.lower()
          and "update yt-dlp" in message.lower()
          and "local video" in message.lower())


def test_default_browser_order_resolution():
    r = settings.resolve_cookie_browsers
    check("Windows defaults to chrome, edge, firefox with nothing configured",
          r(None, windows=True) == ("chrome", "edge", "firefox"))
    check("other platforms stay opt-in", r(None, windows=False) == ())
    check("`auto` enables the same order anywhere",
          r("auto", windows=False) == ("chrome", "edge", "firefox"))
    check("an explicit off word disables it", r("off", windows=True) == ()
          and r("none", windows=True) == () and r("false", windows=True) == ())
    check("an explicitly empty value disables it", r("", windows=True) == ())
    check("a configured order is honoured, cased and spaced freely",
          r(" Firefox , Edge ", windows=True) == ("firefox", "edge"))
    check("unsupported names are dropped, not handed to yt-dlp",
          r("netscape,chrome,chrome", windows=True) == ("chrome",))


def test_windows_default_is_tried_after_a_challenge():
    # The launcher passes nothing when the user never configured anything; the Windows
    # default must still produce the chrome -> edge -> firefox retry.
    old_order, old_attempt = settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt
    settings.YOUTUBE_COOKIE_BROWSERS = settings.resolve_cookie_browsers(None, windows=True)
    calls = []
    def fake(opts, url, ranges=None, browser=None, cookiefile=None, player_client=None):
        calls.append(player_client or browser)
        if player_client or browser != "firefox":
            raise DownloadError("Sign in to confirm you're not a bot")
        return {"id": "signed-in"}
    ingest._ydl_attempt = fake
    try:
        result = ingest._ydl({}, "https://youtube.example/video")
    finally:
        settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt = old_order, old_attempt
    check("anonymous, then the other players, then chrome, edge, firefox",
          calls == [None, *ingest._known_player_clients(), "chrome", "edge", "firefox"])
    check("a signed-in browser recovers the download", result == {"id": "signed-in"})


def test_unreadable_cookie_store_falls_through_to_the_next_browser():
    # A running Chrome, a locked cookie DB or a DPAPI failure raises something that is NOT
    # a DownloadError. It must cost that browser its turn, nothing more.
    old_order, old_attempt = settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt
    settings.YOUTUBE_COOKIE_BROWSERS = ("chrome", "edge")
    calls = []
    def fake(opts, url, ranges=None, browser=None, cookiefile=None, player_client=None):
        calls.append(player_client or browser)
        if player_client or browser is None:
            raise DownloadError("Sign in to confirm you're not a bot")
        if browser == "chrome":
            raise PermissionError("Could not copy Chrome cookie database")
        return {"id": "edge-ok"}
    ingest._ydl_attempt = fake
    try:
        result = ingest._ydl({}, "https://youtube.example/video")
    finally:
        settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt = old_order, old_attempt
    check("an unreadable cookie store does not abort the job",
          calls == [None, *ingest._known_player_clients(), "chrome", "edge"])
    check("the next browser still recovers the download", result == {"id": "edge-ok"})


def test_every_browser_failing_is_still_an_ordinary_error():
    old_order, old_attempt = settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt
    settings.YOUTUBE_COOKIE_BROWSERS = ("chrome", "firefox")
    def fake(opts, url, ranges=None, browser=None, cookiefile=None, player_client=None):
        if browser == "firefox":
            raise OSError("could not find firefox cookies database")
        raise DownloadError("Sign in to confirm you're not a bot")
    ingest._ydl_attempt = fake
    try:
        try:
            ingest._ydl({}, "https://youtube.example/video")
        except RuntimeError as error:
            message = str(error)
        except Exception as error:  # noqa: BLE001 - a raw crash is the thing we are ruling out
            message = f"UNEXPECTED {type(error).__name__}"
    finally:
        settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt = old_order, old_attempt
    check("exhausting every browser is a reportable job error, not a raw crash",
          message.startswith("YouTube asked Cvideo to sign in"))
    check("the error names the browsers tried and both reasons",
          "chrome" in message and "firefox" in message and "cookies database" in message)


def test_disabled_fallback_explains_itself():
    old_order, old_raw = settings.YOUTUBE_COOKIE_BROWSERS, settings.YOUTUBE_COOKIE_BROWSERS_RAW
    old_attempt = ingest._ydl_attempt
    settings.YOUTUBE_COOKIE_BROWSERS, settings.YOUTUBE_COOKIE_BROWSERS_RAW = (), "off"
    ingest._ydl_attempt = lambda *a, **k: (_ for _ in ()).throw(
        DownloadError("Sign in to confirm you're not a bot"))
    try:
        try:
            ingest._ydl({}, "https://youtube.example/video")
        except RuntimeError as error:
            message = str(error)
        else:
            message = ""
    finally:
        settings.YOUTUBE_COOKIE_BROWSERS = old_order
        settings.YOUTUBE_COOKIE_BROWSERS_RAW = old_raw
        ingest._ydl_attempt = old_attempt
    check("a deliberately disabled fallback says so, and how to turn it back on",
          "turned off" in message and "CVIDEO_YOUTUBE_COOKIE_BROWSERS=chrome,edge,firefox" in message)
    check("the error states cookies never leave the machine",
          "sent only to YouTube" in message)


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


def test_cookies_file_is_tried_before_any_browser():
    """A cookies.txt is explicit intent AND the only source that works on Windows Chrome/Edge."""
    import tempfile
    old_order, old_attempt = settings.YOUTUBE_COOKIE_BROWSERS, ingest._ydl_attempt
    old_file = settings.YOUTUBE_COOKIES_FILE
    settings.YOUTUBE_COOKIE_BROWSERS = ("chrome", "firefox")
    with tempfile.TemporaryDirectory() as directory:
        jar = Path(directory) / "youtube-cookies.txt"
        jar.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
        settings.YOUTUBE_COOKIES_FILE = jar
        calls = []
        def fake(opts, url, ranges=None, browser=None, cookiefile=None, player_client=None):
            calls.append(player_client or cookiefile or browser)
            if player_client or (cookiefile is None and browser is None):
                raise DownloadError("Sign in to confirm you're not a bot")
            return {"id": "ok"}
        ingest._ydl_attempt = fake
        try:
            result = ingest._ydl({}, "https://youtube.example/video")
        finally:
            settings.YOUTUBE_COOKIE_BROWSERS = old_order
            settings.YOUTUBE_COOKIES_FILE = old_file
            ingest._ydl_attempt = old_attempt
    check("the cookies.txt is used before any browser store",
          calls == [None, *ingest._known_player_clients(), str(jar)])
    check("a cookies.txt recovers the download", result == {"id": "ok"})


def test_cookies_file_resolution():
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        default = Path(directory) / "youtube-cookies.txt"
        explicit = Path(directory) / "elsewhere.txt"
        check("nothing configured and no file means no cookie file",
              settings.resolve_cookies_file("", default) is None)
        default.write_text("x", encoding="utf-8")
        check("the default location is picked up just by dropping the file in",
              settings.resolve_cookies_file("", default) == default)
        check("a path that does not exist is not passed to yt-dlp",
              settings.resolve_cookies_file(str(explicit), default) is None)
        explicit.write_text("x", encoding="utf-8")
        check("an explicit path wins over the default location",
              settings.resolve_cookies_file(f'"{explicit}"', default) == explicit)


def test_windows_cookie_store_failures_are_diagnosed():
    """The laptop's three real errors, verbatim from data\\backend.log."""
    abe = ("ERROR: ERROR: Failed to decrypt with DPAPI. See "
           "https://github.com/yt-dlp/yt-dlp/issues/10927 for more info")
    locked = ("ERROR: ERROR: Could not copy Chrome cookie database. See "
              "https://github.com/yt-dlp/yt-dlp/issues/7271 for more info")
    signed_out = ("ERROR: [youtube] TfoQmmubqro: Sign in to confirm you're not a bot. "
                  "Use --cookies-from-browser or --cookies for the authentication.")
    check("App-Bound Encryption is named as such, not as a sign-in problem",
          "App-Bound Encryption" in (ingest.cookie_store_hint(abe) or ""))
    check("a locked cookie database asks for the browser to be closed",
          "close that browser" in (ingest.cookie_store_hint(locked) or ""))
    check("a readable but signed-out store is told apart from an unreadable one",
          "not signed in" in (ingest.cookie_store_hint(signed_out) or ""))
    message = ingest._cookie_failure_message(
        [("chrome", locked), ("edge", abe), ("firefox", signed_out)])
    check("the failure message carries each source's own remedy",
          "App-Bound Encryption" in message and "close that browser" in message)
    check("the failure message names the installed yt-dlp",
          f"yt-dlp {ingest.ytdlp_version()}" in message)
    check("the failure message points at the update and the cookies.txt",
          "update.cmd" in message and "cookies.txt" in message)
    check("the raw yt-dlp text is kept for support", "10927" in message and "7271" in message)


if __name__ == "__main__":
    test_challenge_detection(); test_browser_fallback_order()
    test_format_fallback_order(); test_format_fallback_final_error_is_actionable()
    test_default_browser_order_resolution(); test_windows_default_is_tried_after_a_challenge()
    test_unreadable_cookie_store_falls_through_to_the_next_browser()
    test_every_browser_failing_is_still_an_ordinary_error()
    test_disabled_fallback_explains_itself()
    test_cookies_file_is_tried_before_any_browser(); test_cookies_file_resolution()
    test_windows_cookie_store_failures_are_diagnosed()
    test_no_cookie_error_and_local_path()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
