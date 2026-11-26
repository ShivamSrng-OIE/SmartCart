"""Argon perception: raw untrusted media -> Claims JSON.

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

from pathlib import Path as _P

from app import config, gemini, scanner
from app.llm import settings as llm_settings
from app.schemas import Claims, Media

log = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "argon.md"
THINKING_LEVEL = "low"  # transcription and description, not deep reasoning
VIDEO_PROCESSING = "agentic"  # Argon scrubs video frames for hidden or flashed text


@lru_cache(maxsize=1)
def _prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _empty(notes: str) -> Claims:
    return Claims(visible_text=[], pack_count_claim=None, brand_claims=[], audio_transcript=None,
                  instructions_detected=False, notes=notes)


def _coerce(raw: dict, transcripts: dict[str, str]) -> dict:
    """Free models sometimes drop or mistype fields; fill the gaps so a near-miss is not a perception error."""
    def as_list(v):
        return [str(x) for x in v] if isinstance(v, list) else ([str(v)] if v else [])

    pack = raw.get("pack_count_claim")
    out = {"visible_text": as_list(raw.get("visible_text")), "brand_claims": as_list(raw.get("brand_claims")),
           "pack_count_claim": pack if isinstance(pack, int) and not isinstance(pack, bool) else None,
           "audio_transcript": raw.get("audio_transcript") if isinstance(raw.get("audio_transcript"), str) else None,
           "instructions_detected": bool(raw.get("instructions_detected")), "notes": str(raw.get("notes") or ""),
           "product_description": raw.get("product_description") if isinstance(raw.get("product_description"), str) else None}
    if not out["audio_transcript"] and transcripts:
        out["audio_transcript"] = chr(10).join(f"[{k}] {v}" for k, v in transcripts.items())
    return out


async def _call_openrouter(media: list[Media], prompt: str) -> dict:
    """Perception through the model chosen for the `perception` role: photos and sampled video frames go in
    as images, audio and voice-overs as transcripts from the `listener` role, listing text as labelled text."""
    from app.llm import api, media as llm_media

    parts, transcripts = await llm_media.build_parts(media)
    parts.append({"type": "text", "text": "Describe the attached untrusted media as Claims JSON."})
    raw, _model = await api.complete_json("perception", prompt, parts, Claims.model_json_schema(), timeout=120)
    return _coerce(raw if isinstance(raw, dict) else {}, transcripts)


async def _call_argon(media: list[Media], prompt: str) -> dict:
    """The only place that talks to a model for perception. Gemini: one Interactions API call with the
    Claims JSON schema as the response format, no tools (call shape: docs/api-notes.md). OpenRouter: see above."""
    if llm_settings.provider() == "openrouter":
        return await _call_openrouter(media, prompt)
    resp = await gemini.client().aio.interactions.create(
        model=config.MODELS["perception"],
        system_instruction=prompt,
        input=[*gemini.content_blocks(media, video_processing=VIDEO_PROCESSING),
               {"type": "text", "text": "Describe the attached untrusted media as Claims JSON.\n"}],
        response_format={"type": "text", "mime_type": "application/json",
                         "schema": Claims.model_json_schema()},
        generation_config={"thinking_level": THINKING_LEVEL},
    )
    return json.loads(gemini.output_text(resp))


def _with_scan(claims: Claims, media: list[Media]) -> Claims:
    """The rule scanner reads everything perception produced, plus the listing's own text. If it finds an
    instruction aimed at a shopping agent that the model missed, instructions_detected becomes True."""
    texts = {"photo text": chr(10).join(claims.visible_text), "audio": claims.audio_transcript}
    for m in media:
        if m.kind == "text":
            try:
                texts["listing"] = _P(m.path).read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass
    findings = scanner.scan_many(texts)
    if findings and not claims.instructions_detected:
        note = f"rule scan found {len(findings)} instruction(s) aimed at an agent: " + "; ".join(f.quote[:80] for f in findings[:2])
        return claims.model_copy(update={"instructions_detected": True, "notes": (claims.notes + " " + note).strip()})
    return claims


async def perceive(media: list[Media]) -> Claims:
    if not media:
        return _empty("no_media")
    try:
        raw = await _call_argon(media, _prompt())
        return _with_scan(Claims.model_validate(raw), media)
    except Exception as e:  # noqa: BLE001 - perception must never break the pipeline
        log.warning("argon perception failed: %s: %s", type(e).__name__, e)
        # The model could not read the media, but the rule scan still reads the listing's own text.
        return _with_scan(_empty("perception_error"), media)
