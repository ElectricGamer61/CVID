"""The "brain": pick the best short-worthy moments from a transcript.

Pluggable ScorerBackend with three implementations:
  - OllamaScorer  : local LLM (default), offline, free
  - GeminiScorer  : cloud LLM (free tier)
  - HeuristicScorer: no-LLM fallback so the pipeline always returns clips

Each returns a list of dicts: {start, end, title, score, reason}.
Times are snapped to word boundaries and clamped to MIN/MAX clip length.
"""
from __future__ import annotations

import abc
import json
import re
from typing import Optional

import settings
from .. import learn


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def build_timed_transcript(words: list[dict], stamp_every: int = 8) -> str:
    """Render the transcript with periodic [t=SS.s] markers so the LLM can cite times."""
    out = []
    for i, w in enumerate(words):
        if i % stamp_every == 0:
            out.append(f"[t={w['start']:.1f}]")
        out.append(w["word"].strip())
    return " ".join(out)


def _snap(value: float, words: list[dict], use_end: bool = False) -> float:
    """Snap a time to the nearest word boundary."""
    best, bestd = value, 1e9
    for w in words:
        t = w["end"] if use_end else w["start"]
        d = abs(t - value)
        if d < bestd:
            best, bestd = t, d
    return best


def _ends_sentence(word: str) -> bool:
    return word.strip().endswith((".", "!", "?"))


def _snap_sentence(value: float, words: list[dict], use_end: bool, window: float = 3.0):
    """Snap to the nearest SENTENCE boundary within `window` seconds, else None.
    For end: a word ending in . ! ?. For start: the word after such a word."""
    best, bestd = None, window
    for i, w in enumerate(words):
        if use_end and _ends_sentence(w["word"]):
            d = abs(w["end"] - value)
            if d < bestd:
                best, bestd = w["end"], d
        elif (not use_end) and i > 0 and _ends_sentence(words[i - 1]["word"]):
            d = abs(w["start"] - value)
            if d < bestd:
                best, bestd = w["start"], d
    return best


def _overlap_frac(a: dict, b: dict) -> float:
    inter = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    shorter = min(a["end"] - a["start"], b["end"] - b["start"])
    return inter / shorter if shorter > 0 else 0.0


def _dedupe(clips: list[dict], thresh: float = 0.5) -> list[dict]:
    """Keep highest-scored; drop a clip if it overlaps a kept one by > thresh."""
    out: list[dict] = []
    for c in sorted(clips, key=lambda x: x["score"], reverse=True):
        if all(_overlap_frac(c, k) <= thresh for k in out):
            out.append(c)
    out.sort(key=lambda x: x["start"])
    return out


def _normalize(clips: list[dict], words: list[dict]) -> list[dict]:
    if not words:
        return []
    vid_start, vid_end = words[0]["start"], words[-1]["end"]
    cleaned = []
    for c in clips:
        try:
            start = float(c.get("start", 0))
            end = float(c.get("end", 0))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        # prefer sentence boundaries, fall back to nearest word boundary
        start = _snap_sentence(start, words, False) or _snap(start, words, False)
        end = _snap_sentence(end, words, True) or _snap(end, words, True)
        start = max(vid_start, start)
        end = min(vid_end, end)
        # Enforce length, but ALWAYS re-snap the new end to a sentence/word boundary so
        # a length-clamped clip never lands mid-word — which would chop the last word's
        # audio while its caption still renders ("clip too short, words cut off").
        if end - start < settings.MIN_CLIP_SEC:
            target = min(vid_end, start + settings.MIN_CLIP_SEC)
            end = _snap_sentence(target, words, True) or _snap(target, words, True)
        if end - start > settings.MAX_CLIP_SEC:
            target = start + settings.MAX_CLIP_SEC
            end = _snap_sentence(target, words, True) or _snap(target, words, True)
        end = min(vid_end, end)
        if end - start < 3:
            continue
        cleaned.append({
            "start": round(float(start), 2),
            "end": round(float(end), 2),
            "title": str(c.get("title", "Clip"))[:120],
            "score": round(float(c.get("score", 0) or 0), 1),
            "hook": str(c.get("hook_sentence", ""))[:200],
            "reason": str(c.get("reason", ""))[:300],
        })
    return _dedupe(cleaned)


def _looks_like_clip(d: dict) -> bool:
    return isinstance(d, dict) and "start" in d and "end" in d


def _extract_json_array(text: str) -> list:
    """Pull a list of clip dicts out of an LLM response, tolerating:
      - a bare array:            [ {...}, {...} ]
      - an envelope object:      {"clips": [ {...} ]}
      - a single clip object:    {"start":..,"end":..,...}
    """
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # envelope: first list value made of clip-like dicts
            for v in data.values():
                if isinstance(v, list):
                    return v
            # the object itself is a single clip
            if _looks_like_clip(data):
                return [data]
    except json.JSONDecodeError:
        pass
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    return []


_PROMPT = """You are a world-class viral short-form video editor (like OpusClip / wayinvideo).
Below is a transcript of a long-form video with timestamps marked as [t=SECONDS].
Find the {n} BEST self-contained moments to cut into vertical shorts.

Score each candidate 0-100 on VIRALITY, judging it against these signals:
- HOOK: does it open with something that stops the scroll?
- EMOTIONAL PEAK: surprise, awe, humor, anger, inspiration.
- OPINION BOMB / HOT TAKE: a bold or contrarian claim.
- REVELATION: a surprising fact, secret, or "I didn't know that".
- CONFLICT / TENSION: disagreement, stakes, a problem.
- QUOTABLE LINE: a punchy, screenshot-worthy sentence.
- STORY PEAK: a complete mini-story with a payoff.
- PRACTICAL VALUE: a tip people would save or share.

Rules:
- Return MULTIPLE clips (aim for {n}; at least 2 if content allows).
- Each clip must be {mins}-{maxs} seconds long and a COMPLETE thought (start and end on
  full sentences — never mid-sentence).
- Use the [t=...] markers to estimate start/end in seconds.
- Higher score = more likely to go viral. Be discerning; don't give everything 80+.

Respond with a JSON object of this exact shape (no prose):
{{"clips": [
  {{"start": <sec>, "end": <sec>, "title": "<catchy 3-7 word title>", "score": <0-100>,
    "hook_sentence": "<the single most scroll-stopping line in the clip>",
    "reason": "<one line: which signals above make it work>"}}
]}}

TRANSCRIPT:
{transcript}
"""

# JSON schema for structured outputs (Ollama / Gemini) so the model can't collapse
# to a single bare object.
_CLIP_ITEM = {
    "type": "object",
    "properties": {
        "start": {"type": "number"},
        "end": {"type": "number"},
        "title": {"type": "string"},
        "score": {"type": "number"},
        "hook_sentence": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["start", "end", "title", "score", "hook_sentence", "reason"],
}
_CLIPS_SCHEMA = {
    "type": "object",
    "properties": {"clips": {"type": "array", "items": _CLIP_ITEM}},
    "required": ["clips"],
}


# --------------------------------------------------------------------------- #
# Backends
# --------------------------------------------------------------------------- #
class ScorerBackend(abc.ABC):
    name = "base"

    @abc.abstractmethod
    def score(self, words: list[dict], n: int) -> list[dict]:
        ...


class OllamaScorer(ScorerBackend):
    name = "ollama"

    def score(self, words: list[dict], n: int) -> list[dict]:
        import ollama

        client = ollama.Client(host=settings.OLLAMA_HOST)
        prompt = learn.winners_prompt_block() + _PROMPT.format(
            n=n, mins=int(settings.MIN_CLIP_SEC), maxs=int(settings.MAX_CLIP_SEC),
            transcript=build_timed_transcript(words),
        )
        resp = client.chat(
            model=settings.OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
            format=_CLIPS_SCHEMA,
            options={"temperature": 0.4},
        )
        raw = resp["message"]["content"]
        return _normalize(_extract_json_array(raw), words)


class GeminiScorer(ScorerBackend):
    name = "gemini"

    def score(self, words: list[dict], n: int) -> list[dict]:
        import google.generativeai as genai

        if not settings.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY not set")
        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)
        prompt = learn.winners_prompt_block() + _PROMPT.format(
            n=n, mins=int(settings.MIN_CLIP_SEC), maxs=int(settings.MAX_CLIP_SEC),
            transcript=build_timed_transcript(words),
        )
        resp = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"},
        )
        return _normalize(_extract_json_array(resp.text), words)


class ClaudeScorer(ScorerBackend):
    """Claude (Anthropic) viral-moment picker — the smart brain. Same prompt as the others;
    Claude follows the 'return JSON' instruction well and the robust parser handles the rest."""
    name = "claude"

    def score(self, words: list[dict], n: int) -> list[dict]:
        from . import llm
        prompt = learn.winners_prompt_block() + _PROMPT.format(
            n=n, mins=int(settings.MIN_CLIP_SEC), maxs=int(settings.MAX_CLIP_SEC),
            transcript=build_timed_transcript(words),
        )
        raw = llm._claude_chat(prompt)
        return _normalize(_extract_json_array(raw), words)


class HeuristicScorer(ScorerBackend):
    """No-LLM fallback: split into evenly spaced ~40s windows on sentence-ish breaks."""
    name = "heuristic"

    def score(self, words: list[dict], n: int) -> list[dict]:
        if not words:
            return []
        total = words[-1]["end"] - words[0]["start"]
        target = max(settings.MIN_CLIP_SEC, min(settings.MAX_CLIP_SEC, 40))
        n = max(1, min(n, int(total // target) or 1))
        clips = []
        for i in range(n):
            start = words[0]["start"] + i * (total / n)
            clips.append({
                "start": start,
                "end": start + target,
                "title": f"Moment {i + 1}",
                "score": 50,
                "reason": "Evenly sampled (no LLM brain available).",
            })
        return _normalize(clips, words)


def get_backend(name: str) -> ScorerBackend:
    return {
        "claude": ClaudeScorer,
        "ollama": OllamaScorer,
        "gemini": GeminiScorer,
        "heuristic": HeuristicScorer,
    }.get(name, OllamaScorer)()


def _chunk_words(words: list[dict], chunk_sec: float = 1200, overlap_sec: float = 60):
    """Split a long transcript into ~20-min windows with 60s overlap so the LLM never
    gets an over-long context (which a 7B model can't handle)."""
    if not words:
        return [words]
    total = words[-1]["end"] - words[0]["start"]
    if total <= chunk_sec * 1.2:
        return [words]
    chunks, t0 = [], words[0]["start"]
    while t0 < words[-1]["end"]:
        t1 = t0 + chunk_sec
        chunk = [w for w in words if t0 - 0.01 <= w["start"] < t1]
        if chunk:
            chunks.append(chunk)
        t0 = t1 - overlap_sec
    return chunks


def find_moments(words: list[dict], brain: str, n: Optional[int] = None) -> list[dict]:
    """Run the chosen brain over (chunked) transcript; on any failure fall back to the
    heuristic so the pipeline always returns clips."""
    n = n or settings.TARGET_CLIP_COUNT
    try:
        backend = get_backend(brain)
        chunks = _chunk_words(words)
        all_clips: list[dict] = []
        for ch in chunks:
            all_clips.extend(backend.score(ch, n))
        merged = _dedupe(all_clips)  # cross-chunk de-overlap, highest score wins
        if merged:
            return merged
    except Exception as e:  # noqa: BLE001
        print(f"[brain] {brain} failed: {e}; using heuristic fallback")
    return HeuristicScorer().score(words, n)
