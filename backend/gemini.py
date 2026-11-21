"""Shared google-genai plumbing for the firewall (json_llm backend) and Argon perception.

Keeps the client lazy so importing backend modules never needs an API key (unit tests mock
the private call functions and never reach here).
"""
from __future__ import annotations

import base64
from pathlib import Path

from backend import config
from backend.schemas import Media

_client = None


def client():
    """One shared async-capable client. Use `client().aio...` from async code."""
    global _client
    if _client is None:
        from google import genai

        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not set")
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def read_media(m: Media) -> bytes:
    """Raw bytes of one media file. Raises if missing: callers fail closed on that."""
    return Path(m.path).read_bytes()


def b64(m: Media) -> str:
    return base64.b64encode(read_media(m)).decode("ascii")


def generate_content_parts(media: list[Media]) -> list:
    """google-genai Parts for generate_content. Images go in at ultra_high resolution."""
    from google.genai import types

    parts = []
    for m in media:
        res = types.PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH if m.kind == "image" else None
        parts.append(types.Part.from_bytes(data=read_media(m), mime_type=m.mime, media_resolution=res))
    return parts
