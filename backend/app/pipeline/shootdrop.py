"""Shoot Drop: batch raw-footage intake — record, dump files, done.

A batch of raw phone clips comes in (in-app drop zone or the watched folder).
Each clip is transcribed (subprocess-isolated, same worker as projects), then
matched by WHAT WAS SAID against the spoken lines of open tickets' beats:

  match found  → attach the file to that beat (same write as the manual
                 per-scene upload) + auto-name it {ticket}_scene{N}.mp4
  no match     → the batch's leftovers become a NEW ticket whose script is
                 reverse-generated from the transcripts (one beat per clip,
                 in shooting order = file mtime)

When a ticket's scenes are all filled, its publish copy (post_meta) is
generated automatically — no more hunting the script to ask for titles/tags.

Matching is deterministic (difflib + token overlap), no LLM: Dennis flubs and
ad-libs around the scripted line, so we score both sequence similarity and
how much of the scripted line's vocabulary shows up in the take.
"""
from __future__ import annotations

import re
import shutil
import time
import traceback
import uuid
from difflib import SequenceMatcher
from pathlib import Path

from sqlmodel import select

import settings
from ..db import Beat, IngestClip, Ticket, get_session
from . import assemble, ingest

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
MATCH_THRESHOLD = 0.55
# A clip needs at least this many spoken words to be treated as "has speech" — below it
# (silent B-roll, a stray cough) it's never used to auto-invent a video; it waits for you
# to place it visually.
MIN_SPEECH_WORDS = 4
# Ticket stages whose beats still need footage (before assembled).
OPEN_STAGES = ("outlier", "scripted", "staged", "sourced")


# --------------------------------------------------------------------------- #
# Batch creation
# --------------------------------------------------------------------------- #
def _safe(name: str) -> str:
    s = re.sub(r"[^\w\- ]+", "", name).strip().replace(" ", "-")
    return s[:60] or "clip"


def new_batch(files: list[Path], move: bool = False,
              names: list[str] | None = None) -> str:
    """Copy/move raw files into data/shootdrop/{batch}/ and create IngestClip rows.
    `names` overrides display filenames (uploads arrive as temp files)."""
    batch_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    bdir = settings.SHOOTDROP_DIR / batch_id
    bdir.mkdir(parents=True, exist_ok=True)
    with get_session() as s:
        for i, f in enumerate(files):
            name = (names[i] if names and i < len(names) else f.name) or f.name
            mtime = f.stat().st_mtime
            dest = bdir / f"{i:02d}_{_safe(Path(name).stem)}{Path(name).suffix.lower()}"
            if move:
                shutil.move(str(f), str(dest))
            else:
                shutil.copy2(str(f), str(dest))
            s.add(IngestClip(batch_id=batch_id, filename=name, path=str(dest),
                             mtime=mtime))
        s.commit()
    return batch_id


# --------------------------------------------------------------------------- #
# Matcher (deterministic, no LLM)
# --------------------------------------------------------------------------- #
def _tokens(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9' ]+", " ", (text or "").lower()).split()


def _word_count(text: str) -> int:
    return len(_tokens(text))


def match_score(transcript: str, line: str) -> float:
    """0..1 — how likely `transcript` is a take of scripted `line`.
    max(sequence ratio, dampened vocab containment): ratio rewards saying the
    line as written, containment tolerates ad-libs padded around it."""
    a, b = _tokens(transcript), _tokens(line)
    if not a or not b:
        return 0.0
    ratio = SequenceMatcher(None, a, b).ratio()
    overlap = len(set(a) & set(b)) / len(set(b))
    return max(ratio, 0.9 * overlap)


def open_beats() -> list[dict]:
    """Snapshot of beats still needing footage across open native tickets."""
    out: list[dict] = []
    with get_session() as s:
        tickets = s.exec(select(Ticket).where(
            Ticket.stage.in_(OPEN_STAGES),
            Ticket.capture_mode == "native-short")).all()
        for t in tickets:
            for b in s.exec(select(Beat).where(Beat.ticket_id == t.id)
                            .order_by(Beat.order_index)).all():
                line = b.spoken_line or b.caption
                if not b.clip_path and line.strip():
                    out.append({"beat_id": b.id, "ticket_id": t.id,
                                "order_index": b.order_index, "line": line,
                                "ticket_label": t.hook_text or t.angle or f"video {t.id}"})
    return out


# --------------------------------------------------------------------------- #
# Attach / naming
# --------------------------------------------------------------------------- #
def _beat_media_dir(tid: int, bid: int) -> Path:
    d = assemble.ticket_dir(tid) / "beats" / str(bid)
    d.mkdir(parents=True, exist_ok=True)
    return d


def attach_clip_to_beat(src: Path, tid: int, bid: int) -> str:
    """Same write as the manual per-scene upload: beats/{bid}/clip.mp4 + clip_path."""
    dest = _beat_media_dir(tid, bid) / "clip.mp4"
    shutil.copy2(str(src), str(dest))
    with get_session() as s:
        b = s.get(Beat, bid)
        if b:
            b.clip_path = str(dest)
            s.add(b); s.commit()
    return str(dest)


def _autoname(ic_path: str, ticket_label: str, scene_index: int) -> str:
    """Rename the batch copy to a human name: {ticket}_scene{N}.mp4."""
    p = Path(ic_path)
    dest = p.with_name(f"{_safe(ticket_label)}_scene{scene_index + 1}{p.suffix}")
    n = 2
    while dest.exists() and dest != p:
        dest = p.with_name(f"{_safe(ticket_label)}_scene{scene_index + 1}_take{n}{p.suffix}")
        n += 1
    if dest != p:
        p.rename(dest)
    return str(dest)


# --------------------------------------------------------------------------- #
# Batch pipeline
# --------------------------------------------------------------------------- #
def _set(icid: int, **fields) -> None:
    with get_session() as s:
        ic = s.get(IngestClip, icid)
        if ic:
            for k, v in fields.items():
                setattr(ic, k, v)
            s.add(ic); s.commit()


def _transcript_for(video: Path) -> str:
    """Best-effort transcript. Silent B-roll (no audio track) or a transcription hiccup
    returns "" — the clip is simply treated as 'no speech' and waits in the sorting board
    for you to place it, rather than erroring out."""
    from ..jobs import transcribe_subprocess  # late import — jobs imports pipeline
    wav = video.with_suffix(".wav")
    try:
        try:
            ingest.extract_audio(video, wav)  # 16 kHz mono — silent clips have no audio track
        except Exception as e:  # noqa: BLE001 — no/broken audio = silent B-roll, not a failure
            print(f"[shootdrop] {video.name}: no readable audio ({type(e).__name__}); treating as silent")
            return ""
        backend = "elevenlabs" if settings.ELEVENLABS_API_KEY else "local"
        try:
            result = transcribe_subprocess(wav, video.with_suffix(".words.json"), backend)
        except Exception as e:  # noqa: BLE001 — transcription trouble ≠ dead clip; place it by hand
            # Print the reason, not just the type: this path swallows the failure, so the
            # log line is the only place a missing engine / bad key can ever show up.
            print(f"[shootdrop] {video.name}: transcription failed ({e}); treating as silent")
            return ""
        return (result.get("text") or "").strip()
    finally:
        wav.unlink(missing_ok=True)


def run_batch(batch_id: str) -> None:
    """Transcribe → match → attach → reverse-generate → post copy. Runs on the
    jobs executor; any per-clip failure marks that clip, never kills the batch."""
    try:
        _run_batch(batch_id)
    except Exception as e:  # noqa: BLE001 — a batch bug must not kill the worker
        traceback.print_exc()
        with get_session() as s:
            for ic in s.exec(select(IngestClip).where(
                    IngestClip.batch_id == batch_id,
                    IngestClip.status.in_(("pending", "transcribing")))).all():
                ic.status = "error"
                ic.error = f"{type(e).__name__}: {e}"[:300]
                s.add(ic)
            s.commit()


def _run_batch(batch_id: str) -> None:
    with get_session() as s:
        ids = [ic.id for ic in s.exec(
            select(IngestClip).where(IngestClip.batch_id == batch_id,
                                     IngestClip.status == "pending")
            .order_by(IngestClip.id)).all()]

    # 1. Transcribe each clip (GPU/API work — sequential on the single worker).
    for icid in ids:
        with get_session() as s:
            ic = s.get(IngestClip, icid)
            path = Path(ic.path) if ic else None
        if not path or not path.exists():
            _set(icid, status="error", error="file missing")
            continue
        _set(icid, status="transcribing")
        try:
            text = _transcript_for(path)
            _set(icid, transcript=text, status="unmatched")
        except Exception as e:  # noqa: BLE001 — bad file ≠ dead batch
            traceback.print_exc()
            _set(icid, status="error", error=f"{type(e).__name__}: {e}"[:300])

    # 2. Match transcripts to open scenes, best scores first, one clip per scene.
    with get_session() as s:
        clips = [{"id": ic.id, "path": ic.path, "transcript": ic.transcript,
                  "mtime": ic.mtime}
                 for ic in s.exec(select(IngestClip).where(
                     IngestClip.batch_id == batch_id,
                     IngestClip.status == "unmatched")).all()
                 if ic.transcript.strip()]
    beats = open_beats()
    scored = sorted(
        ((match_score(c["transcript"], b["line"]), c, b)
         for c in clips for b in beats),
        key=lambda x: -x[0])
    taken_clips: set[int] = set()
    taken_beats: set[int] = set()
    touched_tickets: set[int] = set()
    for score, c, b in scored:
        if score < MATCH_THRESHOLD:
            break
        if c["id"] in taken_clips or b["beat_id"] in taken_beats:
            continue
        attach_clip_to_beat(Path(c["path"]), b["ticket_id"], b["beat_id"])
        new_path = _autoname(c["path"], b["ticket_label"], b["order_index"])
        _set(c["id"], status="matched", ticket_id=b["ticket_id"],
             beat_id=b["beat_id"], confidence=round(score, 3), path=new_path)
        taken_clips.add(c["id"])
        taken_beats.add(b["beat_id"])
        touched_tickets.add(b["ticket_id"])

    # 3. Leftovers → one new reverse-generated ticket, but ONLY from clips that carry
    #    real speech. Silent B-roll (you talk in the voiceover, not on camera) has nothing
    #    to build a script from, so it stays "unmatched" and waits in the sorting board for
    #    you to drag it onto the right scene — never swept into a wrongly-invented video.
    speech_leftovers = sorted(
        (c for c in clips
         if c["id"] not in taken_clips and _word_count(c["transcript"]) >= MIN_SPEECH_WORDS),
        key=lambda c: (c["mtime"], c["id"]))
    if speech_leftovers:
        touched_tickets.add(reverse_ticket(batch_id, speech_leftovers))

    # 4. Housekeeping per touched ticket: advance stage + auto post copy.
    for tid in touched_tickets:
        after_footage(tid)


def _first_sentence(text: str) -> str:
    m = re.split(r"(?<=[.!?])\s+", text.strip(), maxsplit=1)
    return (m[0] if m else text).strip()[:120]


def _polish_hook(raw: str) -> str:
    """One-line LLM polish of the reverse-generated hook; raw line if no LLM."""
    try:
        from .llm import llm_text
        out = llm_text(
            "Rewrite this opening line of a short-form video as one scroll-stopping "
            f'hook. Return ONLY the hook text, nothing else.\nLine: "{raw}"').strip()
        out = out.strip('"').strip()
        if 0 < len(out) <= 140:
            return out
    except Exception as e:  # noqa: BLE001 — heuristic fallback
        print(f"[shootdrop] hook polish fallback: {e}")
    return raw


def reverse_ticket(batch_id: str, clips: list[dict]) -> int:
    """Build a new ticket FROM the footage: one beat per clip, script = what
    was actually said. The user filmed freely; the app writes the script."""
    hook = _polish_hook(_first_sentence(clips[0]["transcript"]))
    with get_session() as s:
        t = Ticket(stage="sourced", capture_mode="native-short", format="reel",
                   angle=hook[:80], hook_text=hook,
                   source_ref=f"shoot drop {batch_id}")
        s.add(t); s.commit(); s.refresh(t)
        tid = t.id
        for i, c in enumerate(clips):
            line = c["transcript"].strip()
            b = Beat(ticket_id=tid, order_index=i, spoken_line=line, caption=line,
                     shot_cue="", is_proof_beat=bool(re.search(r"\d", line)))
            s.add(b); s.commit(); s.refresh(b)
            c["beat_id"] = b.id
    label = hook or f"video {tid}"
    for i, c in enumerate(clips):
        attach_clip_to_beat(Path(c["path"]), tid, c["beat_id"])
        new_path = _autoname(c["path"], label, i)
        _set(c["id"], status="matched", ticket_id=tid, beat_id=c["beat_id"],
             confidence=0.0, path=new_path)
    return tid


def after_footage(tid: int) -> None:
    """Once footage lands on a ticket: bump stage to sourced when every scene is
    filled, and auto-generate its publish copy (post_meta) if it has none."""
    with get_session() as s:
        t = s.get(Ticket, tid)
        if not t:
            return
        beats = s.exec(select(Beat).where(Beat.ticket_id == tid)
                       .order_by(Beat.order_index)).all()
        full = bool(beats) and all(b.clip_path for b in beats)
        if full and t.stage in ("outlier", "scripted", "staged"):
            t.stage = "sourced"
            s.add(t); s.commit(); s.refresh(t)
        if not full or t.post_meta:
            return
        brand, hook = t.brand, t.hook_text
        script = "\n".join((b.spoken_line or b.caption) for b in beats)
    from .. import ai  # late import — ai imports pipeline.llm
    try:
        meta = ai.post_copy(brand, hook, script)
    except Exception as e:  # noqa: BLE001 — post copy is best-effort
        print(f"[shootdrop] post copy failed for ticket {tid}: {e}")
        return
    with get_session() as s:
        t = s.get(Ticket, tid)
        if t and not t.post_meta:
            t.post_meta = meta
            s.add(t); s.commit()
