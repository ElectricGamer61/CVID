"""ElevenLabs text-to-speech — read a clip's transcript into a voiceover.

Mirrors transcribe.py's raw-HTTP + `xi-api-key` pattern (no SDK). The generated MP3 is
converted to the same 48 kHz stereo WAV as a recorded voiceover (ingest.extract_voiceover),
so it drops straight into the existing voiceover slot and render mux.
"""
from __future__ import annotations

from pathlib import Path

import requests

import settings

_BASE = "https://api.elevenlabs.io/v1"


def available() -> bool:
    return bool(settings.ELEVENLABS_API_KEY)


def list_voices() -> list[dict]:
    """The account's voices [{voice_id, name}] — for the editor's voice picker. Empty on error."""
    if not settings.ELEVENLABS_API_KEY:
        return []
    try:
        r = requests.get(f"{_BASE}/voices",
                         headers={"xi-api-key": settings.ELEVENLABS_API_KEY}, timeout=30)
        r.raise_for_status()
        return [{"voice_id": v["voice_id"], "name": v.get("name", "")}
                for v in r.json().get("voices", [])]
    except Exception as e:  # noqa: BLE001
        print(f"[tts] list_voices failed: {e}")
        return []


def synthesize(text: str, out_mp3: Path, voice_id: str | None = None,
               model: str | None = None) -> Path:
    """Generate speech for `text` into `out_mp3`. Raises on missing key / empty text / API error."""
    if not settings.ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
    text = (text or "").strip()
    if not text:
        raise RuntimeError("no text to read")
    voice_id = voice_id or settings.ELEVENLABS_VOICE_ID
    r = requests.post(
        f"{_BASE}/text-to-speech/{voice_id}",
        headers={"xi-api-key": settings.ELEVENLABS_API_KEY,
                 "accept": "audio/mpeg", "content-type": "application/json"},
        json={"text": text, "model_id": model or settings.ELEVENLABS_TTS_MODEL,
              "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
        timeout=180,
    )
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs TTS {r.status_code}: {r.text[:200]}")
    out_mp3.write_bytes(r.content)
    return out_mp3
