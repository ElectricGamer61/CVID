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
"""
from __future__ import annotations

import subprocess
import sys
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

def test_cuda_failure_falls_back_to_cpu():
    print("\n[transcribe] GPU present but CUDA broken -> CPU")
    calls = []
    orig_run, orig_dev, orig_avail = (
        transcribe._run, settings.WHISPER_DEVICE, transcribe.cuda_available)
    transcribe._run = _fake_run(calls, fail_on=("cuda",))
    transcribe.cuda_available = lambda: True
    settings.WHISPER_DEVICE = "auto"
    try:
        got = transcribe._transcribe_local(Path("x.wav"))
    finally:
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
    transcribe._run = _fake_run(calls, fail_on=("cuda",))
    transcribe.cuda_available = lambda: False   # the probe must not veto an explicit pick
    settings.WHISPER_DEVICE = "cuda"
    try:
        got = transcribe._transcribe_local(Path("x.wav"))
    finally:
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
    test_keyless_elevenlabs_falls_back_to_local()
    test_both_backends_out_reports_both()
    test_settings_demotes_keyless_elevenlabs_default()
    test_worker_failure_message()
    test_subprocess_relays_the_worker_reason()
    test_subprocess_success_still_works()
    test_job_error_text_is_readable()
    test_worker_prints_error_and_exits_one()
    test_no_secrets_in_the_repo()
    print("\n" +("ALL PASSED" if not FAILED else f"{len(FAILED)} FAILED: {FAILED}"))
    sys.exit(1 if FAILED else 0)
