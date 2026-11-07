"""The line protocol every Studio speech worker speaks on stdout.

A worker is a child process (so a native crash in a speech engine can't take the API down)
that gets one job file and transcribes several clips with one loaded model:

    job.json  {"engine": str, "language": str, "model": str,
               "items": [{"audio": "<16k wav>", "out": "<raw words json>"}]}

and reports, one line each:

    PROGRESS <item> <pct 0-100 or -1> <message>   (-1 = still alive, no new percentage)
    DONE <item>                                  (raw words written to items[i].out)
    FAIL <item> <reason>                         (that clip only; the rest carry on)
    ERROR <reason>                               (nothing can run, e.g. engine missing)

Raw words are [{"start", "end", "word", "type"?}] in the engine's own spelling; the parent
normalises them (app.studio.words) so the junk labels live in exactly one place.

This file is imported by BOTH workers, including the CrisperWhisper one, which runs on a
different Python with none of Cvideo's packages, so it must stay standard-library only.
"""
from __future__ import annotations

import json
import sys
import threading
import time


def say(*parts) -> None:
    print(" ".join(str(p) for p in parts).replace("\n", " "), flush=True)


def heartbeat(get_item, every: float = 20.0) -> None:
    """Prove the worker is alive while a long clip decodes with no progress of its own."""
    def loop():
        while True:
            time.sleep(every)
            say("PROGRESS", get_item(), -1, "Still transcribing")
    threading.Thread(target=loop, daemon=True).start()


def run(transcribe_item, load=None) -> int:
    """Drive a job: load the model once, then transcribe_item(audio, language, model, progress)
    for each item. Returns the process exit code."""
    if len(sys.argv) < 2:
        say("ERROR usage: worker <job.json>")
        return 2
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)
    current = [0]
    heartbeat(lambda: current[0])
    try:
        ctx = load(job) if load else None
    except Exception as e:  # noqa: BLE001 - the reason is the point
        say("ERROR", " ".join(str(e).split()) or type(e).__name__)
        return 1
    for i, item in enumerate(job["items"]):
        current[0] = i
        say("PROGRESS", i, 0, "Transcribing")
        try:
            words = transcribe_item(ctx, item["audio"], job,
                                    lambda pct, msg="Transcribing", i=i: say("PROGRESS", i, int(pct), msg))
            with open(item["out"], "w", encoding="utf-8") as f:
                json.dump(words, f, ensure_ascii=False)
            say("DONE", i)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc(file=sys.stderr)
            say("FAIL", i, " ".join(str(e).split()) or type(e).__name__)
    return 0
