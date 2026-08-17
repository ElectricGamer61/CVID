"""Transcription fallback + failure reporting — standalone checks (no pytest, no server,
no media, no faster-whisper install needed).

Run: python test_transcribe.py

Guards the bug that made every upload on a laptop build fail with
"transcription worker crashed (exit 1) - likely a GPU/CUDA fault":

  * a missing faster-whisper is a config problem, not a device one, so it must NOT be
    reported as "failed on all devices" and must NOT be retried per device;
  * a broken/absent CUDA runtime must still land on the CPU and produce a transcript;
  * the parent must relay the worker's OWN reason instead of guessing at the GPU, and
    only blame the GPU for exit codes that really are native crashes.

And the follow-on report — the job frozen on "Transcribing" 20% forever, because the
first-run model download happens inside WhisperModel() where nothing can see it:

  * the download must be narrated (first-run message + live megabytes) before the model
    is built, so the row never sits silent;
  * a GPU with no cuBLAS must not be attempted at all — that attempt cost a 3.1 GB
    large-v3 download purely to fail;
  * a failed download must read as a network problem with a Retry, not as a device fault;
  * a worker that goes completely silent must be cancelled and reported, not waited on.
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "app"))

import settings  # noqa: E402
from app import jobs  # noqa: E402
from app.pipeline import transcribe  # noqa: E402
from app.pipeline.transcribe_worker import ERROR_PREFIX  # noqa: E402

FAILED = []


def check(name, cond, extra=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond:
        FAILED.append(name)


def _fake_run(recorder, fail_on=(), result_extra=None):
    """Stand-in for transcribe._run that records attempts and can fail chosen devices."""
    def run(device, model_name, compute, audio_path, progress):
        recorder.append((device, model_name, compute))
        if device in fail_on:
            raise RuntimeError(f"cuBLAS DLL load failed on {device}")
        out = {"device": device, "language": "en", "duration": 1.0,
               "text": "hi", "words": []}
        out.update(result_extra or {})
        return out
    return run


# --- 1. Missing engine is a config error, not a device error -------------------------

def test_missing_engine_is_not_a_device_failure():
    print("\n[transcribe] faster-whisper not installed")
    calls = []

    def boom(name, device, compute):
        calls.append(device)
        raise transcribe.TranscriptionUnavailable(transcribe.NO_ENGINE_MSG)

    orig = transcribe._get_model
    transcribe._get_model = boom
    try:
        try:
            transcribe._transcribe_local(Path("x.wav"))
            err = None
        except Exception as e:  # noqa: BLE001
            err = e
    finally:
        transcribe._get_model = orig

    check("raises TranscriptionUnavailable",
          isinstance(err, transcribe.TranscriptionUnavailable), type(err).__name__)
    check("does NOT claim the devices failed",
          "all devices" not in str(err), str(err))
    check("does not pointlessly retry a second device", len(calls) == 1, calls)
    check("tells the user how to fix it",
          "faster-whisper" in str(err) and "ELEVENLABS_API_KEY" in str(err), str(err))
    check("TranscriptionUnavailable is still a RuntimeError (callers catch that)",
          issubclass(transcribe.TranscriptionUnavailable, RuntimeError))


# --- 2. A broken GPU still produces a transcript on the CPU --------------------------

def _pretend_cached(value=True):
    """Take the download cap out of play: with the weights on disk, pick_model is a no-op.
    Returns a restore callable."""
    orig = transcribe.model_is_cached
    transcribe.model_is_cached = lambda name: value
    def restore():
        transcribe.model_is_cached = orig
    return restore


def test_cuda_failure_falls_back_to_cpu():
    print("\n[transcribe] GPU present but CUDA broken -> CPU")
    calls = []
    orig_run, orig_dev, orig_avail = (
        transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available)
    uncache = _pretend_cached()
    transcribe._run = _fake_run(calls, fail_on=("cuda",))
    transcribe.cuda_available = lambda: True
    settings.WHISPER_DEVICE = "auto"
    try:
        got = transcribe._transcribe_local(Path("x.wav"))
    finally:
        uncache()
        transcribe._run, settings.WHISPER_DEVICE = orig_run, orig_dev
        transcribe.cuda_available = orig_avail

    check("tried cuda first, then cpu", [c[0] for c in calls] == ["cuda", "cpu"], calls)
    check("returned a CPU transcript", got["device"] == "cpu", got)
    check("cuda used the full model", calls[0][1] == settings.WHISPER_MODEL, calls)
    check("cpu used the CPU-sized model", calls[1][1] == settings.WHISPER_MODEL_CPU, calls)
    check("cpu runs int8", calls[1][2] == "int8", calls)


def test_no_gpu_never_loads_the_gpu_model():
    """The cost of "just try CUDA and see": on a GPU-less laptop that meant downloading
    the 3 GB large-v3 model to learn there is no GPU, then downloading the CPU one too."""
    print("\n[transcribe] auto with no GPU present")
    calls = []
    orig_run, orig_dev, orig_avail = (
        transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available)
    transcribe._run = _fake_run(calls)
    transcribe.cuda_available = lambda: False
    settings.WHISPER_DEVICE = "auto"
    try:
        got = transcribe._transcribe_local(Path("x.wav"))
    finally:
        transcribe._run, settings.WHISPER_DEVICE = orig_run, orig_dev
        transcribe.cuda_available = orig_avail

    check("goes straight to CPU", [c[0] for c in calls] == ["cpu"], calls)
    check("never asks for the GPU-sized model",
          settings.WHISPER_MODEL not in [c[1] for c in calls]
          or settings.WHISPER_MODEL == settings.WHISPER_MODEL_CPU, calls)
    check("still transcribes", got["device"] == "cpu", got)


def test_explicit_cuda_is_still_honoured():
    print("\n[transcribe] CVIDEO_WHISPER_DEVICE=cuda with no GPU detected")
    calls = []
    orig_run, orig_dev, orig_avail = (
        transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available)
    uncache = _pretend_cached()
    transcribe._run = _fake_run(calls, fail_on=("cuda",))
    transcribe.cuda_available = lambda: False   # the probe must not veto an explicit pick
    settings.WHISPER_DEVICE = "cuda"
    try:
        got = transcribe._transcribe_local(Path("x.wav"))
    finally:
        uncache()
        transcribe._run, settings.WHISPER_DEVICE = orig_run, orig_dev
        transcribe.cuda_available = orig_avail

    check("still tries cuda when explicitly asked", calls[0][0] == "cuda", calls)
    check("and still ends up working on the CPU", got["device"] == "cpu", got)


def test_cuda_probe_is_safe_without_ctranslate2():
    print("\n[transcribe] cuda_available() on a machine with nothing installed")
    ok = True
    try:
        transcribe.cuda_available()
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"    raised {e!r}")
    check("never raises, whatever is or isn't installed", ok)


def test_device_cpu_skips_the_gpu_entirely():
    print("\n[transcribe] CVIDEO_WHISPER_DEVICE=cpu")
    calls = []
    orig_run, orig_dev = transcribe._run, settings.WHISPER_DEVICE
    transcribe._run = _fake_run(calls)
    settings.WHISPER_DEVICE = "cpu"
    try:
        got = transcribe._transcribe_local(Path("x.wav"))
    finally:
        transcribe._run, settings.WHISPER_DEVICE = orig_run, orig_dev

    check("never touches cuda", [c[0] for c in calls] == ["cpu"], calls)
    check("still transcribes", got["device"] == "cpu", got)


def test_cpu_default_model_is_laptop_sized():
    print("\n[transcribe] CPU model default")
    check("CPU default is not large-v3",
          settings.WHISPER_MODEL_CPU != "large-v3", settings.WHISPER_MODEL_CPU)
    check("CPU default is set", bool(settings.WHISPER_MODEL_CPU))


# --- 2c. No default may commit the user to a multi-GB download -----------------------

def test_no_default_downloads_a_huge_model():
    """Cvideo is local-first. The GPU default is large-v3 (3.1 GB): fetching that because
    a *default* said so is what froze the first upload on "Transcribing" for a quarter of
    an hour and then failed on a dropped connection."""
    print("\n[transcribe] uncached large-v3 as a default")
    uncache = _pretend_cached(False)
    try:
        got = transcribe.pick_model("large-v3", pinned=False)
    finally:
        uncache()
    check("large-v3 is not auto-downloaded", got != "large-v3", got)
    check("it lands on a laptop-sized model instead",
          transcribe.MODEL_MB[got] <= settings.WHISPER_MAX_AUTO_DOWNLOAD_MB, got)
    check("the cap really is small enough to exclude large-v3",
          settings.WHISPER_MAX_AUTO_DOWNLOAD_MB < transcribe.MODEL_MB["large-v3"],
          settings.WHISPER_MAX_AUTO_DOWNLOAD_MB)


def test_a_cached_big_model_is_still_used():
    """The RTX desktop already has large-v3 on disk — the cap is about downloads, not
    about refusing quality someone has already paid for."""
    print("\n[transcribe] large-v3 already downloaded")
    uncache = _pretend_cached(True)
    try:
        got = transcribe.pick_model("large-v3", pinned=False)
    finally:
        uncache()
    check("a cached model is used whatever its size", got == "large-v3", got)


def test_an_explicit_choice_overrides_the_cap():
    print("\n[transcribe] CVIDEO_WHISPER_MODEL=large-v3")
    uncache = _pretend_cached(False)
    try:
        got = transcribe.pick_model("large-v3", pinned=True)
    finally:
        uncache()
    check("an explicit pick is honoured", got == "large-v3", got)


def test_the_small_defaults_are_never_substituted():
    print("\n[transcribe] laptop-sized defaults")
    uncache = _pretend_cached(False)
    try:
        kept = [transcribe.pick_model(m) for m in ("tiny", "base", "small")]
        custom = transcribe.pick_model("me/my-whisper")
    finally:
        uncache()
    check("tiny/base/small download as they are", kept == ["tiny", "base", "small"], kept)
    check("an unsized custom repo is left alone", custom == "me/my-whisper", custom)


def test_the_auto_path_never_queues_the_gpu_giant():
    """End to end through the attempt list: `auto` on a GPU box with nothing cached."""
    print("\n[transcribe] auto + GPU + empty model cache")
    calls = []
    orig_run, orig_dev, orig_avail, orig_model = (
        transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available,
        settings.WHISPER_MODEL)
    uncache = _pretend_cached(False)
    transcribe._run = _fake_run(calls)
    transcribe.cuda_available = lambda: True
    settings.WHISPER_DEVICE, settings.WHISPER_MODEL = "auto", "large-v3"
    try:
        transcribe._transcribe_local(Path("x.wav"))
    finally:
        uncache()
        (transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available,
         settings.WHISPER_MODEL) = orig_run, orig_dev, orig_avail, orig_model
    check("large-v3 is never even queued",
          "large-v3" not in [c[1] for c in calls], calls)
    check("both attempts stay laptop-sized",
          all(transcribe.MODEL_MB[c[1]] <= settings.WHISPER_MAX_AUTO_DOWNLOAD_MB
              for c in calls), calls)


# --- 2b. The first-run model download is visible, and not a device fault -------------

def _stub_download(monkey, *, cached=False, fail=None, chunks=()):
    """Stand in for faster_whisper.utils.download_model.

    `cached` = the local_files_only probe succeeds (nothing to download). Otherwise the
    real fetch either raises `fail` or walks the cache through `chunks` megabytes.
    """
    state = {"mb": 0}

    def download_model(name, local_files_only=False, **kw):
        if local_files_only:
            if cached:
                return "/cache/" + name
            raise RuntimeError("not cached")
        for mb in chunks:
            state["mb"] = mb
        if fail:
            raise fail
        return "/cache/" + name

    monkey["download_model"] = download_model
    monkey["cache_bytes"] = lambda name: state["mb"] * 1_000_000
    return state


class _FakeFwUtils:
    def __init__(self, fn):
        self.download_model = fn
        self._MODELS = {"small": "Systran/faster-whisper-small"}


def _with_download(cached=False, fail=None, chunks=()):
    """Install the stub into transcribe's import sites; returns (restore, state)."""
    import types
    monkey: dict = {}
    state = _stub_download(monkey, cached=cached, fail=fail, chunks=chunks)
    mod = types.ModuleType("faster_whisper.utils")
    mod.download_model = monkey["download_model"]        # type: ignore[attr-defined]
    mod._MODELS = {}                                     # type: ignore[attr-defined]
    pkg = types.ModuleType("faster_whisper")
    pkg.utils = mod                                      # type: ignore[attr-defined]
    saved = {k: sys.modules.get(k) for k in ("faster_whisper", "faster_whisper.utils")}
    sys.modules["faster_whisper"] = pkg
    sys.modules["faster_whisper.utils"] = mod
    orig_cache = transcribe._cache_bytes
    transcribe._cache_bytes = monkey["cache_bytes"]

    def restore():
        transcribe._cache_bytes = orig_cache
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    return restore, state


def test_cached_model_downloads_nothing_and_says_nothing():
    print("\n[transcribe] model already in the cache")
    seen = []
    restore, _ = _with_download(cached=True)
    try:
        transcribe.ensure_model_downloaded("small", lambda p, m: seen.append(m))
    finally:
        restore()
    check("the normal path stays silent", seen == [], seen)


def test_first_run_download_reports_progress():
    print("\n[transcribe] first run, model not cached")
    seen = []
    restore, _ = _with_download(cached=False, chunks=(120, 300, 484))
    try:
        transcribe.ensure_model_downloaded("small", lambda p, m: seen.append((p, m)))
    finally:
        restore()

    msgs = [m for _, m in seen]
    check("it says something before the download starts", bool(seen), seen)
    check("the very first message names the first-run wait",
          bool(msgs) and msgs[0].startswith("First run:"), msgs[:1])
    check("it names the model", all("small" in m for m in msgs), msgs)
    check("it tells the user this only happens once",
          all("happens once" in m for m in msgs), msgs)
    check("it quotes the download size so the wait is bounded",
          all("MB" in m for m in msgs), msgs)
    check("progress never claims to be finished",
          all(0 <= p <= 95 for p, _ in seen), seen)


def test_download_message_and_size_hint():
    print("\n[transcribe] download wording")
    check("small is quoted in MB", transcribe.model_size_hint("small") == "~484 MB",
          transcribe.model_size_hint("small"))
    check("large-v3 is quoted in GB", "GB" in transcribe.model_size_hint("large-v3"),
          transcribe.model_size_hint("large-v3"))
    check("an unknown custom repo just has no size hint",
          transcribe.model_size_hint("me/my-whisper") == "")
    unknown = transcribe._download_message("me/my-whisper", 12)
    check("an unknown model still reports megabytes", "12 MB so far" in unknown, unknown)
    # These totals are approximations of someone else's repo, so overshoot is possible.
    over = transcribe._download_message("base", 295)
    check("never prints more MB than the total it quoted", "of ~145" not in over, over)
    check("and still reports the real figure", "295 MB so far" in over, over)
    check("percent stays 0 when the total is unknown",
          transcribe._download_percent("me/my-whisper", 999) == 0)
    check("percent tracks the known total",
          transcribe._download_percent("small", 242) in range(40, 52),
          transcribe._download_percent("small", 242))


def test_offline_download_failure_is_not_a_device_failure():
    print("\n[transcribe] first run with no internet")
    err = ConnectionError("[WinError 10054] An existing connection was forcibly closed")
    restore, _ = _with_download(cached=False, fail=err)
    try:
        try:
            transcribe.ensure_model_downloaded("small")
            got = None
        except Exception as e:  # noqa: BLE001
            got = e
    finally:
        restore()

    check("raises ModelDownloadError",
          isinstance(got, transcribe.ModelDownloadError), type(got).__name__)
    check("never blames a device", "device" not in str(got).lower(), str(got))
    check("names the network as the problem",
          "connection" in str(got).lower() or "internet" in str(got).lower(), str(got))
    check("tells the user it resumes", "picks up where it left off" in str(got), str(got))
    check("offers the cloud alternative", "ELEVENLABS_API_KEY" in str(got), str(got))
    check("ModelDownloadError is a RuntimeError (callers catch that)",
          issubclass(transcribe.ModelDownloadError, RuntimeError))


def test_a_dead_download_is_not_retried_on_every_device():
    """The CPU fallback shares one dead link with the GPU. Retrying it there doubles the
    wait and then reports a network outage as "failed on all devices"."""
    print("\n[transcribe] download fails, same model on both devices")
    calls = []
    orig_run, orig_dev, orig_avail, orig_cpu = (
        transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available,
        settings.WHISPER_MODEL_CPU)

    def boom(device, model_name, compute, audio_path, progress):
        calls.append(device)
        raise transcribe.ModelDownloadError("couldn't download the small speech model")

    uncache = _pretend_cached()   # keep the download cap out of this test's attempt list
    transcribe._run = boom
    transcribe.cuda_available = lambda: True
    settings.WHISPER_DEVICE = "auto"
    settings.WHISPER_MODEL_CPU = settings.WHISPER_MODEL   # same weights on both attempts
    try:
        try:
            transcribe._transcribe_local(Path("x.wav"))
            err = None
        except Exception as e:  # noqa: BLE001
            err = e
    finally:
        uncache()
        (transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available,
         settings.WHISPER_MODEL_CPU) = orig_run, orig_dev, orig_avail, orig_cpu

    check("stops after the first attempt", calls == ["cuda"], calls)
    check("keeps the download reason",
          isinstance(err, transcribe.ModelDownloadError), type(err).__name__)
    check("does not report it as a device failure",
          "all devices" not in str(err), str(err))


def test_a_different_cpu_model_still_gets_its_chance():
    """A cached CPU model can still save the job when only the GPU one is missing."""
    print("\n[transcribe] GPU model download fails, CPU model differs")
    calls = []
    orig_run, orig_dev, orig_avail = (
        transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available)

    def run(device, model_name, compute, audio_path, progress):
        calls.append(device)
        if device == "cuda":
            raise transcribe.ModelDownloadError("couldn't download large-v3")
        return {"device": device, "language": "en", "duration": 1.0, "text": "hi",
                "words": []}

    uncache = _pretend_cached()   # both models on disk, so the attempts stay distinct
    transcribe._run = run
    transcribe.cuda_available = lambda: True
    settings.WHISPER_DEVICE = "auto"
    try:
        got = transcribe._transcribe_local(Path("x.wav"))
    finally:
        uncache()
        transcribe._run, settings.WHISPER_DEVICE = orig_run, orig_dev
        transcribe.cuda_available = orig_avail

    check("still falls through to the CPU model", calls == ["cuda", "cpu"], calls)
    check("and transcribes", got["device"] == "cpu", got)


def test_gpu_without_cublas_is_not_attempted():
    """The whole trigger of the stuck report: get_cuda_device_count() said 1 on a machine
    whose install ships no nvidia-* wheels, so `auto` downloaded 3.1 GB of large-v3 to
    discover cuBLAS was missing."""
    print("\n[transcribe] CUDA device present, cuBLAS absent")
    orig = transcribe.cublas_available
    transcribe.cublas_available = lambda: False
    try:
        got = transcribe.cuda_available()
    finally:
        transcribe.cublas_available = orig
    check("cuda_available() is False without cuBLAS", got is False, got)


def test_cublas_probe_never_raises():
    print("\n[transcribe] cublas_available() on any machine")
    ok = True
    try:
        transcribe.cublas_available()
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"    raised {e!r}")
    check("never raises, whatever is or isn't installed", ok)


def test_missing_engine_still_wins_over_the_download():
    print("\n[transcribe] no faster-whisper at all")
    saved = {k: sys.modules.get(k) for k in ("faster_whisper", "faster_whisper.utils")}
    sys.modules["faster_whisper"] = None          # import raises ImportError
    sys.modules["faster_whisper.utils"] = None
    try:
        try:
            transcribe.ensure_model_downloaded("small")
            err = None
        except Exception as e:  # noqa: BLE001
            err = e
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    check("a missing package is still TranscriptionUnavailable, not a download error",
          isinstance(err, transcribe.TranscriptionUnavailable), type(err).__name__)


# --- 3. ElevenLabs without a key falls through to local ------------------------------

def test_keyless_elevenlabs_falls_back_to_local():
    print("\n[transcribe] elevenlabs picked, no key")
    calls = []
    orig_run, orig_key = transcribe._run, settings.ELEVENLABS_API_KEY
    transcribe._run = _fake_run(calls)
    settings.ELEVENLABS_API_KEY = ""
    try:
        got = transcribe.transcribe(Path("x.wav"), backend="elevenlabs")
    finally:
        transcribe._run, settings.ELEVENLABS_API_KEY = orig_run, orig_key

    check("fell through to the local engine", got["device"] in ("cuda", "cpu"), got)
    check("local engine actually ran", bool(calls), calls)


def test_both_backends_out_reports_both():
    print("\n[transcribe] elevenlabs picked, no key, no local engine either")
    orig_get, orig_key = transcribe._get_model, settings.ELEVENLABS_API_KEY

    def boom(name, device, compute):
        raise transcribe.TranscriptionUnavailable(transcribe.NO_ENGINE_MSG)

    transcribe._get_model = boom
    settings.ELEVENLABS_API_KEY = ""
    try:
        try:
            transcribe.transcribe(Path("x.wav"), backend="elevenlabs")
            err = None
        except Exception as e:  # noqa: BLE001
            err = e
    finally:
        transcribe._get_model, settings.ELEVENLABS_API_KEY = orig_get, orig_key

    check("still TranscriptionUnavailable",
          isinstance(err, transcribe.TranscriptionUnavailable), type(err).__name__)
    check("mentions the local fix", "faster-whisper" in str(err), str(err))
    check("mentions the ElevenLabs attempt too", "ElevenLabs" in str(err), str(err))


def test_settings_demotes_keyless_elevenlabs_default():
    print("\n[settings] keyless elevenlabs default")
    check("a keyless elevenlabs default is demoted to local",
          not (settings._DEFAULT_TRANSCRIBE == "elevenlabs"
               and not settings.ELEVENLABS_API_KEY
               and settings.DEFAULT_TRANSCRIBE == "elevenlabs"),
          settings.DEFAULT_TRANSCRIBE)


# --- 4. The parent must report the worker's reason, not guess at the GPU -------------

def test_worker_failure_message():
    print("\n[jobs] exit-code -> user-facing message")
    reason = "no transcription engine is available. Re-run the installer"

    m = jobs.worker_failure_message(1, reason, ["Traceback (most recent call last):"])
    check("a reported reason wins outright", m == reason, m)
    check("a plain exit 1 never blames the GPU",
          "GPU" not in jobs.worker_failure_message(1, "", ["ImportError: no ctranslate2"]),
          jobs.worker_failure_message(1, "", ["ImportError: no ctranslate2"]))
    check("a reasonless exit 1 still carries the log tail",
          "ImportError: no ctranslate2" in jobs.worker_failure_message(
              1, "", ["ImportError: no ctranslate2"]))

    # Windows access violation (0xC0000005) and a POSIX signal death are real native crashes.
    win = jobs.worker_failure_message(0xC0000005, "", [])
    posix = jobs.worker_failure_message(-11, "", [])
    check("windows access violation reads as a GPU/native crash", "GPU" in win, win)
    check("segfault reads as a GPU/native crash", "GPU" in posix, posix)
    check("the native message offers the CPU escape hatch",
          "CVIDEO_WHISPER_DEVICE=cpu" in win, win)
    check("a real crash reason still wins over the GPU guess",
          jobs.worker_failure_message(0xC0000005, reason, []) == reason)


class _FakeProc:
    def __init__(self, lines, code):
        self.stdout = iter(lines)
        self._code = code

    def wait(self):
        return self._code


def test_subprocess_relays_the_worker_reason():
    print("\n[jobs] transcribe_subprocess relays the worker's reason")
    lines = [
        "PROGRESS 0 Transcribing on cpu\n",
        "Traceback (most recent call last):\n",
        ERROR_PREFIX + "no transcription engine is available. Re-run the installer\n",
    ]
    seen = []
    orig = subprocess.Popen
    subprocess.Popen = lambda *a, **k: _FakeProc(lines, 1)
    try:
        try:
            jobs.transcribe_subprocess(Path("a.wav"), Path("o.json"), "local",
                                       lambda p, m: seen.append((p, m)))
            err = None
        except Exception as e:  # noqa: BLE001
            err = e
    finally:
        subprocess.Popen = orig

    check("raises RuntimeError", isinstance(err, RuntimeError), type(err).__name__)
    check("surfaces the worker's real reason",
          "no transcription engine is available" in str(err), str(err))
    check("no longer invents a GPU fault", "GPU" not in str(err), str(err))
    check("still relayed progress", seen == [(0, "Transcribing on cpu")], seen)


def test_subprocess_success_still_works():
    print("\n[jobs] transcribe_subprocess happy path")
    import json
    import tempfile
    out = Path(tempfile.mkdtemp()) / "words.json"
    out.write_text(json.dumps({"device": "cpu", "words": []}), encoding="utf-8")
    orig = subprocess.Popen
    subprocess.Popen = lambda *a, **k: _FakeProc(["PROGRESS 50 Transcribing on cpu\n"], 0)
    try:
        got = jobs.transcribe_subprocess(Path("a.wav"), out, "local")
    finally:
        subprocess.Popen = orig
    check("returns the parsed result", got == {"device": "cpu", "words": []}, got)
    check("cleans up the temp json", not out.exists())


class _SilentProc:
    """A worker that accepts the job and then never says another word."""
    def __init__(self):
        self.killed = False
        self.stdout = self          # iterating blocks until killed

    def __iter__(self):
        return self

    def __next__(self):
        while not self.killed:
            time.sleep(0.01)
        raise StopIteration

    def kill(self):
        self.killed = True

    def wait(self):
        return -9


def test_a_silent_worker_is_cancelled_not_waited_on():
    """`for line in proc.stdout` has no upper bound: a worker wedged in a native call or
    on a socket that never times out left the job on "Transcribing" until the backend was
    killed. There must always be a way out."""
    print("\n[jobs] worker goes silent")
    proc = _SilentProc()
    orig_popen, orig_stall = subprocess.Popen, jobs.STALL_SECONDS
    subprocess.Popen = lambda *a, **k: proc
    jobs.STALL_SECONDS = 0.3
    started = time.monotonic()
    try:
        try:
            jobs.transcribe_subprocess(Path("a.wav"), Path("o.json"), "local")
            err = None
        except Exception as e:  # noqa: BLE001
            err = e
    finally:
        subprocess.Popen, jobs.STALL_SECONDS = orig_popen, orig_stall
    took = time.monotonic() - started

    check("gives up instead of blocking forever", took < 10, took)
    check("raises RuntimeError", isinstance(err, RuntimeError), type(err).__name__)
    check("kills the wedged worker", proc.killed)
    check("says it stopped responding", "stopped responding" in str(err), str(err))
    check("points at the Retry", "Retry" in str(err), str(err))
    check("does not misreport the kill as a GPU crash", "crashed inside" not in str(err),
          str(err))


def test_progress_resets_the_stall_clock():
    """A slow-but-honest job must never be cancelled. The download narrates megabytes and
    transcription narrates segments, so the timeout only fires on real silence."""
    print("\n[jobs] slow but talking")
    import json as _json
    import tempfile
    out = Path(tempfile.mkdtemp()) / "words.json"
    out.write_text(_json.dumps({"device": "cpu", "words": []}), encoding="utf-8")

    class _SlowProc:
        def __init__(self):
            self.stdout = self._gen()

        def _gen(self):
            for i in range(4):
                time.sleep(0.15)     # each gap is under the timeout, the total is not
                yield f"PROGRESS {i * 10} First run: downloading the small speech model\n"

        def wait(self):
            return 0

    seen = []
    orig_popen, orig_stall = subprocess.Popen, jobs.STALL_SECONDS
    subprocess.Popen = lambda *a, **k: _SlowProc()
    jobs.STALL_SECONDS = 0.4
    try:
        got = jobs.transcribe_subprocess(Path("a.wav"), out, "local",
                                         lambda p, m: seen.append(p))
    finally:
        subprocess.Popen, jobs.STALL_SECONDS = orig_popen, orig_stall

    check("a talkative job runs to completion", got == {"device": "cpu", "words": []}, got)
    check("every heartbeat was relayed", seen == [0, 10, 20, 30], seen)


def test_stall_timeout_is_generous_by_default():
    print("\n[jobs] stall timeout default")
    check("default leaves room for a slow CPU segment", jobs.STALL_SECONDS >= 600,
          jobs.STALL_SECONDS)
    check("the message says how long it waited",
          str(int(jobs.STALL_SECONDS / 60)) in jobs.stall_message(jobs.STALL_SECONDS),
          jobs.stall_message(jobs.STALL_SECONDS))


def test_job_error_text_is_readable():
    print("\n[jobs] project.error text")
    msg = "no transcription engine is available. Re-run the installer"
    check("our own RuntimeError shows bare",
          jobs._job_error_text(RuntimeError(msg)) == msg,
          jobs._job_error_text(RuntimeError(msg)))
    check("an unexpected type keeps its class name",
          jobs._job_error_text(ValueError("bad")) == "ValueError: bad",
          jobs._job_error_text(ValueError("bad")))
    check("a blank message still names the type",
          jobs._job_error_text(ValueError()) == "ValueError")
    check("newlines are flattened",
          "\n" not in jobs._job_error_text(RuntimeError("a\nb")))


# --- 5. The worker really does print ERROR and exit 1 (real subprocess) --------------

def test_worker_prints_error_and_exits_one():
    """The end-to-end shape of the reported bug: a laptop venv with no faster-whisper
    and no ElevenLabs key. Shimmed rather than mocked, so this reproduces it on a
    machine that *does* have faster-whisper installed — and never downloads a model."""
    print("\n[worker] real subprocess, no engine installed")
    import os
    import tempfile

    shim = Path(tempfile.mkdtemp())
    (shim / "faster_whisper.py").write_text(
        'raise ModuleNotFoundError("No module named \'faster_whisper\'")\n', encoding="utf-8")

    env = dict(os.environ)
    env["PYTHONPATH"] = str(shim) + os.pathsep + env.get("PYTHONPATH", "")
    env["ELEVENLABS_API_KEY"] = ""
    env["CVIDEO_WHISPER_DEVICE"] = "cpu"

    proc = subprocess.run(
        [sys.executable, "-m", "app.pipeline.transcribe_worker",
         str(shim / "no-such-audio.wav"), str(shim / "out.json"), "local"],
        cwd=str(Path(__file__).parent), capture_output=True, text=True, timeout=300, env=env,
    )
    err_lines = [l for l in proc.stdout.splitlines() if l.startswith(ERROR_PREFIX)]
    check("exits 1 (not a native crash code)", proc.returncode == 1, proc.returncode)
    check("prints exactly one ERROR line", len(err_lines) == 1, proc.stdout[-400:])
    check("the ERROR line carries the actionable reason",
          bool(err_lines) and "faster-whisper" in err_lines[0], err_lines)
    check("the traceback still reaches the log",
          "Traceback" in proc.stderr, proc.stderr[-400:])
    check("writes no half-baked result file", not (shim / "out.json").exists())
    # And the parent turns that into the message the user sees — with no GPU guesswork.
    if err_lines:
        msg = jobs.worker_failure_message(proc.returncode,
                                          err_lines[0][len(ERROR_PREFIX):].strip(), [])
        check("parent's message has no GPU guess", "GPU" not in msg, msg)
        check("parent's message is not 'exit 1'", "exit 1" not in msg, msg)


# --- 6. Keys stay out of the repo ----------------------------------------------------

# Every env var that holds a credential. The template must declare them EMPTY: it is the
# file that gets copied to backend/.env, and it is the one tracked file where a real key
# would silently ride into a public repo.
SECRET_KEYS = ["ELEVENLABS_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
               "GEMINI_API_KEY", "UPLOAD_POST_API_KEY", "CVIDEO_API_TOKEN",
               "PERF_SHEET_WEBHOOK_URL"]


def test_no_secrets_in_the_repo():
    print("\n[secrets] nothing credential-shaped is tracked")
    root = Path(__file__).resolve().parent.parent

    check("the real backend/.env is gitignored",
          subprocess.run(["git", "check-ignore", "-q", "backend/.env"],
                         cwd=root).returncode == 0)
    tracked = subprocess.run(["git", "ls-files"], cwd=root,
                             capture_output=True, text=True).stdout.split()
    check("backend/.env is not tracked", "backend/.env" not in tracked)

    example = (root / "backend/.env.example").read_text(encoding="utf-8")
    filled = []
    for line in example.splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() in SECRET_KEYS and value.strip():
            filled.append(name.strip())
    check("the .env template declares every secret but fills none in", not filled, filled)
    check("the template still lists the keys people need",
          all(f"{k}=" in example for k in ("ELEVENLABS_API_KEY", "OPENAI_API_KEY")))

    # Transcription must not be one of the things a key unlocks; the voiceover is.
    check("with no ElevenLabs key, the default backend is the keyless one",
          bool(settings.ELEVENLABS_API_KEY) or settings.DEFAULT_TRANSCRIBE == "local",
          settings.DEFAULT_TRANSCRIBE)
    from app.pipeline import tts
    check("AI voiceover — which genuinely needs the key — is gated on it, separately",
          tts.available() == bool(settings.ELEVENLABS_API_KEY))


if __name__ == "__main__":
    test_missing_engine_is_not_a_device_failure()
    test_cuda_failure_falls_back_to_cpu()
    test_no_gpu_never_loads_the_gpu_model()
    test_explicit_cuda_is_still_honoured()
    test_cuda_probe_is_safe_without_ctranslate2()
    test_device_cpu_skips_the_gpu_entirely()
    test_cpu_default_model_is_laptop_sized()
    test_no_default_downloads_a_huge_model()
    test_a_cached_big_model_is_still_used()
    test_an_explicit_choice_overrides_the_cap()
    test_the_small_defaults_are_never_substituted()
    test_the_auto_path_never_queues_the_gpu_giant()
    test_cached_model_downloads_nothing_and_says_nothing()
    test_first_run_download_reports_progress()
    test_download_message_and_size_hint()
    test_offline_download_failure_is_not_a_device_failure()
    test_a_dead_download_is_not_retried_on_every_device()
    test_a_different_cpu_model_still_gets_its_chance()
    test_gpu_without_cublas_is_not_attempted()
    test_cublas_probe_never_raises()
    test_missing_engine_still_wins_over_the_download()
    test_keyless_elevenlabs_falls_back_to_local()
    test_both_backends_out_reports_both()
    test_settings_demotes_keyless_elevenlabs_default()
    test_worker_failure_message()
    test_subprocess_relays_the_worker_reason()
    test_subprocess_success_still_works()
    test_a_silent_worker_is_cancelled_not_waited_on()
    test_progress_resets_the_stall_clock()
    test_stall_timeout_is_generous_by_default()
    test_job_error_text_is_readable()
    test_worker_prints_error_and_exits_one()
    test_no_secrets_in_the_repo()
    print("\n" +("ALL PASSED" if not FAILED else f"{len(FAILED)} FAILED: {FAILED}"))
    sys.exit(1 if FAILED else 0)
