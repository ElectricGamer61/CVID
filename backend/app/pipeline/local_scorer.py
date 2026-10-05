"""The built-in moment finder: picks and scores clips from the transcript with no AI service.

This is what every install without an API key (and without Ollama) uses, so it has to
produce clips a person would actually choose - not six evenly spaced windows called
"Moment 1" to "Moment 6". It is deterministic, instant, and offline.

How it works
  1. Split the transcript into sentences (on . ! ?; falling back to pauses / word counts
     when a transcriber gave no punctuation).
  2. Every sentence start opens a candidate; it closes at the sentence boundary nearest a
     short (~30 s) and a long (~50 s) target, inside [MIN_CLIP_SEC, MAX_CLIP_SEC].
  3. Each candidate is scored on the same signals an editor looks for: a scroll-stopping
     opening line (question, "the truth is", "nobody tells you", a number, emotion), emotional
     language through the body, talking to the viewer, punchy sentences, a natural speaking
     pace, and a complete ending. Intros and outros are penalised.
  4. The best non-overlapping candidates win. Titles come from each clip's own opening words,
     the hook is its first sentence, and the reason names the signals that fired.

Scores are 0-100 like the AI finders, spread so the ranking is visible (top picks land in
the high 80s / low 90s, weak ones in the 50s). They are relative within one video.
"""
from __future__ import annotations

import re

import settings

# --- lexicons --------------------------------------------------------------------------
_HOOK_OPENERS = re.compile(
    r"^\W*(why|how|what|when|who|which|where|imagine|stop|never|here'?s|here is|listen|"
    r"the truth|truth is|nobody|no one|most people|everyone|everybody|if you|you need|"
    r"you have to|you should|the (biggest|best|worst|only|one|real|secret)|secret|mistake|"
    r"i (was|got|never|had|lost|quit|failed|learned|realized|realised|made)|let me tell you|"
    r"this is (why|how|what)|there'?s (one|a) thing)\b", re.I)
_EMOTION = {
    "love", "loved", "hate", "hated", "fear", "afraid", "scared", "terrified", "died", "death",
    "dying", "fired", "failed", "failure", "fail", "success", "successful", "money", "rich",
    "poor", "broke", "free", "truth", "lie", "lied", "lies", "secret", "secrets", "mistake",
    "mistakes", "crazy", "insane", "wild", "amazing", "incredible", "terrible", "awful",
    "best", "worst", "biggest", "hardest", "pain", "painful", "dream", "dreams", "hope",
    "lost", "win", "won", "lose", "losing", "shocked", "shocking", "honest", "honestly",
    "regret", "proud", "cry", "cried", "angry", "furious", "happy", "happiest", "miracle",
    "dangerous", "warning", "nobody", "everything", "nothing", "forever", "never",
}
_CONTRAST = {"but", "actually", "instead", "however", "except", "until", "because", "yet"}
_SECOND_PERSON = {"you", "your", "you're", "yourself", "you'll", "you've"}
_NUMBER = re.compile(r"\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|"
                     r"thousand|million|billion|percent|half|double|triple)\b", re.I)
_SENTENCE_END = (".", "!", "?")
# Lower-cased inside a title (never as its first word): articles, conjunctions, short
# prepositions. Pronouns stay capitalised - "You Guys So We Have" reads as a title,
# "You Guys so we Have" reads as a typo.
_STOPWORDS = {"the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
              "with", "as", "by", "from"}


def _norm(word: str) -> str:
    return re.sub(r"[^a-z0-9']", "", word.lower())


# --- sentences -------------------------------------------------------------------------
def split_sentences(words: list[dict]) -> list[dict]:
    """[{start, end, text, n}] in order. Falls back to pauses (>0.6 s) or 14-word runs when
    the transcript has little punctuation, so unpunctuated transcribers still get clips."""
    if not words:
        return []
    punct = sum(1 for w in words if w["word"].strip().endswith(_SENTENCE_END))
    use_punct = punct >= max(3, len(words) // 40)
    out: list[dict] = []
    cur: list[dict] = []

    def flush():
        if cur:
            out.append({"start": cur[0]["start"], "end": cur[-1]["end"],
                        "text": " ".join(w["word"].strip() for w in cur), "n": len(cur)})
            cur.clear()

    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        if use_punct:
            if w["word"].strip().endswith(_SENTENCE_END) or (nxt and nxt["start"] - w["end"] > 1.2):
                flush()
        else:
            if len(cur) >= 14 or (nxt and nxt["start"] - w["end"] > 0.6):
                flush()
    flush()
    return out


# --- scoring ---------------------------------------------------------------------------
def _features(sentences: list[dict], video_start: float, video_end: float) -> tuple[float, list[str]]:
    """(0..1 quality, [signal labels]) for one candidate made of these sentences."""
    first = sentences[0]["text"]
    first_words = [_norm(w) for w in first.split()]
    all_text = " ".join(s["text"] for s in sentences)
    all_words = [_norm(w) for w in all_text.split() if _norm(w)]
    n_words = max(1, len(all_words))
    duration = max(0.1, sentences[-1]["end"] - sentences[0]["start"])
    signals: list[str] = []

    # Hook: the first sentence has to stop the scroll.
    hook = 0.0
    if first.strip().endswith("?"):
        hook += 0.45; signals.append("opens with a question")
    if _HOOK_OPENERS.search(first):
        hook += 0.35; signals.append("strong opening line")
    if _NUMBER.search(first):
        hook += 0.15; signals.append("a number up front")
    if any(w in _EMOTION for w in first_words):
        hook += 0.2; signals.append("emotional opening")
    if any(w in _SECOND_PERSON for w in first_words):
        hook += 0.1
    hook = min(1.0, hook)

    # Body: emotional language, numbers, contrast, talking to the viewer.
    emo = sum(1 for w in all_words if w in _EMOTION)
    body = min(1.0, emo / n_words * 25)
    if emo >= 2 and "emotional opening" not in signals:
        signals.append("emotional language")
    if _NUMBER.search(all_text) and "a number up front" not in signals:
        body = min(1.0, body + 0.2); signals.append("mentions a number")
    if any(w in _CONTRAST for w in all_words):
        body = min(1.0, body + 0.1)
    you = sum(1 for w in all_words if w in _SECOND_PERSON)
    if you / n_words > 0.03:
        body = min(1.0, body + 0.15); signals.append("talks to the viewer")

    # Rhythm: natural speaking pace, punchy sentences.
    wps = n_words / duration
    rhythm = 1.0 if 2.0 <= wps <= 3.6 else max(0.0, 1.0 - abs(wps - 2.8) / 2.8)
    if rhythm >= 0.9:
        signals.append("good pace")
    short = sum(1 for s in sentences if s["n"] <= 12)
    punch = short / len(sentences)
    if punch >= 0.5 and len(sentences) >= 2:
        signals.append("punchy sentences")

    complete = 1.0 if sentences[-1]["text"].strip().endswith(_SENTENCE_END) else 0.6

    total = 0.40 * hook + 0.25 * body + 0.15 * rhythm + 0.10 * punch + 0.10 * complete
    # Intros and outros rarely stand alone.
    span = max(1.0, video_end - video_start)
    rel_start = (sentences[0]["start"] - video_start) / span
    rel_end = (sentences[-1]["end"] - video_start) / span
    if rel_start < 0.03:
        total -= 0.15
    elif rel_end > 0.97:
        total -= 0.08
    return max(0.0, min(1.0, total)), signals


def _title(text: str, max_words: int = 6) -> str:
    words = [w.strip("\"'.,!?;:()[]") for w in text.split()]
    words = [w for w in words if w]
    if not words:
        return "Untitled moment"
    head = words[:max_words]
    out = []
    for i, w in enumerate(head):
        low = w.lower()
        out.append(w if (w.isupper() and len(w) > 1) else
                   (low if (i > 0 and low in _STOPWORDS and low != "i") else w[:1].upper() + w[1:]))
    return " ".join(out)


def pick_moments(words: list[dict], n: int) -> list[dict]:
    """Candidates for brain._normalize: [{start, end, title, score, hook_sentence, reason}]."""
    sentences = split_sentences(words)
    if not sentences:
        return []
    video_start, video_end = words[0]["start"], words[-1]["end"]
    lo, hi = settings.MIN_CLIP_SEC, settings.MAX_CLIP_SEC
    targets = (min(hi, max(lo, 30.0)), min(hi, max(lo, 50.0)))
    candidates: list[dict] = []
    for i in range(len(sentences)):
        seen_ends: set[int] = set()
        for target in targets:
            best_j, best_gap = None, None
            for j in range(i, len(sentences)):
                dur = sentences[j]["end"] - sentences[i]["start"]
                if dur > hi:
                    break
                if dur < lo:
                    continue
                gap = abs(dur - target)
                if best_gap is None or gap < best_gap:
                    best_j, best_gap = j, gap
            if best_j is None or best_j in seen_ends:
                continue
            seen_ends.add(best_j)
            chunk = sentences[i:best_j + 1]
            quality, signals = _features(chunk, video_start, video_end)
            reason = ("Built-in finder: " + ", ".join(signals[:4]) + ".") if signals else \
                     "Built-in finder: a complete thought at a natural pace."
            candidates.append({
                "start": chunk[0]["start"], "end": chunk[-1]["end"],
                "title": _title(chunk[0]["text"]),
                "score": round(55 + 40 * quality, 1),
                "hook_sentence": chunk[0]["text"][:200],
                "reason": reason,
                "_q": quality,
            })
    if not candidates:
        # Whole video shorter than MIN_CLIP_SEC: one clip of all of it.
        quality, signals = _features(sentences, video_start, video_end)
        return [{"start": video_start, "end": video_end, "title": _title(sentences[0]["text"]),
                 "score": round(55 + 40 * quality, 1), "hook_sentence": sentences[0]["text"][:200],
                 "reason": "Built-in finder: the whole video (shorter than one clip)."}]
    # Greedy non-overlapping pick, best first; leave the final clamp/snap to _normalize.
    candidates.sort(key=lambda c: c["_q"], reverse=True)
    chosen: list[dict] = []
    for c in candidates:
        if all(min(c["end"], k["end"]) - max(c["start"], k["start"]) <= 0.25 * (c["end"] - c["start"])
               for k in chosen):
            chosen.append(c)
        if len(chosen) >= n:
            break
    for c in chosen:
        c.pop("_q", None)
    chosen.sort(key=lambda c: c["start"])
    return chosen
