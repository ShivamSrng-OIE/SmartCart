"""Shared google-genai plumbing for the firewall and Argon perception.

Clients are lazy, so importing backend modules never needs an API key (unit tests fake the
clients or the private call functions and never reach the network).

- client():      default client, used for the Interactions API (Argon, json_llm firewall).
- beta_client(): v1beta client, used for the Decisions API (per the official guide).
- content_blocks(media): the content-block shape both APIs take for media.
"""
from __future__ import annotations

import base64
import re
from pathlib import Path

from backend import config
from backend.schemas import Media

_client = None
_beta_client = None

# Media kind -> content block type. PDFs are "document" blocks.
_BLOCK_TYPE = {"image": "image", "audio": "audio", "video": "video", "pdf": "document"}


def _new_client(**kw):
    from google import genai

    if not config.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=config.GEMINI_API_KEY, **kw)


def client():
    global _client
    if _client is None:
        _client = _new_client()
    return _client


def beta_client():
    global _beta_client
    if _beta_client is None:
        _beta_client = _new_client(http_options={"api_version": "v1beta"})
    return _beta_client


def read_media(m: Media) -> bytes:
    """Raw bytes of one media file. Raises if missing: callers fail closed on that."""
    return Path(m.path).read_bytes()


def content_blocks(media: list[Media]) -> list[dict]:
    """One base64 content block per media file. Images go in at resolution="ultra_high"
    (the field is `resolution`, not `media_resolution`)."""
    blocks = []
    for m in media:
        block = {"type": _BLOCK_TYPE[m.kind], "data": base64.b64encode(read_media(m)).decode("ascii"),
                 "mime_type": m.mime}
        if m.kind == "image":
            block["resolution"] = "ultra_high"
        blocks.append(block)
    return blocks


_FENCE = re.compile(r"^\s*```(?:json)?\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)


def output_text(interaction) -> str:
    """The text of an Interactions API response (`.output_text`), minus any ```json fence.
    Raises if there is no text, so callers fail closed."""
    text = getattr(interaction, "output_text", None)
    if not isinstance(text, str) or not text.strip():
        raise ValueError("interaction returned no output_text")
    m = _FENCE.match(text)
    return m.group(1) if m else text
