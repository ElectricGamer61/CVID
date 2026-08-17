"""Transcription via faster-whisper (CTranslate2). No PyTorch required.

Tries CUDA (float16) first for the RTX 5070; if CUDA can't be used (e.g. CTranslate2
lacking sm_120 kernels, or the cuBLAS/cuDNN DLLs failing to load), falls back to
CPU (int8) on the Ryzen automatically. The fallback wraps *inference*, not just model
load, because the cuBLAS DLL error surfaces during the first encode call.

Produces: {"device", "language", "duration", "text", "words": [{start,end,word}]}.
"""
from __future__ import annotations

import os
import site
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


NO_ENGINE_MSG = (
    "no transcription engine is available. Re-run the installer "
    "(scripts\\setup-laptop.ps1, or `pip install -r requirements-bare.txt` in the venv) "
    "to add faster-whisper for offline transcription, or put an ELEVENLABS_API_KEY in "
    "backend/.env to transcribe in the cloud.")


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


def cuda_available() -> bool:
    """Is there a GPU CTranslate2 can actually use? Cheap — no model touched.

    Worth asking before the attempt list is built: `auto` used to *discover* the answer by
    trying, which on a GPU-less laptop means downloading the 3 GB large-v3 model, failing,
    and then downloading the CPU model too. An explicit CVIDEO_WHISPER_DEVICE=cuda still
    tries regardless, so this can never veto a deliberate choice."""
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception as e:  # noqa: BLE001 - no ctranslate2, no driver, old API: all mean "no"
        print(f"[transcribe] no usable CUDA device ({e}); going straight to CPU")
        return False


def _run(device: str, model_name: str, compute: str, audio_path: Path,
         progress: Callable[[int, str], None] | None):
    """Build model + fully consume transcription on one device. Raises on failure."""
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
        attempts.append(("cuda", settings.WHISPER_MODEL, "float16"))
    # CPU is always last and always present, so a broken/absent CUDA runtime still ends
    # in a working transcription rather than a failed job. CVIDEO_WHISPER_DEVICE=cpu
    # skips the GPU attempt entirely.
    attempts.append(("cpu", settings.WHISPER_MODEL_CPU, "int8"))

    last_err = None
    for device, model_name, compute in attempts:
        try:
            return _run(device, model_name, compute, audio_path, progress)
        except TranscriptionUnavailable:
            raise  # nothing is installed — another device cannot help
        except Exception as e:  # noqa: BLE001 - fall through to CPU
            last_err = e
            print(f"[transcribe] {device}/{compute} failed: {e}")
            _model_cache.pop((model_name, device, compute), None)
            continue
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
    except TranscriptionUnavailable as e:
        # Both routes are out. Report both reasons — reporting only the local one sent
        # people hunting for a GPU that was never in play.
        if cloud_err is not None:
            raise TranscriptionUnavailable(
                f"{e} (ElevenLabs was tried first and failed: {cloud_err})") from e
        raise
