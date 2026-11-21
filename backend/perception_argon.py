"""Argon perception: raw untrusted media -> Claims JSON (plan.md Task 8).

Argon has NO tools. Its output is untrusted data: other models get it only as quoted data
(see firewall_decisions._context_text), never as instructions.

    async perceive(media: list[Media]) -> Claims

Never raises (except on cancellation): any error or malformed output returns empty Claims with
notes="perception_error". The firewall still sees the raw media, so a perception failure does
not open a hole; it only removes the extra hints.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from backend import config, gemini
from backend.schemas import Claims, Media

log = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "argon.md"


@lru_cache(maxsize=1)
def _prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _empty(notes: str) -> Claims:
    return Claims(visible_text=[], pack_count_claim=None, brand_claims=[], audio_transcript=None,
                  instructions_detected=False, notes=notes)


async def _call_argon(media: list[Media], prompt: str) -> dict:
    """The only place that talks to Gemini for perception. Structured output with the Claims
    schema; no tools are passed. Not yet verified against the live API (docs/notes-apis.md)."""
    from google.genai import types

    resp = await gemini.client().aio.models.generate_content(
        model=config.MODELS["perception"],
        contents=[*gemini.generate_content_parts(media),
                  "Describe the attached untrusted media as Claims JSON."],
        config=types.GenerateContentConfig(
            system_instruction=prompt,
            temperature=0,
            response_mime_type="application/json",
            response_schema=Claims,
        ),
    )
    return json.loads(resp.text)


async def perceive(media: list[Media]) -> Claims:
    if not media:
        return _empty("no_media")
    try:
        raw = await _call_argon(media, _prompt())
        return Claims.model_validate(raw)
    except Exception as e:  # noqa: BLE001 - perception must never break the pipeline
        log.warning("argon perception failed: %s: %s", type(e).__name__, e)
        return _empty("perception_error")
