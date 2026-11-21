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


# Created ONCE per process and reused: each client keeps its own HTTP connection pool, so
# reusing it saves the TLS handshake on every firewall call. Never create a client per call.

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


SLIM_ABOVE_BYTES = 300_000  # measured: a 1.1 MB PNG adds ~700 ms to a Decisions call vs ~125 KB JPEG
SLIM_JPEG_QUALITY = 92


def slim_image(data: bytes, mime: str) -> tuple[bytes, str]:
    """Re-encode a big lossless image (PNG) as a high-quality JPEG so the upload does not
    dominate firewall latency. Pixel size is unchanged, so small text stays legible. Returns the
    input untouched when it is small, not a PNG, or Pillow is missing or fails (never raises)."""
    if mime != "image/png" or len(data) <= SLIM_ABOVE_BYTES:
        return data, mime
    try:
        import io

        from PIL import Image
        img = Image.open(io.BytesIO(data))
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, "white")
            rgba = img.convert("RGBA")
            bg.paste(rgba, mask=rgba.getchannel("A"))
            img = bg
        else:
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, "JPEG", quality=SLIM_JPEG_QUALITY, optimize=True)
        return out.getvalue(), "image/jpeg"
    except Exception:  # noqa: BLE001 - optimisation only, fall back to the original bytes
        return data, mime


def content_blocks(media: list[Media], video_processing: str | None = None) -> list[dict]:
    """One base64 content block per media file. Images go in at resolution="ultra_high"
    (the field is `resolution`, not `media_resolution`). video_processing="agentic" lets the
    model scrub video frames (Argon only; the firewall keeps the fast default)."""
    blocks = []
    for m in media:
        data, mime = read_media(m), m.mime
        if m.kind == "image":
            data, mime = slim_image(data, mime)
        block = {"type": _BLOCK_TYPE[m.kind], "data": base64.b64encode(data).decode("ascii"),
                 "mime_type": mime}
        if m.kind == "image":
            block["resolution"] = "ultra_high"
        if m.kind == "video" and video_processing:
            block["processing"] = video_processing
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
