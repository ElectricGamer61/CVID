"""Background job runner: ingest -> transcribe -> brain -> create Clip rows.

Single worker thread keeps GPU/CPU contention predictable. Progress is written
back onto the Project row so the UI can poll it.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
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

# How long the worker may say nothing at all before we call it wedged. It narrates both of
# its slow phases now — megabytes while the model downloads, segments while it transcribes
# — so real silence means a hung native call or a socket that will never time out, not
# honest work. Generous by default (one CPU segment on a big model is minutes), and
# tunable for anyone running a huge model on a slow machine.
STALL_SECONDS = float(os.getenv("CVIDEO_TRANSCRIBE_STALL_SEC", "900"))


def stall_message(seconds: float) -> str:
    return (f"transcription stopped responding - no progress for {int(seconds / 60)} "
            f"minutes, so it was cancelled rather than left running forever. Press Retry; "
            f"if it keeps happening, set CVIDEO_WHISPER_DEVICE=cpu in backend/.env. "
            f"See data/backend.log for the last output.")


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
                          progress: Callable[[int, str], None] | None = None,
                          force_cpu: bool = False) -> dict:
    """Transcribe in a child process so a native GPU crash can't kill the API.

    Streams the worker's "PROGRESS <pct> <msg>" lines to `progress` and reads the
    result JSON back. A failure surfaces here as a non-zero exit code, which the caller
    turns into a job-level error instead of a dead backend — carrying the worker's own
    "ERROR <reason>" line through when it managed to print one.

    Reads through a queue rather than `for line in proc.stdout` so a worker that stops
    talking altogether is *noticed*. Blocking straight on the pipe has no upper bound: the
    job sat on "Transcribing" forever and the only way out was killing the backend."""
    cmd = [sys.executable, "-m", "app.pipeline.transcribe_worker",
           str(audio), str(out_json), backend]
    child_env = None
    if force_cpu:
        child_env = dict(os.environ)
        child_env["CVIDEO_WHISPER_DEVICE"] = "cpu"
    proc = subprocess.Popen(
        cmd, cwd=str(settings.BACKEND_DIR), env=child_env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    assert proc.stdout is not None
    lines: queue.Queue = queue.Queue()

    def _pump(stream):
        try:
            for raw in stream:
                lines.put(raw)
        finally:
            lines.put(None)

    threading.Thread(target=_pump, args=(proc.stdout,), daemon=True).start()

    reason = ""
    tail: list[str] = []
    stalled = False
    while True:
        try:
            raw = lines.get(timeout=STALL_SECONDS)
        except queue.Empty:
            stalled = True
            proc.kill()
            break
        if raw is None:
            break
        line = raw.rstrip()
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
    if stalled:
        raise RuntimeError(stall_message(STALL_SECONDS))
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
    current_stage = "Starting"
    try:
        with get_session() as s:
            proj = s.get(Project, project_id)
            source_type, source_url, chosen_brain, tx_backend, mode = (
                proj.source_type, proj.source_url, proj.brain,
                proj.transcribe_backend, proj.mode
            )

        # 1. Ingest — efficient: audio only for analysis; full video never pulled up front
        if source_type == "url":
            current_stage = "URL ingest"
            _set(project_id, status="ingesting", stage="Downloading audio", progress=5)
            try:
                _, duration = ingest.download_audio(source_url, audio)
            except Exception as first:
                # Some supported URLs expose a video format more reliably than their
                # audio-only stream. Keep the URL/project and recover through a proxy,
                # rather than losing the ingest to one yt-dlp selector.
                print(f"[ingest] audio-only download failed: {first}; trying video proxy")
                proxy = pdir / "proxy.mp4"
                try:
                    ingest.download_proxy(source_url, proxy)
                    ingest.extract_audio(proxy, audio)
                    duration = ingest.probe_duration(proxy)
                except Exception as second:
                    # Report the FIRST failure too. It is the one that carries the
                    # instructions (a sign-in challenge, a missing format); a bare second
                    # message sent people to debug the proxy step instead of the cause.
                    first_text, second_text = _job_error_text(first), _job_error_text(second)
                    detail = (first_text if first_text == second_text
                              else f"{first_text} Video proxy also failed: {second_text}")
                    raise RuntimeError(detail) from second
            _set(project_id, duration=duration)
        elif upload_path or not audio.exists():
            current_stage = "File ingest"
            _set(project_id, status="ingesting", stage="Reading upload", progress=5)
            if upload_path:
                # This is deliberately the first ingest operation: every later fallback
                # reuses source.mp4 and never asks the browser to upload again.
                ingest.save_upload(Path(upload_path), source)
            elif not source.exists():
                raise RuntimeError(
                    "the uploaded file is no longer on disk - upload the clip again.")
            _set(project_id, stage="Extracting audio", progress=15)
            try:
                ingest.extract_audio(source, audio)
            except Exception as e:
                # Caption mode can edit silent footage; moments mode cannot select spoken
                # moments without a transcript, so report that stage precisely.
                if mode != "caption":
                    raise RuntimeError(f"audio extraction failed: {e}") from e
                print(f"[ingest] no audio track; continuing caption mode: {e}")
            _set(project_id, duration=ingest.probe_duration(source))

        # A silent clip is still a valid caption-mode editing source. There is no speech
        # to transcribe, so create its one clip without invoking a transcription provider.
        if mode == "caption" and not audio.exists():
            with get_session() as s:
                proj = s.get(Project, project_id)
                s.add(Clip(project_id=project_id, idx=0, start=0.0, end=proj.duration,
                           title=proj.name, score=0.0, reason="Whole clip (caption mode)",
                           aspect=proj.aspect, caption_preset=proj.caption_preset))
                s.commit()
            _set(project_id, status="ready", stage="Ready to caption (silent source)", progress=100)
            return

        # 2. Transcribe — in a subprocess so a native GPU/CUDA crash can't take the API down.
        current_stage = "Transcription"
        _set(project_id, status="transcribing", stage="Transcribing", progress=20)

        def _tp(pct, msg):
            _set(project_id, stage=msg, progress=20 + int(pct * 0.5))

        try:
            result = transcribe_subprocess(
                audio, pdir / "words.tmp.json", tx_backend, _tp)
        except RuntimeError as first_error:
            # A native GPU crash or a wedged worker cannot execute its own CPU fallback.
            # Reuse the same audio/source once in a clean CPU child; config errors are not
            # retried pointlessly and retain their actionable final message.
            msg = str(first_error).lower()
            recoverable = any(token in msg for token in ("crashed inside", "stopped responding"))
            if tx_backend == "local" and recoverable:
                print(f"[transcribe] local worker failed; retrying on CPU: {first_error}")
                result = transcribe_subprocess(
                    audio, pdir / "words.tmp.json", "local", _tp, force_cpu=True)
            else:
                raise
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
            current_stage = "Moment analysis"
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
        _set(project_id, status="error", stage=f"Failed: {current_stage}", error=_job_error_text(e))


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
