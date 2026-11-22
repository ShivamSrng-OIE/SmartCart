"""Provider-neutral calls used by every agent role: JSON answers, plain text, transcription.

    provider()                       "gemini" | "openrouter" (Models page)
    model_for(role)                  the first-choice model for a role right now
    complete_json(role, system, parts, schema)  -> (dict, model that answered)
    complete_text(role, system, prompt)         -> (str, model that answered)
    transcribe_wav(wav_bytes)                   -> str

`parts` are OpenAI-style content parts ({"type": "text"} / {"type": "image_url"} with a data URL), which
app/llm/media.py builds; for Gemini they are converted to google-genai Parts. On OpenRouter every call walks the
role's ordered list of free models (settings.OPENROUTER_CHAINS), so a rate-limited or down model is skipped.
"""
from __future__ import annotations

import base64
import json

from app.llm import openrouter, settings
from app.llm.media import TRANSCRIBE_PROMPT

_last_good: dict[str, str] = {}  # role -> the model that answered last time: tried first next time


def provider() -> str:
    return settings.provider()


def model_for(role: str) -> str:
    return settings.model_for(role)


def key_missing() -> str | None:
    """A short message when the active provider has no API key, else None."""
    p = provider()
    if settings.api_key(p):
        return None
    name = "OPENROUTER_API_KEY" if p == "openrouter" else "GEMINI_API_KEY"
    return f"{name} is not set. Add it on the Models page or in backend/.env."


def _gemini_parts(parts: list[dict] | str):
    from google.genai import types

    if isinstance(parts, str):
        return [types.Part.from_text(text=parts)]
    out = []
    for p in parts:
        if p.get("type") == "text":
            out.append(types.Part.from_text(text=p["text"]))
        elif p.get("type") == "image_url":
            url = p["image_url"]["url"]
            header, b64 = url.split(",", 1)
            mime = header.removeprefix("data:").split(";")[0]
            out.append(types.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime))
        elif p.get("type") == "input_audio":
            out.append(types.Part.from_bytes(data=base64.b64decode(p["input_audio"]["data"]), mime_type="audio/wav"))
        elif p.get("type") == "file":
            header, b64 = p["file"]["file_data"].split(",", 1)
            out.append(types.Part.from_bytes(data=base64.b64decode(b64), mime_type=header.removeprefix("data:").split(";")[0]))
    return out


async def _gemini_generate(model: str, system: str, parts, *, json_out: bool, timeout: float):
    import asyncio

    from google.genai import types

    from app import gemini

    cfg = types.GenerateContentConfig(system_instruction=system or None,
                                      response_mime_type="application/json" if json_out else None)
    resp = await asyncio.wait_for(
        gemini.client().aio.models.generate_content(model=model, contents=_gemini_parts(parts), config=cfg),
        timeout=timeout)
    return resp.text or ""


async def _chain(role: str, messages: list[dict], **kw) -> tuple[dict, str]:
    msg, used = await openrouter.chat_chain(settings.models_for(role, "openrouter"), messages, prefer=_last_good.get(role), **kw)
    _last_good[role] = used
    return msg, used


async def _rested(exc: Exception) -> bool:
    """Every free OpenRouter model failed: rest OpenRouter and say whether to try Gemini instead."""
    return isinstance(exc, openrouter.OpenRouterError) and settings.rest_openrouter()


async def complete_json(role: str, system: str, parts: list[dict] | str, schema: dict | None = None,
                        timeout: float = 90.0) -> tuple[dict, str]:
    try:
        return await _complete_json(role, system, parts, schema, timeout)
    except openrouter.OpenRouterError as exc:
        if not await _rested(exc):
            raise
        return await _complete_json(role, system, parts, schema, timeout)


async def complete_text(role: str, system: str, prompt: str | list[dict], timeout: float = 90.0) -> tuple[str, str]:
    try:
        return await _complete_text(role, system, prompt, timeout)
    except openrouter.OpenRouterError as exc:
        if not await _rested(exc):
            raise
        return await _complete_text(role, system, prompt, timeout)


async def _complete_json(role: str, system: str, parts: list[dict] | str, schema: dict | None = None,
                         timeout: float = 90.0) -> tuple[dict, str]:
    if provider() == "gemini":
        model = model_for(role)
        text = await _gemini_generate(model, system, parts, json_out=True, timeout=timeout)
        return openrouter.extract_json(text), model
    content = [{"type": "text", "text": parts}] if isinstance(parts, str) else parts
    hint = ("\n\nReply with ONLY a JSON object" + (f" matching this JSON schema:\n{json.dumps(schema)}" if schema else "") + ".")
    msg, used = await _chain(role, [{"role": "system", "content": system + hint}, {"role": "user", "content": content}],
                             json_schema=schema, json_mode=schema is None, timeout=timeout)
    return openrouter.extract_json(openrouter.message_text(msg)), used


async def _complete_text(role: str, system: str, prompt: str | list[dict], timeout: float = 90.0) -> tuple[str, str]:
    if provider() == "gemini":
        model = model_for(role)
        return (await _gemini_generate(model, system, prompt, json_out=False, timeout=timeout)).strip(), model
    content = [{"type": "text", "text": prompt}] if isinstance(prompt, str) else prompt
    msg, used = await _chain(role, [{"role": "system", "content": system}, {"role": "user", "content": content}], timeout=timeout)
    return openrouter.message_text(msg).strip(), used


async def transcribe_wav(wav: bytes, timeout: float = 120.0) -> str:
    """Speech to text. On OpenRouter the only free model that accepts audio is tried first; if free audio is not
    available (it needs paid balance) and a Gemini key exists, Gemini transcribes it instead."""
    audio = {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav).decode("ascii"), "format": "wav"}}
    if provider() == "gemini":
        return await _gemini_generate(model_for("listener"), TRANSCRIBE_PROMPT, [audio], json_out=False, timeout=timeout)
    try:
        msg, _used = await _chain("listener", [{"role": "user", "content": [{"type": "text", "text": TRANSCRIBE_PROMPT}, audio]}],
                                  timeout=timeout, temperature=0.0)
        return openrouter._THINK.sub("", openrouter.message_text(msg)).strip().strip('"')
    except openrouter.OpenRouterError:
        if not settings.api_key("gemini"):
            raise
        return await _gemini_generate(settings.model_for("listener", "gemini"), TRANSCRIBE_PROMPT, [audio], json_out=False, timeout=timeout)
