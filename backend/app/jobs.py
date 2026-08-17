"""Background job runner: ingest -> transcribe -> brain -> create Clip rows.

Single worker thread keeps GPU/CPU contention predictable. Progress is written
back onto the Project row so the UI can poll it.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

import settings
from .db import Clip, Project, get_session
from .pipeline import brain, ingest
from .pipeline.transcribe_worker import ERROR_PREFIX as _ERROR_PREFIX

_executor = ThreadPoolExecutor(max_workers=1)


# A worker that fails in Python exits 1 after printing its reason. A *native* crash never
# reaches Python, so it exits via a signal (negative on POSIX) or an NTSTATUS code on
# Windows (0xC0000005 access violation and friends). Only the latter is a GPU suspect —
# blaming CUDA for every non-zero exit is what sent a missing pip package to the user as
# "likely a GPU fault".
_NATIVE_EXIT_FLOOR = 0xC0000000


def worker_failure_message(code: int, reason: str, tail: list[str]) -> str:
    """User-facing text for a transcription worker that exited non-zero."""
    if reason:
        return reason
    if code < 0 or code >= _NATIVE_EXIT_FLOOR:
        return (f"transcription crashed inside the GPU runtime (exit {code}). Set "
                f"CVIDEO_WHISPER_DEVICE=cpu in backend/.env to skip the GPU entirely. "
                f"The backend stayed up.")
    detail = " / ".join(t for t in tail[-3:] if t)
    return (f"transcription failed (exit {code})" + (f": {detail}" if detail else "")
            + ". See data/backend.log for the full traceback. The backend stayed up.")


def transcribe_subprocess(audio: Path, out_json: Path, backend: str,
                          progress: Callable[[int, str], None] | None = None) -> dict:
    """Transcribe in a child process so a native GPU crash can't kill the API.

    Streams the worker's "PROGRESS <pct> <msg>" lines to `progress` and reads the
    result JSON back. A failure surfaces here as a non-zero exit code, which the caller
    turns into a job-level error instead of a dead backend — carrying the worker's own
    "ERROR <reason>" line through when it managed to print one."""
    cmd = [sys.executable, "-m", "app.pipeline.transcribe_worker",
           str(audio), str(out_json), backend]
    proc = subprocess.Popen(
        cmd, cwd=str(settings.BACKEND_DIR),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    assert proc.stdout is not None
    reason = ""
    tail: list[str] = []
    for line in proc.stdout:
        line = line.rstrip()
        if line.startswith("PROGRESS "):
            try:
                _, pct, msg = line.split(" ", 2)
                if progress:
                    progress(int(pct), msg)
            except ValueError:
                pass
        elif line:
            if line.startswith(_ERROR_PREFIX):
                reason = line[len(_ERROR_PREFIX):].strip()
            else:
                tail = (tail + [line])[-5:]
            print(f"[transcribe_worker] {line}")
    code = proc.wait()
    if code != 0:
        raise RuntimeError(worker_failure_message(code, reason, tail))
    result = json.loads(out_json.read_text(encoding="utf-8"))
    out_json.unlink(missing_ok=True)
    return result


def _job_error_text(e: BaseException) -> str:
    msg = " ".join(str(e).split())
    if isinstance(e, RuntimeError) and msg:
        return msg
    return f"{type(e).__name__}: {msg}" if msg else type(e).__name__


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

        # 2. Transcribe — in a subprocess so a native GPU/CUDA crash can't take the API down.
        _set(project_id, status="transcribing", stage="Transcribing", progress=20)

        def _tp(pct, msg):
            _set(project_id, stage=msg, progress=20 + int(pct * 0.5))

        result = transcribe_subprocess(
            audio, pdir / "words.tmp.json", tx_backend, _tp)
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

        # 6. Warm the full-video cache in the background so the FIRST export doesn't have to
        # wait on a full download (analysis only ever pulled audio + a 360p proxy). Runs on
        # its own thread so it never blocks the analyze worker or the API.
        if source_type == "url":
            import threading
            threading.Thread(target=_prefetch_full, args=(project_id, source_url),
                             daemon=True).start()
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        # RuntimeError here is always a message we wrote for the user (transcription,
        # ingest); the class name in front of it is noise. Keep it for everything else,
        # where the type is the only clue about what broke.
        _set(project_id, status="error", stage="Failed", error=_job_error_text(e))


def _prefetch_full(project_id: int, source_url: str) -> None:
    """Fetch + cache the full source video so the first render is instant. Best-effort:
    if it fails, `_render_clip_job` still downloads lazily on export."""
    source = settings.project_dir(project_id) / "source.mp4"
    if source.exists():
        return
    try:
        ingest.download_full(source_url, source)
    except Exception as e:  # noqa: BLE001 - non-fatal; export falls back to lazy fetch
        print(f"[prefetch] full-video prefetch failed for project {project_id}: {e}")


def submit_analyze(project_id: int, upload_path: str | None = None):
    _executor.submit(_analyze, project_id, upload_path)


def submit_shootdrop(batch_id: str):
    """Run a shoot-drop batch on the same single worker — transcription is the
    heavy step and shares the GPU with project analyzes."""
    from .pipeline import shootdrop
    _executor.submit(shootdrop.run_batch, batch_id)


def start_shootdrop_watcher():
    """Watch SHOOT_DROP_DIR (backend/.env) for raw phone clips. No-op when unset.
    Polling (no watchdog dep): a file is picked up only once its size is stable
    across two polls, so half-copied phone transfers are never ingested."""
    if not settings.SHOOT_DROP_DIR:
        return
    import threading
    threading.Thread(target=_shootdrop_watch_loop, daemon=True).start()


def _shootdrop_watch_loop():
    from .pipeline import shootdrop
    drop = Path(settings.SHOOT_DROP_DIR)
    try:
        drop.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        print(f"[shootdrop] cannot create watch dir {drop}: {e}")
        return
    print(f"[shootdrop] watching {drop}")
    sizes: dict[str, int] = {}
    while True:
        try:
            stable: list[Path] = []
            for f in sorted(drop.iterdir()):
                if not f.is_file() or f.suffix.lower() not in shootdrop.VIDEO_EXTS:
                    continue
                sz = f.stat().st_size
                if sizes.get(f.name) == sz and sz > 0:
                    stable.append(f)
                sizes[f.name] = sz
            if stable:
                batch_id = shootdrop.new_batch(stable, move=True)
                for f in stable:
                    sizes.pop(f.name, None)
                print(f"[shootdrop] picked up {len(stable)} file(s) -> batch {batch_id}")
                _executor.submit(shootdrop.run_batch, batch_id)
        except Exception as e:  # noqa: BLE001 — the watcher must never die
            print(f"[shootdrop] watch loop error: {e}")
        time.sleep(10)


def get_words(project_id: int) -> list[dict]:
    f = settings.project_dir(project_id) / "words.json"
    if not f.exists():
        return []
    return json.loads(f.read_text(encoding="utf-8")).get("words", [])
