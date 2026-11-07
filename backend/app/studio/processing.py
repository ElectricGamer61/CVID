"""Background work that turns an uploaded clip into something the Cut room can edit.

Per clip, in this order:
  1. probe            duration, size, frame rate, sound, recording time
  2. speech audio     16 kHz mono wav + loudness every 10 ms (energy.bin)
  3. transcript       queued for the speech worker (one model load for a whole batch)
  4. proxy            720p copy for instant scrubbing (runs while the transcript is made)

Durable results live in project.json (proxy/transcript: done | error). Live percentages
live only in memory (`progress`) and ride along on GET; a restart simply re-queues every
clip that is not finished yet, since all its inputs are already on disk.
"""
from __future__ import annotations

import json
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import engines, media, store
from .words import normalize

SILENT_BELOW_S = 0.5     # less sound than this (above -40 dB) = a silent clip
SPEECHY_ABOVE_S = 3.0    # more than this and an empty transcript is the engine failing
BATCH_WAIT_S = 3.0       # gather clips that finish reading together into one model load

_media_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="studio-media")
_tx_cond = threading.Condition()
_tx_pending: dict[tuple[str, str], None] = {}       # insertion-ordered set
_tx_thread: threading.Thread | None = None
progress: dict[tuple[str, str], dict] = {}           # (pid, cid) -> {stage: pct, msg}


def _set_progress(pid: str, cid: str, **kw) -> None:
    progress.setdefault((pid, cid), {}).update(kw)


def enqueue(pid: str, cid: str) -> None:
    _media_pool.submit(_prepare, pid, cid)


def _safe_update(pid: str, cid: str, **fields) -> bool:
    try:
        store.update_clip(pid, cid, **fields)
        return True
    except store.NotFound:            # deleted while we worked: nothing left to report to
        return False


def _prepare(pid: str, cid: str) -> None:
    try:
        p = store.load(pid)
        clip = store.find_clip(p, cid)
    except store.NotFound:
        return
    src = store.media_path(pid, clip)
    cd = store.clip_dir(pid, cid)
    stage = "probe"
    waiting_for_words = False
    try:
        info = media.probe(src)
        if not clip.duration:
            _safe_update(pid, cid, **{k: info[k] for k in
                                      ("duration", "width", "height", "fps", "has_audio", "vfr",
                                       "recorded_at")})
        stage = "audio"
        if info["has_audio"]:
            audio = cd / "audio.wav"
            if not audio.exists():
                _set_progress(pid, cid, msg="Reading the sound")
                media.extract_speech_audio(src, audio)
            if not (cd / "energy.bin").exists():
                media.write_energy(audio, cd / "energy.bin")
            if clip.transcript == "pending":
                if media.seconds_of_sound(media.read_energy(cd / "energy.bin")) < SILENT_BELOW_S:
                    # Silent B-roll: nothing to transcribe, and a cloud engine would bill
                    # for listening to silence. It still gets cut and exported like any clip.
                    (cd / "words.json").write_text("[]", encoding="utf-8")
                    _safe_update(pid, cid, transcript="none", engine="")
                else:
                    _queue_transcript(pid, cid)
                    waiting_for_words = True
        elif clip.transcript == "pending":
            _safe_update(pid, cid, transcript="none")
        stage = "thumbnail"
        if not info["is_audio_only"] and not (cd / "thumb.jpg").exists():
            media.write_thumb(src, cd / "thumb.jpg", info["duration"])
        stage = "proxy"
        if clip.proxy != "done" or not (cd / "proxy.mp4").exists():
            _set_progress(pid, cid, proxy=0)
            media.make_proxy(src, cd / "proxy.mp4", info,
                             lambda f: _set_progress(pid, cid, proxy=int(f * 100)))
            _safe_update(pid, cid, proxy="done")
        progress.get((pid, cid), {}).pop("proxy", None)
        if not waiting_for_words:      # else the speech worker owns the message now
            progress.get((pid, cid), {}).pop("msg", None)
    except Exception as e:  # noqa: BLE001 - every failure must reach the user in words
        traceback.print_exc()
        reason = " ".join(str(e).split()) or type(e).__name__
        fields = {"error": f"{stage}: {reason}"}
        if stage == "proxy":
            fields["proxy"] = "error"
        else:
            fields.update(proxy="error", transcript="error")
        _safe_update(pid, cid, **fields)


def _queue_transcript(pid: str, cid: str) -> None:
    global _tx_thread
    with _tx_cond:
        _tx_pending[(pid, cid)] = None
        _set_progress(pid, cid, transcript=0, msg="Waiting for the speech engine")
        if _tx_thread is None or not _tx_thread.is_alive():
            _tx_thread = threading.Thread(target=_tx_loop, name="studio-transcribe", daemon=True)
            _tx_thread.start()
        _tx_cond.notify()


def _tx_loop() -> None:
    while True:
        with _tx_cond:
            while not _tx_pending:
                _tx_cond.wait()
            # A pile of clips finishes reading within seconds of each other; loading the
            # speech model once for all of them beats once per clip (~15 s per load).
            _tx_cond.wait(timeout=BATCH_WAIT_S)
            batch = list(_tx_pending)
            _tx_pending.clear()
        try:
            _transcribe_batch(batch)
        except Exception:  # noqa: BLE001 - keep the loop alive for the next batch
            traceback.print_exc()


def _transcribe_batch(batch: list[tuple[str, str]]) -> None:
    by_engine: dict[str, list[tuple[str, str]]] = {}
    for pid, cid in batch:
        try:
            want = store.load(pid).settings.get("engine") or "auto"
        except store.NotFound:
            continue
        by_engine.setdefault(want, []).append((pid, cid))

    for want, keys in by_engine.items():
        remaining = keys
        why: dict[tuple[str, str], str] = {}
        tried = engines.chain(want)
        for engine in tried:
            items = [(store.clip_dir(pid, cid) / "audio.wav",
                      store.clip_dir(pid, cid) / f"raw-{engine}.json") for pid, cid in remaining]
            done: set[int] = set()

            def on_progress(i, pct, msg, _r=remaining, _e=engine):
                pid, cid = _r[i]
                fields = {"msg": f"{engines.LABELS[_e]}: {msg}" if msg else engines.LABELS[_e]}
                if pct >= 0:
                    fields["transcript"] = pct
                _set_progress(pid, cid, **fields)

            def on_done(i, _r=remaining, _items=items, _e=engine):
                pid, cid = _r[i]
                words = normalize(json.loads(Path(_items[i][1]).read_text(encoding="utf-8")))
                cd = store.clip_dir(pid, cid)
                if not words and _e != tried[-1] and media.seconds_of_sound(
                        media.read_energy(cd / "energy.bin")) > SPEECHY_ABOVE_S:
                    # Seconds of sound and not one word: the engine failed quietly (music
                    # under the voice can do it). Let the next engine have a go.
                    on_fail(i, "found no words in audio that has sound in it")
                    return
                (cd / "words.json").write_text(json.dumps(words, ensure_ascii=False),
                                               encoding="utf-8")
                if _safe_update(pid, cid, transcript="done", engine=_e, error=""):
                    done.add(i)
                    for k in ("transcript", "msg"):
                        progress.get((pid, cid), {}).pop(k, None)

            def on_fail(i, reason, _r=remaining, _e=engine):
                why[_r[i]] = f"{engines.LABELS[_e]}: {reason}"
                print(f"[studio] {engines.LABELS[_e]} could not transcribe clip {_r[i][1]}: {reason}")

            fatal = engines.run_batch(engine, items, on_progress, on_done, on_fail)
            if fatal:
                print(f"[studio] {engines.LABELS[engine]} could not run: {fatal}")
                for k in remaining:
                    why.setdefault(k, f"{engines.LABELS[engine]}: {fatal}")
            remaining = [k for i, k in enumerate(remaining) if i not in done]
            if not remaining:
                break
        for pid, cid in remaining:
            reason = why.get((pid, cid)) or ("no speech engine is installed" if not tried
                                             else "no speech engine could transcribe this clip")
            _safe_update(pid, cid, transcript="error", error=reason)
            for k in ("transcript", "msg"):
                progress.get((pid, cid), {}).pop(k, None)


def retry(pid: str, cid: str) -> None:
    def reset(p: store.Project) -> None:
        c = store.find_clip(p, cid)
        if c.proxy == "error":
            c.proxy = "pending"
        if c.transcript == "error":
            c.transcript = "pending"
        c.error = ""
    store.mutate(pid, reset)
    enqueue(pid, cid)


def retranscribe(pid: str, cid: str) -> None:
    """Throw the transcript away and make it again (e.g. after switching engines)."""
    (store.clip_dir(pid, cid) / "words.json").unlink(missing_ok=True)
    store.update_clip(pid, cid, transcript="pending", engine="", error="")
    enqueue(pid, cid)


def resume_all() -> None:
    """At startup: everything not finished gets picked up again."""
    for p in store.list_projects():
        for c in p.clips:
            if c.proxy == "pending" or c.transcript == "pending" or not c.duration:
                enqueue(p.id, c.id)
