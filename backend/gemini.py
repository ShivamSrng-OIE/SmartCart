"""Shared google-genai plumbing for the firewall and Argon perception.

Clients are lazy, so importing backend modules never needs an API key (unit tests fake the
clients or the private call functions and never reach the network).

- client():      default client, used for the Interactions API (Argon, json_llm firewall).
- beta_client(): v1beta client, used for the Decisions API (per the official guide).
- content_blocks(media): the content-block shape both APIs take for media.
"""
from __future__ import annotations

import base64
import functools
import io
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


@functools.lru_cache(maxsize=64)
def _downscaled_jpeg(path: str, mtime_ns: int, max_px: int) -> bytes | None:
    """JPEG bytes of the image with its long side cut to max_px, or None if already small enough.
    Cached on (path, mtime) so repeated firewall checks of the same photo don't re-encode it."""
    from PIL import Image

    with Image.open(path) as im:
        if max(im.size) <= max_px:
            return None
        im = im.convert("RGB")
        im.thumbnail((max_px, max_px), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=90)
        return buf.getvalue()


def _image_bytes(m: Media, max_px: int) -> tuple[bytes, str]:
    if max_px > 0:
        p = Path(m.path)
        mtime = p.stat().st_mtime_ns  # a missing file raises here; callers fail closed
        try:
            small = _downscaled_jpeg(str(p), mtime, max_px)
        except Exception:  # noqa: BLE001 - Pillow can't decode it: send the original bytes as is
            small = None
        if small is not None:
            return small, "image/jpeg"
    return read_media(m), m.mime


def content_blocks(media: list[Media], video_processing: str | None = None,
                   resolution: str = "ultra_high", max_px: int = 0) -> list[dict]:
    """One base64 content block per media file. Images go in at `resolution` (the field is
    `resolution`, not `media_resolution`); max_px > 0 downscales an image's long side first
    (re-encoded as JPEG). video_processing="agentic" lets the model scrub video frames (Argon
    only; the firewall keeps the fast default)."""
    blocks = []
    for m in media:
        data, mime = _image_bytes(m, max_px) if m.kind == "image" else (read_media(m), m.mime)
        if not mime or mime == "application/octet-stream":  # Gemini rejects octet-stream
            import mimetypes
            mime = mimetypes.guess_type(m.path)[0] or {"image": "image/png", "audio": "audio/wav",
                                                       "video": "video/mp4", "pdf": "application/pdf"}.get(m.kind, mime)
        block = {"type": _BLOCK_TYPE[m.kind], "data": base64.b64encode(data).decode("ascii"),
                 "mime_type": mime}
        if m.kind == "image":
            block["resolution"] = resolution
        if m.kind == "video" and video_processing:
            block["processing"] = video_processing
        blocks.append(block)
    return blocks


def firewall_content_blocks(media: list[Media]) -> list[dict]:
    """content_blocks with the firewall's image settings (config.FIREWALL_IMAGE_*)."""
    return content_blocks(media, resolution=config.FIREWALL_IMAGE_RESOLUTION,
                          max_px=config.FIREWALL_IMAGE_MAX_PX)


_FENCE = re.compile(r"^\s*```(?:json)?\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)


def output_text(interaction) -> str:
    """The text of an Interactions API response (`.output_text`), minus any ```json fence.
    Raises if there is no text, so callers fail closed."""
    text = getattr(interaction, "output_text", None)
    if not isinstance(text, str) or not text.strip():
        raise ValueError("interaction returned no output_text")
    m = _FENCE.match(text)
    return m.group(1) if m else text
