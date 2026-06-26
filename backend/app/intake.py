"""Intake: turn a pasted script (from Claude) into ordered Beat rows.

The user pastes a full script and the app splits it into beats automatically —
they never type beats one by one. The parser is deterministic (no LLM): it splits
on beat delimiters, reads labeled fields, and falls back to paragraph-splitting
for plain prose.

Recommended paste format (what Claude should output) — labels are optional and
case-insensitive; any unlabeled text becomes the spoken line:

    HOOK: The one line that stops the scroll

    BEAT
    Spoken: What you say out loud here.
    On-screen: BIG TEXT OVERLAY
    Caption: the karaoke caption (defaults to the spoken line)
    Shot: what to film — e.g. label close-up
    Proof: yes

    BEAT
    Spoken: ...

Also accepts `Beat 1:`, markdown `## ...`, `---`, and `1.` / `1)` as delimiters.
"""
from __future__ import annotations

import re

# field name -> accepted labels (compared lowercased, hyphens→spaces)
_LABELS: dict[str, list[str]] = {
    "spoken_line": ["spoken", "say", "voiceover", "vo", "line", "script", "narration"],
    "on_screen_text": ["on screen", "onscreen", "text", "overlay", "title"],
    "caption": ["caption", "captions", "cc", "subtitle", "subtitles"],
    "shot_cue": ["shot", "shot cue", "b roll", "broll", "film", "visual", "footage"],
}
_NUM_RE = re.compile(r"\d")
_LABEL_RE = re.compile(r"^[\-\*•]?\s*([A-Za-z][A-Za-z \-/]{1,20})\s*[:\-]\s*(.*)$")


def _delimiter_remainder(s: str) -> str | None:
    """If `s` is a beat delimiter, return any trailing content (possibly ""); else None."""
    m = re.match(r"(?i)^beat\b[ \t]*(\d+)?[ \t]*([:.)\-])?[ \t]*(.*)$", s)
    if m and (m.group(1) or m.group(2) or not m.group(3)):
        return m.group(3).strip()
    m = re.match(r"^#{1,6}\s+(.*)$", s)          # markdown heading
    if m:
        return m.group(1).strip()
    if re.match(r"^-{3,}$", s):                   # horizontal rule
        return ""
    m = re.match(r"^\d+[.)]\s+(.*)$", s)          # "1. " / "1) "
    if m:
        return m.group(1).strip()
    return None


def _match_label(s: str) -> tuple[str | None, str]:
    """('spoken_line'|'proof'|..., value) if the line is `Label: value`, else (None, s)."""
    m = _LABEL_RE.match(s)
    if not m:
        return None, s
    label = m.group(1).strip().lower().replace("-", " ")
    label = re.sub(r"\s+", " ", label)
    val = m.group(2).strip()
    if label == "proof":
        return "proof", val
    for key, aliases in _LABELS.items():
        if label in aliases:
            return key, val
    return None, s


def _truthy(val: str) -> bool:
    v = val.strip().lower()
    if v == "":
        return True  # a bare "Proof:" label means it IS a proof beat
    return v not in ("no", "false", "n", "0", "none", "off")


def _parse_block(order_index: int, lines: list[str]) -> dict | None:
    fields = {"spoken_line": "", "on_screen_text": "", "caption": "", "shot_cue": ""}
    proof: bool | None = None
    unlabeled: list[str] = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        key, val = _match_label(s)
        if key == "proof":
            proof = _truthy(val)
        elif key:
            fields[key] = f"{fields[key]} {val}".strip() if fields[key] else val
        else:
            unlabeled.append(s)
    if unlabeled:
        joined = " ".join(unlabeled).strip()
        fields["spoken_line"] = f"{fields['spoken_line']} {joined}".strip() if fields["spoken_line"] else joined
    if not fields["caption"]:
        fields["caption"] = fields["spoken_line"]  # captions come from the script text
    if not any(fields.values()):
        return None
    if proof is None:  # auto-flag a proof beat when it states a real number
        proof = bool(_NUM_RE.search(f"{fields['spoken_line']} {fields['caption']} {fields['on_screen_text']}"))
    return {"order_index": order_index, **fields, "is_proof_beat": proof}


def parse_script(text: str) -> dict:
    """Split a pasted script into {hook, beats:[{order_index, spoken_line, on_screen_text,
    caption, shot_cue, is_proof_beat}, ...]}."""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    hook = ""
    body_lines: list[str] = []

    # Pull a leading HOOK: line off the top (before any beat content).
    started = False
    for raw in text.split("\n"):
        s = raw.strip()
        if not started and s:
            m = re.match(r"(?i)^hook\s*[:\-]\s*(.+)$", s)
            if m:
                hook = m.group(1).strip()
                continue
            started = True
        if s:
            started = True
        body_lines.append(raw)

    # Split into blocks on delimiters; track whether we saw any.
    blocks: list[list[str]] = []
    current: list[str] = []
    saw_delim = False

    def flush():
        nonlocal current
        if any(l.strip() for l in current):
            blocks.append(current)
        current = []

    for raw in body_lines:
        s = raw.strip()
        d = _delimiter_remainder(s) if s else None
        if d is not None:
            saw_delim = True
            flush()
            if d:
                current.append(d)
        else:
            current.append(raw)
    flush()

    # No delimiters at all → treat each blank-line-separated paragraph as a beat.
    if not saw_delim:
        blocks = []
        para: list[str] = []
        for raw in body_lines:
            if raw.strip():
                para.append(raw)
            elif para:
                blocks.append(para); para = []
        if para:
            blocks.append(para)

    beats = []
    for blk in blocks:
        beat = _parse_block(len(beats), blk)
        if beat:
            beats.append(beat)
    return {"hook": hook, "beats": beats}
