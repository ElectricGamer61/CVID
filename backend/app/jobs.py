"""Background job runner: ingest -> transcribe -> brain -> create Clip rows.

Single worker thread keeps GPU/CPU contention predictable. Progress is written
back onto the Project row so the UI can poll it.
"""
from __future__ import annotations

import json
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import settings
from .db import Clip, Project, get_session
from .pipeline import brain, ingest, transcribe

_executor = ThreadPoolExecutor(max_workers=1)


def _set(project_id: int, **fields):
    with get_session() as s:
        proj = s.get(Project, project_id)
        if not proj:
            return
        for k, v in fields.items():
            setattr(proj, k, v)
        s.add(proj)
        s.commit()


def _analyze(project_id: int, upload_path: str | None):
    pdir = settings.project_dir(project_id)
    source = pdir / "source.mp4"
    audio = pdir / "audio.wav"
    try:
        with get_session() as s:
            proj = s.get(Project, project_id)
            source_type, source_url, chosen_brain, tx_backend, mode = (
                proj.source_type, proj.source_url, proj.brain,
                proj.transcribe_backend, proj.mode
            )

        # 1. Ingest — efficient: audio only for analysis; full video never pulled up front
        if source_type == "url":
            _set(project_id, status="ingesting", stage="Downloading audio", progress=5)
            _, duration = ingest.download_audio(source_url, audio)
            _set(project_id, duration=duration)
        else:
            _set(project_id, status="ingesting", stage="Reading upload", progress=5)
            ingest.save_upload(Path(upload_path), source)
            _set(project_id, stage="Extracting audio", progress=15)
            ingest.extract_audio(source, audio)
            _set(project_id, duration=ingest.probe_duration(source))

        # 2. Transcribe
        _set(project_id, status="transcribing", stage="Transcribing", progress=20)

        def _tp(pct, msg):
            _set(project_id, stage=msg, progress=20 + int(pct * 0.5))

        result = transcribe.transcribe(audio, backend=tx_backend, progress=_tp)
        (pdir / "words.json").write_text(
            json.dumps(result, ensure_ascii=False), encoding="utf-8"
        )

        # 3. Brain — skipped in "caption" mode (one full-length clip instead)
        if mode == "caption":
            with get_session() as s:
                proj = s.get(Project, project_id)
                s.add(Clip(
                    project_id=project_id, idx=0,
                    start=0.0, end=proj.duration, title=proj.name,
                    score=0.0, reason="Whole clip (caption mode)",
                    aspect=proj.aspect, caption_preset=proj.caption_preset,
                ))
                s.commit()
            moments = [None]  # for the final status count
        else:
            _set(project_id, status="analyzing",
                 stage=f"Finding moments ({chosen_brain})", progress=75)
            moments = brain.find_moments(result["words"], chosen_brain)

            # 4. Persist clips
            with get_session() as s:
                proj = s.get(Project, project_id)
                for i, m in enumerate(moments):
                    s.add(Clip(
                        project_id=project_id, idx=i,
                        start=m["start"], end=m["end"], title=m["title"],
                        score=m["score"], hook=m.get("hook", ""), reason=m["reason"],
                        aspect=proj.aspect, caption_preset=proj.caption_preset,
                    ))
                s.commit()

        # 5. For URL projects, fetch a small 360p proxy for the editor preview.
        # Retry once — YouTube occasionally throttles transiently.
        if source_type == "url":
            _set(project_id, stage="Preparing preview", progress=92)
            for attempt in range(2):
                try:
                    ingest.download_proxy(source_url, pdir / "proxy.mp4")
                    break
                except Exception as pe:  # noqa: BLE001 - preview is non-fatal
                    print(f"[proxy] attempt {attempt + 1} failed: {pe}")
                    time.sleep(3)

        ready_stage = "Ready to caption" if mode == "caption" else f"Found {len(moments)} clips"
        _set(project_id, status="ready", stage=ready_stage, progress=100)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        _set(project_id, status="error", stage="Failed",
             error=f"{type(e).__name__}: {e}")


def submit_analyze(project_id: int, upload_path: str | None = None):
    _executor.submit(_analyze, project_id, upload_path)


def get_words(project_id: int) -> list[dict]:
    f = settings.project_dir(project_id) / "words.json"
    if not f.exists():
        return []
    return json.loads(f.read_text(encoding="utf-8")).get("words", [])
