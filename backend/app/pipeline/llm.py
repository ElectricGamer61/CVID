"""Shared LLM dispatch — one place both ai.py (Script Factory / Hook Forge) and effects.py
(AI auto-effects) call. Tries the preferred brain, then the other; raises if none work.

qwen3-family models can emit a <think>...</think> reasoning preamble — `strip_think` removes it
so JSON/array parsing downstream stays robust.
"""
from __future__ import annotations

import re

import settings


def _ollama_chat(prompt: str, temperature: float = 0.7) -> str:
    import ollama
    client = ollama.Client(host=settings.OLLAMA_HOST)
    resp = client.chat(model=settings.OLLAMA_MODEL,
                       messages=[{"role": "user", "content": prompt}],
                       options={"temperature": temperature})
    return resp["message"]["content"]


def _gemini_chat(prompt: str) -> str:
    import google.generativeai as genai
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")
    genai.configure(api_key=settings.GEMINI_API_KEY)
    return genai.GenerativeModel(settings.GEMINI_MODEL).generate_content(prompt).text


def _claude_chat(prompt: str, temperature: float = 0.7) -> str:
    """Claude (Anthropic) via the official SDK — the smart brain for scripts/hooks/moments.
    `temperature` is accepted for a uniform signature but NOT forwarded: Opus 4.8/4.7 reject
    sampling params with a 400. Adaptive thinking is on for better planning; only the final
    text blocks are returned."""
    import anthropic
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    resp = client.messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def strip_think(text: str) -> str:
    """Drop a leading <think>...</think> block (qwen3 reasoning) and stray fences."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    return text.strip()


def llm_text(prompt: str, brain: str | None = None, temperature: float = 0.7) -> str:
    """Try the preferred brain, then the other, raising if none work. Reasoning preamble stripped."""
    brain = brain or settings.DEFAULT_BRAIN
    order = [brain] + [b for b in ("claude", "ollama", "gemini") if b != brain]
    last: Exception | None = None
    for b in order:
        try:
            if b == "claude":
                return strip_think(_claude_chat(prompt, temperature))
            if b == "ollama":
                return strip_think(_ollama_chat(prompt, temperature))
            if b == "gemini":
                return strip_think(_gemini_chat(prompt))
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"no LLM available ({last})")
