"""Shared LLM dispatch — one place both ai.py (Script Factory / Hook Forge) and effects.py
(AI auto-effects) call. Tries the preferred brain, then the other; raises if none work.

qwen3-family models can emit a <think>...</think> reasoning preamble — `strip_think` removes it
so JSON/array parsing downstream stays robust.
"""
from __future__ import annotations

import os
import re

import settings


# Hard ceilings for a local model. A "thinking" model (qwen3 / qwen3.5) that is handed a JSON
# schema can reason for tens of thousands of tokens before it answers - the project row sat on
# "Finding moments" for a quarter of an hour while Ollama was at 16,000 generated tokens and
# climbing - and the official client waits forever by default. Think mode is switched off,
# generation is capped and the request times out, so the worst case is a clean fallback.
OLLAMA_MAX_TOKENS = int(os.getenv("CVIDEO_OLLAMA_MAX_TOKENS", "4096"))
OLLAMA_TIMEOUT_SEC = float(os.getenv("CVIDEO_OLLAMA_TIMEOUT_SEC", "600"))


def ollama_chat(prompt: str, temperature: float = 0.7, schema: dict | None = None,
                num_predict: int | None = None) -> str:
    """One chat turn against the local Ollama server, returning the reply text.

    Plain HTTP via `requests` (already a core dependency) rather than the `ollama` package:
    the bare laptop install does not ship that package, so importing it made the local brain
    fail on exactly the machines it was meant to serve. `schema` switches on Ollama's
    structured output; unknown fields are ignored by older servers."""
    import requests

    body = {
        "model": settings.OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "think": False,
        "options": {"temperature": temperature,
                    "num_predict": int(num_predict or OLLAMA_MAX_TOKENS)},
    }
    if schema is not None:
        body["format"] = schema
    resp = requests.post(settings.OLLAMA_HOST.rstrip("/") + "/api/chat", json=body,
                         timeout=(5, OLLAMA_TIMEOUT_SEC))
    resp.raise_for_status()
    data = resp.json()
    return str((data.get("message") or {}).get("content") or "")


def _ollama_chat(prompt: str, temperature: float = 0.7) -> str:
    return ollama_chat(prompt, temperature)


def _gemini_chat(prompt: str) -> str:
    import google.generativeai as genai
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")
    genai.configure(api_key=settings.GEMINI_API_KEY)
    return genai.GenerativeModel(settings.GEMINI_MODEL).generate_content(prompt).text


def _openai_chat(prompt: str, temperature: float = 0.7) -> str:
    """OpenAI (GPT) via the official SDK. Model is CVIDEO_OPENAI_MODEL (default gpt-4o-mini)."""
    from openai import OpenAI
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
    )
    return resp.choices[0].message.content or ""


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
    order = [brain] + [b for b in ("claude", "openai", "ollama", "gemini") if b != brain]
    last: Exception | None = None
    for b in order:
        try:
            if b == "claude":
                return strip_think(_claude_chat(prompt, temperature))
            if b == "openai":
                return strip_think(_openai_chat(prompt, temperature))
            if b == "ollama":
                return strip_think(_ollama_chat(prompt, temperature))
            if b == "gemini":
                return strip_think(_gemini_chat(prompt))
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"no LLM available ({last})")
