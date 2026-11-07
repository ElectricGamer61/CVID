"""Speech worker for the engines that run on Cvideo's own Python: Parakeet, Scribe, Whisper.

Usage:  python -m app.studio.transcribe_worker <job.json>   (cwd = backend/)
Protocol: app/studio/worker_protocol.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

from app.studio import worker_protocol as wp


def _load(job):
    engine = job["engine"]
    if engine == "parakeet":
        import onnx_asr
        wp.say("PROGRESS", 0, 0, "Loading Parakeet (first run downloads about 670 MB)")
        # int8 keeps the first download under Cvideo's 700 MB no-surprise cap and runs
        # fast on an ordinary laptop CPU.
        base = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", quantization="int8")
        return {"timed": base.with_timestamps(),
                # with_vad() drops token timestamps, so the VAD only finds speech spans and
                # each span is then decoded on its own, with timestamps.
                "spans": base.with_vad(onnx_asr.load_vad("silero"))}
    return None


def _parakeet(ctx, audio, progress):
    from app.studio.media import read_wav
    samples, sr = read_wav(Path(audio))
    total = len(samples) / sr or 1
    words: list[dict] = []
    for span in ctx["spans"].recognize(audio):
        a, b = max(0, int((span.start - 0.1) * sr)), int((span.end + 0.1) * sr)
        seg = ctx["timed"].recognize(samples[a:b], sample_rate=sr)
        off = a / sr
        cur = None
        # Tokens are sentencepiece pieces; one with a leading space starts a new word. The
        # model only stamps where each piece starts, so a word ends where its last piece
        # starts plus a typical piece length, never past the speech span.
        for tok, ts in zip(seg.tokens, seg.timestamps):
            t = off + ts
            if cur is None or tok.startswith(" "):
                if cur:
                    words.append(cur)
                cur = {"start": t, "end": t + 0.08, "word": tok.strip()}
            else:
                cur["word"] += tok
                cur["end"] = t + 0.08
        if cur:
            cur["end"] = min(span.end, max(cur["end"], cur["start"] + 0.12))
            words.append(cur)
        progress(min(99, span.end / total * 100))
    return [w for w in words if w["word"]]


def _scribe(audio, job):
    import requests

    import settings
    if not settings.ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    with open(audio, "rb") as f:
        r = requests.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": settings.ELEVENLABS_API_KEY},
            data={"model_id": settings.ELEVENLABS_MODEL, "language_code": job.get("language") or ""},
            files={"file": (Path(audio).name, f, "audio/wav")}, timeout=1800)
    r.raise_for_status()
    return [{"start": w["start"], "end": w["end"], "word": w.get("text", ""), "type": w["type"]}
            for w in r.json().get("words", [])
            if w.get("type") in ("word", "audio_event") and w.get("start") is not None]


def _whisper(audio, progress):
    from app.pipeline import transcribe
    res = transcribe.transcribe(Path(audio), backend="local",
                                progress=lambda pct, msg: progress(pct, msg))
    return res["words"]


def _transcribe(ctx, audio, job, progress):
    engine = job["engine"]
    if engine == "parakeet":
        return _parakeet(ctx, audio, progress)
    if engine == "scribe":
        return _scribe(audio, job)
    if engine == "whisper":
        return _whisper(audio, progress)
    raise RuntimeError(f"unknown engine {engine}")


if __name__ == "__main__":
    sys.exit(wp.run(_transcribe, _load))
