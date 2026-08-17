"""Transcription via faster-whisper (CTranslate2). No PyTorch required.

Tries CUDA (float16) first for the RTX 5070; if CUDA can't be used (e.g. CTranslate2
lacking sm_120 kernels, or the cuBLAS/cuDNN DLLs failing to load), falls back to
CPU (int8) on the Ryzen automatically. The fallback wraps *inference*, not just model
load, because the cuBLAS DLL error surfaces during the first encode call.

Produces: {"device", "language", "duration", "text", "words": [{start,end,word}]}.
"""
from __future__ import annotations

import ctypes
import os
import site
import threading
from pathlib import Path
from typing import Callable

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def _register_cuda_dlls() -> None:
    """On Windows the pip nvidia-* packages drop their DLLs in
    site-packages/nvidia/<lib>/bin, which is NOT on the DLL search path.
    Register those dirs so CTranslate2 can load cublas64_12.dll / cudnn*.dll."""
    if os.name != "nt":
        return
    bases = list(site.getsitepackages())
    if hasattr(site, "getusersitepackages"):
        bases.append(site.getusersitepackages())
    for base in bases:
        nvidia = Path(base) / "nvidia"
        if not nvidia.is_dir():
            continue
        for binsub in nvidia.glob("*/bin"):
            try:
                os.add_dll_directory(str(binsub))
                os.environ["PATH"] = str(binsub) + os.pathsep + os.environ.get("PATH", "")
            except (OSError, FileNotFoundError):
                pass


_register_cuda_dlls()

import settings  # noqa: E402

_model_cache: dict = {}


class TranscriptionUnavailable(RuntimeError):
    """No transcription engine can run *at all* — nothing is installed and no key is set.

    Deliberately distinct from a device failure: retrying on another device, or blaming
    the GPU, is wrong and only hides the one thing the user has to fix.
    """


class ModelDownloadError(RuntimeError):
    """The speech model isn't on disk and couldn't be fetched.

    Like TranscriptionUnavailable this is not a device fault — the same download fails
    identically on the GPU and the CPU, so retrying per device only doubles the wait and
    then reports "failed on all devices" for what is really a dead network.
    """


NO_ENGINE_MSG = (
    "no transcription engine is available. Re-run the installer "
    "(scripts\\setup-laptop.ps1, or `pip install -r requirements-bare.txt` in the venv) "
    "to add faster-whisper for offline transcription, or put an ELEVENLABS_API_KEY in "
    "backend/.env to transcribe in the cloud.")

# Approximate on-disk size of each stock faster-whisper model, so the first-run download
# can quote a size and a percentage instead of sitting silent. Only used for messaging —
# an unknown name (a custom HF repo id) just reports megabytes as they land.
MODEL_MB = {
    "tiny": 75, "tiny.en": 75, "base": 145, "base.en": 145,
    "small": 484, "small.en": 484, "medium": 1530, "medium.en": 1530,
    "large": 3090, "large-v1": 3090, "large-v2": 3090, "large-v3": 3090,
    "large-v3-turbo": 1620, "turbo": 1620,
    "distil-small.en": 340, "distil-medium.en": 790,
    "distil-large-v2": 1510, "distil-large-v3": 1510, "distil-large-v3.5": 1510,
}


def model_size_hint(name: str) -> str:
    """"~484 MB" / "~3.0 GB" / "" — what to warn the user they're about to wait for."""
    mb = MODEL_MB.get(name)
    if not mb:
        return ""
    return f"~{mb / 1024:.1f} GB" if mb >= 1024 else f"~{mb} MB"


def _cache_bytes(model_name: str) -> int:
    """Bytes already on disk for this model, partial downloads included.

    Read straight off the HuggingFace cache rather than from a download callback: it works
    the same across huggingface_hub versions, and it counts a resumed `.incomplete` blob,
    which is exactly what a user who lost their connection wants to see.

    Only `blobs/` is counted. It holds the one real copy of every file (partials included);
    `snapshots/` is the same bytes again as symlinks, or as literal copies on a Windows box
    without developer mode — counting both reported "295 of ~145 MB".
    """
    try:
        from faster_whisper import utils as fw_utils
        from huggingface_hub.constants import HF_HUB_CACHE
        repo = getattr(fw_utils, "_MODELS", {}).get(model_name, model_name)
        blobs = Path(HF_HUB_CACHE) / ("models--" + repo.replace("/", "--")) / "blobs"
        return sum(f.stat().st_size for f in blobs.glob("*") if f.is_file())
    except Exception:  # noqa: BLE001 - progress reporting must never break the download
        return 0


def _download_message(model_name: str, done_mb: int) -> str:
    """The stage text a user stares at during the first-run download."""
    total = MODEL_MB.get(model_name)
    # Overshooting the quoted total ("295 of ~145 MB") reads as broken, and the sizes here
    # are approximations of someone else's repo. Drop the total rather than print a lie.
    if total and done_mb <= total:
        return (f"First run: downloading the {model_name} speech model "
                f"({done_mb} of ~{total} MB). This happens once.")
    return (f"First run: downloading the {model_name} speech model "
            f"({done_mb} MB so far). This happens once.")


def _download_percent(model_name: str, done_mb: int) -> int:
    total = MODEL_MB.get(model_name)
    if not total:
        return 0
    # Capped below 99 so the bar never claims to be finished before transcription starts.
    return max(0, min(95, int(done_mb / total * 95)))


# Substitution order when a default asks for more download than the cap allows: the
# biggest stock model that still fits. All three transcribe fine on a laptop CPU.
_FALLBACK_ORDER = ("small", "base", "tiny")


def model_is_cached(model_name: str) -> bool:
    """Are this model's weights already on disk? No network, no download."""
    try:
        from faster_whisper.utils import download_model
        download_model(model_name, local_files_only=True)
        return True
    except Exception:  # noqa: BLE001 - not cached, or no faster-whisper at all
        return False


def pick_model(model_name: str, pinned: bool = False) -> str:
    """The model to actually load — never a multi-GB download nobody asked for.

    Cvideo is local-first, so a *default* must not commit the user to fetching 3.1 GB
    before their first clip is captioned. Three escape hatches keep this from being a
    quality ceiling: weights already on disk are used at any size, anything within
    WHISPER_MAX_AUTO_DOWNLOAD_MB is fetched normally, and an explicit
    CVIDEO_WHISPER_MODEL / CVIDEO_WHISPER_MODEL_CPU overrides the cap outright.
    """
    cap = settings.WHISPER_MAX_AUTO_DOWNLOAD_MB
    size = MODEL_MB.get(model_name)
    # Unknown size means a custom HF repo id, which can only have come from an env var.
    if pinned or size is None or size <= cap or model_is_cached(model_name):
        return model_name
    alt = next((m for m in _FALLBACK_ORDER if MODEL_MB[m] <= cap), _FALLBACK_ORDER[-1])
    print(f"[transcribe] {model_name} is not downloaded and would need "
          f"{model_size_hint(model_name)}; using {alt} instead. Set "
          f"CVIDEO_WHISPER_MODEL={model_name} (or raise "
          f"CVIDEO_WHISPER_MAX_DOWNLOAD_MB) if you want it.")
    return alt


def _is_offline_error(e: BaseException) -> bool:
    text = f"{type(e).__name__} {e}".lower()
    return any(t in text for t in (
        "connect", "connection", "timeout", "timed out", "network", "dns", "resolve",
        "offline", "10054", "10060", "ssl", "proxy", "temporary failure", "unreachable",
        "internet"))


def ensure_model_downloaded(model_name: str,
                            progress: Callable[[int, str], None] | None = None) -> None:
    """Make sure the model is on disk BEFORE WhisperModel() is constructed.

    This is the fix for the "stuck at Transcribing 20%" report. WhisperModel() downloads
    the weights on first use, so the very first upload on a fresh install spends minutes
    (3.1 GB for large-v3) inside a constructor that emits nothing the UI can poll — no
    line on stdout, no progress row, no timeout. The job looked wedged, and when the
    connection finally dropped the reason surfaced as a raw WinError blob.

    Downloading it here instead means the wait is *narrated*: a first-run message, live
    megabytes, and a failure that names the network rather than the GPU.
    """
    try:
        from faster_whisper.utils import download_model
    except ImportError:
        raise TranscriptionUnavailable(NO_ENGINE_MSG) from None

    try:                       # already cached -> return silently, this is the normal path
        download_model(model_name, local_files_only=True)
        return
    except Exception:  # noqa: BLE001 - not cached (or unreadable cache); fetch it below
        pass

    size = model_size_hint(model_name)
    print(f"[transcribe] downloading model {model_name} ({size or 'size unknown'})")
    if progress:
        progress(0, _download_message(model_name, _cache_bytes(model_name) // 1_000_000))

    box: dict = {}

    def _fetch():
        try:
            download_model(model_name)
        except BaseException as e:  # noqa: BLE001 - relayed to the caller below
            box["err"] = e

    t = threading.Thread(target=_fetch, daemon=True)
    t.start()
    while t.is_alive():
        t.join(timeout=3)
        if progress:
            mb = _cache_bytes(model_name) // 1_000_000
            progress(_download_percent(model_name, mb), _download_message(model_name, mb))

    err = box.get("err")
    if err is None:
        return
    if _is_offline_error(err):
        raise ModelDownloadError(
            f"couldn't download the {model_name} speech model{f' ({size})' if size else ''} "
            "- no usable connection to huggingface.co. Connect to the internet and press "
            "Retry; the download picks up where it left off. To transcribe in the cloud "
            "instead, put an ELEVENLABS_API_KEY in backend/.env.") from err
    raise ModelDownloadError(
        f"couldn't download the {model_name} speech model: "
        f"{' '.join(str(err).split())[:300]}") from err


def _get_model(name: str, device: str, compute: str):
    try:
        from faster_whisper import WhisperModel
    except ModuleNotFoundError:
        # faster-whisper missing is a *config* problem, not a device one — say so with a
        # dedicated type so the caller doesn't loop over devices pretending it might help.
        raise TranscriptionUnavailable(NO_ENGINE_MSG) from None

    key = (name, device, compute)
    if key not in _model_cache:
        _model_cache[key] = WhisperModel(name, device=device, compute_type=compute)
    return _model_cache[key]


def cublas_available() -> bool:
    """Can CTranslate2 actually load cuBLAS? A GPU without it can never transcribe.

    A *device* and a *runtime* are two different things, and only checking the first is
    what made the bare-bones install download 3.1 GB of large-v3 to learn it had no
    cuBLAS. requirements-bare.txt deliberately ships no nvidia-* wheels, so on a laptop
    with an NVIDIA card `get_cuda_device_count()` still returns 1 while
    `cublas64_12.dll` / `libcublas.so.12` is nowhere on the machine. Asking ctypes costs
    microseconds and turns that guaranteed-to-fail attempt into a skipped one."""
    names = (("cublas64_12.dll", "cublas64_11.dll") if os.name == "nt"
             else ("libcublas.so.12", "libcublas.so.11", "libcublas.so"))
    loader = ctypes.WinDLL if os.name == "nt" else ctypes.CDLL  # type: ignore[attr-defined]
    for name in names:
        try:
            loader(name)
            return True
        except OSError:
            continue
    return False


def cuda_available() -> bool:
    """Is there a GPU CTranslate2 can actually use? Cheap — no model touched.

    Worth asking before the attempt list is built: `auto` used to *discover* the answer by
    trying, which on a GPU-less laptop means downloading the 3 GB large-v3 model, failing,
    and then downloading the CPU model too. An explicit CVIDEO_WHISPER_DEVICE=cuda still
    tries regardless, so this can never veto a deliberate choice."""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() <= 0:
            print("[transcribe] no CUDA device; going straight to CPU")
            return False
    except Exception as e:  # noqa: BLE001 - no ctranslate2, no driver, old API: all mean "no"
        print(f"[transcribe] no usable CUDA device ({e}); going straight to CPU")
        return False
    if not cublas_available():
        print("[transcribe] CUDA device present but cuBLAS is not installed; using CPU")
        return False
    return True


def _run(device: str, model_name: str, compute: str, audio_path: Path,
         progress: Callable[[int, str], None] | None):
    """Build model + fully consume transcription on one device. Raises on failure."""
    ensure_model_downloaded(model_name, progress)
    model = _get_model(model_name, device, compute)
    if progress:
        progress(0, f"Transcribing on {device}")
    segments, info = model.transcribe(
        str(audio_path), word_timestamps=True, vad_filter=True, beam_size=5,
    )
    total = info.duration or 0.0
    words: list[dict] = []
    text_parts: list[str] = []
    for seg in segments:  # generator -> errors surface here
        text_parts.append(seg.text)
        for w in (seg.words or []):
            words.append({"start": round(w.start, 3), "end": round(w.end, 3),
                          "word": w.word})
        if progress and total:
            progress(min(99, int(seg.end / total * 100)), f"Transcribing on {device}")
    return {
        "device": device,
        "language": info.language,
        "duration": total,
        "text": "".join(text_parts).strip(),
        "words": words,
    }


def _transcribe_local(audio_path: Path, progress: Callable[[int, str], None] | None = None):
    attempts = []
    if settings.WHISPER_DEVICE == "cuda" or (
            settings.WHISPER_DEVICE == "auto" and cuda_available()):
        attempts.append(("cuda", pick_model(settings.WHISPER_MODEL,
                                            settings.WHISPER_MODEL_PINNED), "float16"))
    # CPU is always last and always present, so a broken/absent CUDA runtime still ends
    # in a working transcription rather than a failed job. CVIDEO_WHISPER_DEVICE=cpu
    # skips the GPU attempt entirely.
    attempts.append(("cpu", pick_model(settings.WHISPER_MODEL_CPU,
                                       settings.WHISPER_MODEL_CPU_PINNED), "int8"))

    last_err = None
    for i, (device, model_name, compute) in enumerate(attempts):
        try:
            return _run(device, model_name, compute, audio_path, progress)
        except TranscriptionUnavailable:
            raise  # nothing is installed — another device cannot help
        except ModelDownloadError as e:
            # The weights aren't on disk and the network is out. The CPU attempt would
            # queue a *second* download over the same dead link and then report the whole
            # thing as "failed on all devices" — a network problem dressed as a hardware
            # one. Only keep going if the next attempt uses a different (maybe cached)
            # model; otherwise surface the download failure as itself.
            last_err = e
            print(f"[transcribe] {device}/{compute}: {e}")
            if any(m != model_name for _, m, _ in attempts[i + 1:]):
                continue
            raise
        except Exception as e:  # noqa: BLE001 - fall through to CPU
            last_err = e
            print(f"[transcribe] {device}/{compute} failed: {e}")
            _model_cache.pop((model_name, device, compute), None)
            continue
    if isinstance(last_err, ModelDownloadError):
        raise last_err
    raise RuntimeError(f"Transcription failed on all devices: {last_err}")


def _transcribe_elevenlabs(audio_path: Path, progress: Callable[[int, str], None] | None = None):
    """Transcribe via ElevenLabs Scribe (word-level timestamps). Needs ELEVENLABS_API_KEY."""
    import requests

    if not settings.ELEVENLABS_API_KEY:
        raise TranscriptionUnavailable("ELEVENLABS_API_KEY not set")
    if progress:
        progress(0, "Transcribing on ElevenLabs")
    with open(audio_path, "rb") as f:
        resp = requests.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": settings.ELEVENLABS_API_KEY},
            data={"model_id": settings.ELEVENLABS_MODEL},
            files={"file": (audio_path.name, f, "audio/wav")},
            timeout=600,
        )
    resp.raise_for_status()
    data = resp.json()
    words = [
        {"start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3),
         "word": w.get("text", "")}
        for w in data.get("words", [])
        if w.get("type") == "word" and w.get("start") is not None
    ]
    if progress:
        progress(99, "Transcribing on ElevenLabs")
    return {
        "device": "elevenlabs",
        "language": data.get("language_code", "en"),
        "duration": words[-1]["end"] if words else 0.0,
        "text": data.get("text", "").strip(),
        "words": words,
    }


def transcribe(audio_path: Path, backend: str = "local",
               progress: Callable[[int, str], None] | None = None):
    """Dispatch to the chosen transcription backend; ElevenLabs falls back to local."""
    cloud_err = None
    if backend == "elevenlabs":
        try:
            return _transcribe_elevenlabs(audio_path, progress)
        except Exception as e:  # noqa: BLE001
            cloud_err = e
            print(f"[transcribe] elevenlabs failed: {e}; falling back to local")
    try:
        return _transcribe_local(audio_path, progress)
    except (TranscriptionUnavailable, ModelDownloadError) as e:
        # Both routes are out. Report both reasons — reporting only the local one sent
        # people hunting for a GPU that was never in play.
        if cloud_err is not None:
            raise type(e)(
                f"{e} (ElevenLabs was tried first and failed: {cloud_err})") from e
        raise
