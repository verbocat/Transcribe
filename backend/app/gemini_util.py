"""Gemini call helper: retry on temporary overload, then fall back to neighbouring Flash models."""

import asyncio
import logging
import time

logger = logging.getLogger(__name__)

FALLBACK_MODELS = ("gemini-3.7-flash", "gemini-3.5-flash")
RETRIES_PER_MODEL = 2
_OVERLOAD_MARKERS = ("503", "unavailable", "high demand", "overloaded", "500", "504", "deadline", "429", "rate limit")


def is_overload(exc: Exception) -> bool:
    text = str(exc).lower()
    # A depleted-credits 402 also says RESOURCE_EXHAUSTED; that is not temporary
    if "402" in text or "prepayment" in text or "credits are depleted" in text:
        return False
    return any(m in text for m in _OVERLOAD_MARKERS)


def candidate_models(primary: str):
    seen, out = set(), []
    for m in (primary, *FALLBACK_MODELS):
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def generate_sync(client, primary: str, contents, config):
    last = None
    for model in candidate_models(primary):
        for attempt in range(RETRIES_PER_MODEL):
            try:
                return client.models.generate_content(model=model, contents=contents, config=config)
            except Exception as e:
                last = e
                if not is_overload(e):
                    raise
                time.sleep(2 * (attempt + 1))
        logger.warning(f"[Gemini] {model} overloaded, trying the next model")
    raise last


async def generate_async(client, primary: str, contents, config):
    last = None
    for model in candidate_models(primary):
        for attempt in range(RETRIES_PER_MODEL):
            try:
                return await client.aio.models.generate_content(model=model, contents=contents, config=config)
            except Exception as e:
                last = e
                if not is_overload(e):
                    raise
                await asyncio.sleep(2 * (attempt + 1))
        logger.warning(f"[Gemini] {model} overloaded, trying the next model")
    raise last
