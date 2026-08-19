"""Ingest layer — efficient "proxy workflow":

For YouTube URLs we never pull the whole full-res video up front. Instead:
  - download_audio()       -> tiny audio only, for transcription + brain
  - download_proxy()       -> small 360p video, for editor preview / trim
  - download_clip_range()  -> full quality, ONLY the exact seconds of a clip, at export

For local uploads, save_upload() keeps the file and extract_audio() pulls the audio.
"""
from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

# Forgiving format selector: grab the best source up to 4K so high-res exports have
# real detail to work with, falling back gracefully to whatever's available.
_FMT_FULL = "bv*[height<=2160]+ba/b[height<=2160]/bv*+ba/b/best"
_FMT_PROXY = "bv*[height<=360]+ba/b[height<=360]/worst[height>=240]/best"

# YouTube's googlevideo URLs expire / throttle and intermittently return HTTP 403.
# A fresh extract_info() re-mints those URLs, so retrying the whole call (not just
# the fragment) clears most transient 403/timeout failures.
_TRANSIENT = ("403", "forbidden", "timed out", "timeout",
              "connection reset", "unable to download video data")
_MAX_TRIES = 4

# Keep this intentionally specific: an ordinary 403/timeout should retain the existing
# transient retry behavior, while a sign-in challenge is the one case where a local browser
# session can legitimately help. yt-dlp words it several ways (and points at
# --cookies-from-browser itself), so match the phrasings rather than one exact sentence.
_BOT_CHALLENGE_MARKERS = (
    "sign in to confirm you're not a bot",
    "sign in to confirm you’re not a bot",
    "confirm you're not a bot",
    "confirm you’re not a bot",
    "not a bot",
    "confirm you are not a bot",
    "sign in to confirm",
    "cookies-from-browser",
    "use --cookies",
    "please sign in",
    "login required",
)


def is_bot_challenge(error: object) -> bool:
    """Return whether yt-dlp reported YouTube's interactive bot/sign-in challenge."""
    text = str(error).lower()
    return any(marker in text for marker in _BOT_CHALLENGE_MARKERS)


# yt-dlp asks YouTube through an "InnerTube client", and which clients YouTube still serves
# an anonymous download to changes without notice. On the machine this was debugged on, the
# default clients extracted the metadata fine and then took HTTP 403 on the media itself,
# while `android` downloaded it outright - no cookies, no sign-in, nothing for the user to do.
# So a blocked download sweeps these before it asks anyone to sign in. Ordered by what
# actually got through most recently; unknown names are dropped rather than passed to yt-dlp,
# which would fail the retry with a config error instead of the YouTube problem.
_PLAYER_CLIENTS = ("android", "tv_simply", "web_embedded", "mweb", "ios", "tv")

# A download YouTube refused in a way that another client or a signed-in session can fix.
# Anything else (private video, removed video, a typo'd URL) must still fail immediately.
_BLOCKED_MARKERS = ("403", "forbidden", "unable to download video data",
                    "the page needs to be reloaded", "please try again")


def is_blocked_download(error: object) -> bool:
    """Return whether YouTube refused this download in a recoverable way."""
    text = str(error).lower()
    return (is_bot_challenge(text) or is_format_unavailable(text)
            or any(marker in text for marker in _BLOCKED_MARKERS))


def _known_player_clients() -> tuple[str, ...]:
    """_PLAYER_CLIENTS, minus any name this yt-dlp build does not know."""
    try:
        from yt_dlp.extractor.youtube._base import INNERTUBE_CLIENTS
    except Exception:  # noqa: BLE001 - a moved internal must not break ingest
        return _PLAYER_CLIENTS
    return tuple(name for name in _PLAYER_CLIENTS if name in INNERTUBE_CLIENTS)


def is_format_unavailable(error: object) -> bool:
    """Return whether yt-dlp rejected only the requested format selector."""
    text = str(error).lower()
    return any(marker in text for marker in (
        "requested format is not available",
        "requested format not available",
        "format is not available",
    ))


def _format_candidates(opts: dict) -> tuple[dict, ...]:
    """Return preferred options followed by selectors accepted by more videos.

    Keep this here, rather than weakening the primary selectors, so good sources
    still get the requested proxy/full quality while odd YouTube manifests can
    degrade to a playable download.
    """
    selected = opts.get("format")
    if not selected:
        return (opts,)
    if "audio" in selected.lower() and selected == "bestaudio/best":
        formats = (selected, "bestaudio", "best")
    else:
        formats = (selected, "bestvideo+bestaudio", "best", "bv*+ba/b")
    candidates = []
    for fmt in formats:
        if fmt not in {item.get("format") for item in candidates}:
            candidate = dict(opts)
            candidate["format"] = fmt
            candidates.append(candidate)
    return tuple(candidates)


def _browser_order() -> tuple[str, ...]:
    # Imported at call time so tests and long-running local installs can configure this
    # without making local-file ingestion depend on browser state. settings has already
    # applied the platform default and dropped unsupported names.
    from settings import YOUTUBE_COOKIE_BROWSERS
    return tuple(YOUTUBE_COOKIE_BROWSERS)


def _cookies_file() -> str | None:
    """An exported cookies.txt to try BEFORE any browser store, or None."""
    import settings
    path = getattr(settings, "YOUTUBE_COOKIES_FILE", None)
    return str(path) if path else None


def ytdlp_version() -> str:
    """The yt-dlp actually installed in this backend, for the failure message.

    A year-stale extractor is the single most common reason YouTube starts challenging a
    download at all, and the version is the first thing worth knowing when it does."""
    try:
        import yt_dlp
        return str(yt_dlp.version.__version__)
    except Exception:  # noqa: BLE001 - diagnostics must never be the thing that fails
        return "unknown"


# Why a browser's cookie store could not be used, in the user's terms. yt-dlp's own text
# points at GitHub issues; these are the two that a Windows desktop actually hits, and the
# remedy for each is different (one is "close the browser", the other has no browser-side
# remedy at all), so guessing one message for both sends half the users the wrong way.
_COOKIE_STORE_HINTS = (
    (("failed to decrypt with dpapi", "10927", "app-bound", "appbound"),
     "Chrome and Edge seal their cookies with App-Bound Encryption (Chrome 127 and newer) "
     "and yt-dlp cannot read them on Windows - use Firefox, or an exported cookies.txt"),
    (("could not copy", "7271", "database is locked", "permissiondenied"),
     "its cookie database was locked - close that browser completely (check the tray) "
     "and retry"),
    (("could not find", "no such file", "not found", "does not exist"),
     "no profile for that browser was found on this PC"),
)


def cookie_store_hint(error_text: str) -> str | None:
    """Translate a cookie-store failure into the remedy it actually has, or None."""
    text = str(error_text).lower()
    for markers, hint in _COOKIE_STORE_HINTS:
        if any(marker in text for marker in markers):
            return hint
    if is_bot_challenge(text):
        return "those cookies were accepted but are not signed in to YouTube"
    return None


def _no_fallback_message() -> str:
    """Explain the *specific* reason no browser session was tried, and how to fix it."""
    import settings
    raw = getattr(settings, "YOUTUBE_COOKIE_BROWSERS_RAW", None)
    if raw is None:
        why = ("The browser-cookie fallback is not enabled on this platform "
               "(it is on by default only on Windows).")
    elif not raw.strip() or raw.strip().lower() in ("off", "none", "no", "0", "false", "disabled"):
        why = f"The browser-cookie fallback is turned off (CVIDEO_YOUTUBE_COOKIE_BROWSERS={raw!r})."
    else:
        supported = ", ".join(settings.SUPPORTED_COOKIE_BROWSERS)
        why = (f"CVIDEO_YOUTUBE_COOKIE_BROWSERS={raw!r} names no browser Cvideo can read "
               f"cookies from (supported: {supported}).")
    return (
        "YouTube asked you to sign in because it detected automated traffic. " + why +
        f" First update: yt-dlp {ytdlp_version()} is installed, and an out-of-date yt-dlp is "
        "the usual reason YouTube starts challenging downloads at all (double-click "
        "update.cmd). If it still asks, export a cookies.txt from a browser signed in to "
        f"YouTube and save it as {_cookies_file_hint()} - that works on every platform. The "
        "browser route is CVIDEO_YOUTUBE_COOKIE_BROWSERS=chrome,edge,firefox in backend/.env, "
        "though on Windows only Firefox can actually be read (Chrome and Edge encrypt their "
        "cookie store). Restart Cvideo and retry the project. Cookies are read locally and "
        "sent only to YouTube."
    )


def _cookies_file_hint() -> str:
    """Where to put a cookies.txt, named the way this platform writes paths."""
    import settings
    return str(settings.DEFAULT_COOKIES_FILE)


def _ydl_attempt(opts: dict, url: str, ranges=None, browser: str | None = None,
                 cookiefile: str | None = None, player_client: str | None = None) -> dict:
    import yt_dlp
    if ranges is not None:
        from yt_dlp.utils import download_range_func
        opts = dict(opts)
        opts["download_ranges"] = download_range_func(None, ranges)
        opts["force_keyframes_at_cuts"] = True
    base = {
        "quiet": True, "no_warnings": True, "noprogress": True,
        # yt-dlp's own per-fragment/HTTP retries (handles brief blips in-place).
        "retries": 10, "fragment_retries": 10, "extractor_retries": 3,
    }
    if browser:
        # yt-dlp reads the browser cookie database locally. No password scraping or
        # cookie upload is performed by Cvideo.
        base["cookiesfrombrowser"] = (browser,)
    if cookiefile:
        # An exported cookies.txt. Same locality guarantee: yt-dlp attaches it to the
        # YouTube request it is already making and nothing else.
        base["cookiefile"] = cookiefile
    base.update(opts)
    if player_client:
        # After base.update: this is Cvideo's own retry strategy and a caller's opts must
        # never silently disable it.
        base["extractor_args"] = {"youtube": {"player_client": [player_client]}}
    with yt_dlp.YoutubeDL(base) as ydl:
        return ydl.extract_info(url, download=True)


def _ydl(_opts: dict, url: str, ranges=None) -> dict:
    """Download `url`, escalating only as far as it has to.

    Three passes, cheapest and least intrusive first:
      1. anonymous, yt-dlp's own default clients - what works for most videos;
      2. anonymous, one alternative InnerTube client at a time - this is what recovers the
         "metadata fine, media 403" refusal, and it needs nothing from the user;
      3. local cookies (an exported cookies.txt, then each configured browser) - the only
         pass that touches anything of the user's, so it is the last one tried.
    A refusal that none of these can fix (private, removed, wrong URL) is re-raised in
    pass 1 untouched."""
    from yt_dlp.utils import DownloadError

    candidates = _format_candidates(_opts)
    format_errors: list[str] = []
    saw_challenge = False

    def attempt(opts: dict, browser=None, cookiefile=None, player_client=None, max_tries=_MAX_TRIES):
        nonlocal saw_challenge
        for retry in range(1, max_tries + 1):
            try:
                return _ydl_attempt(opts, url, ranges, browser, cookiefile, player_client)
            except DownloadError as error:  # noqa: PERF203
                if is_bot_challenge(error):
                    saw_challenge = True
                if is_format_unavailable(error):
                    format_errors.append(str(error))
                    raise
                msg = str(error).lower()
                if retry == max_tries or not any(t in msg for t in _TRANSIENT):
                    raise
                time.sleep(2 * retry)

    def try_all(browser=None, cookiefile=None, player_client=None, max_tries=_MAX_TRIES):
        for opts in candidates:
            try:
                return attempt(opts, browser, cookiefile, player_client, max_tries)
            except DownloadError as error:
                if not is_format_unavailable(error):
                    raise
        return None

    # --- Pass 1: exactly what a working install has always done ------------------------
    try:
        result = try_all()
        if result is not None:
            return result
    except Exception as anonymous_error:  # noqa: BLE001 - re-raised unless YouTube can be worked around
        # Broader than DownloadError on purpose: yt-dlp surfaces the challenge as an
        # ExtractorError from some code paths, and everything else is re-raised untouched.
        if is_bot_challenge(anonymous_error):
            saw_challenge = True
        if not is_blocked_download(anonymous_error):
            raise
        first_error: Exception | None = anonymous_error
    else:
        first_error = None                      # every format said "not available"

    # --- Pass 2: the same download through another YouTube client, still anonymous ------
    # max_tries=1: this is a sweep, and the transient back-off has already been spent on
    # the default clients. Six slow retries per client would turn a recovery into a stall.
    clients = _known_player_clients()
    client_errors: list[tuple[str, str]] = []
    if clients:
        print("[ingest] YouTube refused the default download; trying other players: "
              + ", ".join(clients))
    for client in clients:
        try:
            result = try_all(player_client=client, max_tries=1)
            if result is not None:
                print(f"[ingest] recovered using the {client} player")
                return result
        except Exception as error:  # noqa: BLE001 - one client's problem is not the job's
            if is_bot_challenge(error):
                saw_challenge = True
            client_errors.append((client, str(error)))

    # --- Pass 3: local cookies ---------------------------------------------------------
    # An exported cookies.txt goes first: it is explicit user intent, and on Windows it is
    # the only source that can actually work (see settings.DEFAULT_COOKIES_FILE).
    cookiefile = _cookies_file()
    sources: list[tuple[str, str | None, str | None]] = []
    if cookiefile:
        sources.append((f"cookies.txt ({cookiefile})", None, cookiefile))
    sources += [(browser, browser, None) for browser in _browser_order()]
    if not sources:
        if saw_challenge:
            raise RuntimeError(_no_fallback_message()) from first_error
    else:
        print("[ingest] retrying with local cookies: "
              + ", ".join(label for label, _, _ in sources))
        source_errors: list[tuple[str, str]] = []
        for label, browser, cookies in sources:
            try:
                result = try_all(browser, cookies)
                if result is not None:
                    print(f"[ingest] recovered using {label}")
                    return result
            except DownloadError as error:
                source_errors.append((label, str(error)))
            except Exception as error:  # noqa: BLE001
                # A browser that is running, absent, or whose cookie store cannot be
                # decrypted raises something other than DownloadError (OSError, PermissionError,
                # yt-dlp's own ValueError). That is a reason to try the NEXT source, never a
                # reason to take the job - or the backend - down.
                source_errors.append((label, f"{type(error).__name__}: {error}"))
                print(f"[ingest] {label} cookies unavailable: {error}")
        if source_errors and not all(is_format_unavailable(text) for _, text in source_errors):
            raise RuntimeError(
                _cookie_failure_message(source_errors) + _clients_note(client_errors)
            ) from first_error

    if format_errors:
        raise RuntimeError(
            "YouTube has no compatible downloadable format for this video. "
            f"Update yt-dlp (yt-dlp {ytdlp_version()} is installed - on Windows, double-click "
            "update.cmd) and retry, or use a local video file." + _clients_note(client_errors) +
            f" Details: {format_errors[-1]}"
        )
    raise RuntimeError(
        "YouTube refused this download and none of the fallbacks got through. "
        f"Update yt-dlp (yt-dlp {ytdlp_version()} is installed - on Windows, double-click "
        "update.cmd) and retry the project." + _clients_note(client_errors) +
        (f" Details: {first_error}" if first_error else "")
    )


def _clients_note(client_errors: list[tuple[str, str]]) -> str:
    """Say which alternative players were swept, so a support log shows the whole ladder."""
    if not client_errors:
        return ""
    return " Also tried these YouTube players: " + ", ".join(
        f"{client} ({text.strip().splitlines()[0][:120]})" for client, text in client_errors) + "."


def _cookie_failure_message(source_errors: list[tuple[str, str]]) -> str:
    """One actionable paragraph: what was tried, why each failed, what to do now.

    The previous wording ("sign in to one configured browser, close it, then retry") was
    advice that could not work: the laptop's real failures were Chrome's locked database and
    Edge's App-Bound Encryption, and no amount of signing in fixes the second one."""
    tried = []
    for label, text in source_errors:
        hint = cookie_store_hint(text)
        tried.append(f"{label} ({hint})" if hint else label)
    return (
        "YouTube asked Cvideo to sign in (bot check) and none of the local cookie sources "
        f"got through. Tried: {'; '.join(tried)}. "
        f"yt-dlp {ytdlp_version()} is installed - an out-of-date yt-dlp is the usual reason "
        "YouTube starts challenging downloads at all, so double-click update.cmd first. "
        "If it still asks, export a cookies.txt from a browser signed in to YouTube and save "
        f"it as {_cookies_file_hint()} (Chrome and Edge cookie stores cannot be read directly "
        "on Windows), then retry the project. "
        f"Details: {'; '.join(f'{label}: {text}' for label, text in source_errors)}"
    )


def _finalize(out_path: Path) -> Path:
    """yt-dlp writes <stem>.<ext>; normalise to the requested .mp4 path."""
    produced = out_path.with_suffix(".mp4")
    if produced.exists() and produced != out_path:
        produced.replace(out_path)
    if not out_path.exists():
        for f in sorted(out_path.parent.glob(out_path.stem + ".*")):
            if f.suffix not in (".part", ".ytdl"):
                f.replace(out_path)
                break
    if not out_path.exists():
        raise RuntimeError(f"yt-dlp produced no file at {out_path}")
    return out_path


# --------------------------------------------------------------------------- #
# YouTube (proxy workflow)
# --------------------------------------------------------------------------- #
def download_audio(url: str, audio_wav: Path) -> tuple[Path, float]:
    """Download audio only, then transcode to 16 kHz mono WAV for Whisper.
    Returns (wav_path, duration_seconds)."""
    stem = audio_wav.parent / "_audiodl"
    info = _ydl(
        {"format": "bestaudio/best", "outtmpl": str(stem) + ".%(ext)s"}, url
    )
    downloaded = None
    for f in sorted(audio_wav.parent.glob("_audiodl.*")):
        if f.suffix not in (".part", ".ytdl"):
            downloaded = f
            break
    if not downloaded:
        raise RuntimeError("audio download produced no file")
    extract_audio(downloaded, audio_wav)
    downloaded.unlink(missing_ok=True)
    return audio_wav, float(info.get("duration") or 0.0)


def download_proxy(url: str, proxy_mp4: Path) -> Path:
    """Download a small 360p preview/trim proxy."""
    _ydl(
        {"format": _FMT_PROXY, "merge_output_format": "mp4",
         "outtmpl": str(proxy_mp4.with_suffix("")) + ".%(ext)s"},
        url,
    )
    return _finalize(proxy_mp4)


def download_full(url: str, out_mp4: Path) -> Path:
    """Download the full-quality video once (cached, reused for all clip exports)."""
    _ydl(
        {"format": _FMT_FULL, "merge_output_format": "mp4",
         "outtmpl": str(out_mp4.with_suffix("")) + ".%(ext)s"},
        url,
    )
    return _finalize(out_mp4)


def download_clip_range(url: str, out_mp4: Path, start: float, end: float) -> Path:
    """Download ONLY [start, end] at full quality (accurate, keyframe-forced cut).
    The resulting file is clip-local (begins at 0).

    NOTE: yt-dlp's force_keyframes_at_cuts re-encode is unreliable on some Windows
    setups; export currently uses download_full() + cache instead. Kept for reference."""
    _ydl(
        {"format": _FMT_FULL, "merge_output_format": "mp4",
         "outtmpl": str(out_mp4.with_suffix("")) + ".%(ext)s"},
        url, ranges=[(start, end)],
    )
    return _finalize(out_mp4)


# --------------------------------------------------------------------------- #
# Local files
# --------------------------------------------------------------------------- #
def save_upload(src_file: Path, out_path: Path) -> Path:
    shutil.copy(src_file, out_path)
    return out_path


def extract_audio(video_path: Path, audio_path: Path) -> Path:
    """Extract 16 kHz mono WAV for Whisper."""
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(audio_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return audio_path


def extract_voiceover(src_path: Path, audio_path: Path) -> Path:
    """Full-quality voiceover WAV (48 kHz stereo) — for recorded voice that ends up
    in the export, NOT the 16 kHz mono Whisper path."""
    cmd = [
        "ffmpeg", "-y", "-i", str(src_path),
        "-vn", "-ac", "2", "-ar", "48000",
        "-c:a", "pcm_s16le", str(audio_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return audio_path


def probe_duration(video_path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(video_path),
    ]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0
