"""Which speech engine transcribes Studio clips, and running one as a child process.

Order of preference (settings.STUDIO_ENGINE = "auto"), from the 2026-11-06 bake-off:
  crisper   CrisperWhisper 2.0: writes every um, stutter and cut-off word, best word starts.
            Own venv (PyTorch), GPU or CPU. Non-commercial weights.
  scribe    ElevenLabs Scribe: fillers and cut-offs, best word ends. Paid, cloud, needs a key.
  parakeet  NVIDIA Parakeet v3 (int8, ONNX): fillers but not cut-offs. Free, CPU, no key:
            the path every install has, so the Cut room works on a bare laptop.
  whisper   faster-whisper: writes NO fillers or cut-offs, so the Cut room finds nothing
            but pauses and repeats. Last resort only.
An engine that fails falls through to the next one for the clips it could not do.
"""
from __future__ import annotations

import importlib.util
import json
import queue
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Callable

import settings

ENGINE_ORDER = ["crisper", "scribe", "parakeet", "whisper"]
LABELS = {
    "crisper": "CrisperWhisper 2.0",
    "scribe": "ElevenLabs Scribe",
    "parakeet": "Parakeet v3",
    "whisper": "Whisper",
}
STALL_SECONDS = 600   # workers heartbeat every 20 s, so 10 silent minutes means hung


def availability() -> dict[str, dict]:
    """{engine: {ok, label, why}}: what this install can actually run."""
    crisper = settings.CRISPER_PYTHON.exists()
    out = {
        "crisper": (crisper, "" if crisper else
                    "not installed (double-click install-crisper.cmd)"),
        "scribe": (bool(settings.ELEVENLABS_API_KEY), "" if settings.ELEVENLABS_API_KEY else
                   "no ELEVENLABS_API_KEY in backend/.env"),
        "parakeet": (importlib.util.find_spec("onnx_asr") is not None, "onnx-asr not installed"),
        "whisper": (importlib.util.find_spec("faster_whisper") is not None,
                    "faster-whisper not installed"),
    }
    return {k: {"ok": ok, "label": LABELS[k], "why": "" if ok else why}
            for k, (ok, why) in out.items()}


def chain(requested: str | None = None) -> list[str]:
    """Engines to try, best first: the requested one (if it can run), then the rest in order."""
    avail = availability()
    req = (requested or settings.STUDIO_ENGINE or "auto").lower()
    order = ENGINE_ORDER if req == "auto" or req not in ENGINE_ORDER else \
        [req] + [e for e in ENGINE_ORDER if e != req]
    return [e for e in order if avail[e]["ok"]]


def _command(engine: str, job_file: Path) -> list[str]:
    if engine == "crisper":
        return [str(settings.CRISPER_PYTHON), str(Path(__file__).with_name("crisper_worker.py")),
                str(job_file)]
    return [sys.executable, "-m", "app.studio.transcribe_worker", str(job_file)]


def run_batch(engine: str, items: list[tuple[Path, Path]],
              on_progress: Callable[[int, int, str], None],
              on_done: Callable[[int], None],
              on_fail: Callable[[int, str], None]) -> str:
    """Transcribe items [(audio, raw_out)] with one engine in one child process.

    Calls back per item. Returns "" when the worker ran (individual clips may still have
    failed via on_fail), or the reason the engine could not run at all; the caller then
    tries the next engine for every item not yet done."""
    job = {"engine": engine, "language": settings.STUDIO_LANGUAGE, "model": settings.CRISPER_MODEL,
           "items": [{"audio": str(a), "out": str(o)} for a, o in items]}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(job, f)
        job_file = Path(f.name)
    try:
        proc = subprocess.Popen(_command(engine, job_file), cwd=str(settings.BACKEND_DIR),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace", bufsize=1)
    except OSError as e:
        job_file.unlink(missing_ok=True)
        return f"could not start {LABELS[engine]}: {e}"

    lines: queue.Queue = queue.Queue()
    err_tail: list[str] = []

    def pump_out():
        for raw in proc.stdout:          # type: ignore[union-attr]
            lines.put(raw)
        lines.put(None)

    def pump_err():                      # drain stderr so a chatty engine can't block
        for raw in proc.stderr:          # type: ignore[union-attr]
            raw = raw.rstrip()
            if raw:
                err_tail[:] = (err_tail + [raw])[-8:]

    threading.Thread(target=pump_out, daemon=True).start()
    threading.Thread(target=pump_err, daemon=True).start()

    fatal, finished = "", set()
    while True:
        try:
            raw = lines.get(timeout=STALL_SECONDS)
        except queue.Empty:
            proc.kill()
            fatal = f"{LABELS[engine]} stopped responding"
            break
        if raw is None:
            break
        parts = raw.strip().split(" ", 3)
        tag = parts[0] if parts else ""
        try:
            if tag == "PROGRESS" and len(parts) >= 3:
                on_progress(int(parts[1]), int(parts[2]), parts[3] if len(parts) > 3 else "")
            elif tag == "DONE":
                finished.add(int(parts[1]))
                on_done(int(parts[1]))
            elif tag == "FAIL":
                finished.add(int(parts[1]))
                on_fail(int(parts[1]), " ".join(parts[2:]) or "failed")
            elif tag == "ERROR":
                fatal = raw.strip()[6:]
        except (ValueError, IndexError):
            pass
    code = proc.wait()
    job_file.unlink(missing_ok=True)
    if fatal:
        return fatal
    if code != 0 and len(finished) < len(items):
        tail = " | ".join(err_tail[-2:])
        return f"{LABELS[engine]} exited with code {code}" + (f": {tail}" if tail else "")
    return ""
