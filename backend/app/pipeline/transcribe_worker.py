"""Subprocess entry point for transcription — isolates GPU/CTranslate2 native code
from the API process.

Running faster-whisper on the RTX 5070 (Blackwell, sm_120) can crash the native cuBLAS/
cuDNN layer with an access violation. In-process that takes the whole FastAPI backend down
with no Python traceback (the HTTP-000 deaths). Run here in a child process instead: a crash
kills only this worker, the parent (`jobs.transcribe_subprocess`) sees a non-zero exit code
and marks the job errored, and the API stays up.

Usage:  python -m app.pipeline.transcribe_worker <audio_path> <out_json> <backend>
Writes the transcription result dict to <out_json>. Emits progress as stdout lines
"PROGRESS <pct> <msg>" so the parent can relay them onto the Project row.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: transcribe_worker <audio> <out_json> <backend>", file=sys.stderr)
        return 2
    audio, out_json, backend = sys.argv[1], sys.argv[2], sys.argv[3]
    from app.pipeline import transcribe

    def progress(pct: int, msg: str) -> None:
        print(f"PROGRESS {int(pct)} {msg}", flush=True)

    result = transcribe.transcribe(Path(audio), backend=backend, progress=progress)
    Path(out_json).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
