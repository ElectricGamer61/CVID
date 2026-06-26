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


def _get_model(device: str, compute: str):
    from faster_whisper import WhisperModel

    key = (settings.WHISPER_MODEL, device, compute)
    if key not in _model_cache:
        _model_cache[key] = WhisperModel(
            settings.WHISPER_MODEL, device=device, compute_type=compute
        )
    return _model_cache[key]


def _run(device: str, compute: str, audio_path: Path,
         progress: Callable[[int, str], None] | None):
    """Build model + fully consume transcription on one device. Raises on failure."""
    model = _get_model(device, compute)
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
    if settings.WHISPER_DEVICE in ("auto", "cuda"):
        attempts.append(("cuda", "float16"))
    attempts.append(("cpu", "int8"))

    last_err = None
    for device, compute in attempts:
        try:
            return _run(device, compute, audio_path, progress)
        except Exception as e:  # noqa: BLE001 - fall through to CPU
            last_err = e
            print(f"[transcribe] {device}/{compute} failed: {e}")
            _model_cache.pop((settings.WHISPER_MODEL, device, compute), None)
            continue
    raise RuntimeError(f"Transcription failed on all devices: {last_err}")


def _transcribe_elevenlabs(audio_path: Path, progress: Callable[[int, str], None] | None = None):
    """Transcribe via ElevenLabs Scribe (word-level timestamps). Needs ELEVENLABS_API_KEY."""
    import requests

    if not settings.ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
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
    if backend == "elevenlabs":
        try:
            return _transcribe_elevenlabs(audio_path, progress)
        except Exception as e:  # noqa: BLE001
            print(f"[transcribe] elevenlabs failed: {e}; falling back to local")
    return _transcribe_local(audio_path, progress)
