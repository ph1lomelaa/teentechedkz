from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def provider_chain() -> list[str]:
    chain: list[str] = []
    if settings.OPENAI_API_KEY:
        chain.append("openai")
    if settings.ANTHROPIC_API_KEY:
        chain.append("anthropic")
    return chain


async def _complete_openai(system: str, user_message: str) -> str:
    from openai import AsyncOpenAI  # type: ignore

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
        temperature=0.1,
        max_tokens=2500,
    )
    return response.choices[0].message.content or ""


async def _complete_anthropic(system: str, user_message: str) -> str:
    import anthropic  # type: ignore

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await client.messages.create(
        model="claude-3-5-sonnet-latest",
        max_tokens=2500,
        temperature=0.1,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )
    return "".join(block.text for block in response.content if hasattr(block, "text"))


async def complete_with_fallback(system: str, user_message: str) -> str:
    last_error: Exception | None = None
    for provider in provider_chain():
        try:
            if provider == "openai":
                return await _complete_openai(system, user_message)
            if provider == "anthropic":
                return await _complete_anthropic(system, user_message)
        except Exception as exc:  # pragma: no cover - provider specific
            last_error = exc
            logger.exception("AI provider %s failed", provider)
    if last_error:
        raise last_error
    raise RuntimeError("AI provider is not configured")


def json_block(text: str) -> dict:
    import json

    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            text = text.split("\n", 1)[1]
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start : end + 1])
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}
