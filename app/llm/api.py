"""Provider-neutral calls used by every agent role: JSON answers, plain text, transcription.

    provider()                       "gemini" | "openrouter" (Settings page)
    model_for(role)                  the model that runs a role right now
    complete_json(role, system, parts, schema)  -> (dict, model)
    complete_text(role, system, prompt)         -> (str, model)
    transcribe_wav(wav_bytes)                   -> str

`parts` are OpenAI-style content parts ({"type": "text"} / {"type": "image_url"} with a data URL),
which app/llm/media.py builds; for Gemini they are converted to google-genai Parts.
"""
from __future__ import annotations

import base64
import json

from app.llm import openrouter, settings
from app.llm.media import TRANSCRIBE_PROMPT


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
    return f"{name} is not set. Add it on the Settings page or in backend/.env."


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


async def complete_json(role: str, system: str, parts: list[dict] | str, schema: dict | None = None,
                        timeout: float = 90.0) -> tuple[dict, str]:
    model = model_for(role)
    if provider() == "gemini":
        text = await _gemini_generate(model, system, parts, json_out=True, timeout=timeout)
        return openrouter.extract_json(text), model
    content = [{"type": "text", "text": parts}] if isinstance(parts, str) else parts
    caps = await openrouter.capabilities(model)
    hint = ("\n\nReply with ONLY a JSON object" + (f" matching this JSON schema:\n{json.dumps(schema)}" if schema else "") + ".")
    msg = await openrouter.chat(model, [{"role": "system", "content": system + hint}, {"role": "user", "content": content}],
                                json_schema=schema if (schema and caps.get("json")) else None,
                                json_mode=bool(caps.get("json")) and not schema, timeout=timeout)
    return openrouter.extract_json(openrouter.message_text(msg)), model


async def complete_text(role: str, system: str, prompt: str | list[dict], timeout: float = 90.0) -> tuple[str, str]:
    model = model_for(role)
    if provider() == "gemini":
        return (await _gemini_generate(model, system, prompt, json_out=False, timeout=timeout)).strip(), model
    content = [{"type": "text", "text": prompt}] if isinstance(prompt, str) else prompt
    msg = await openrouter.chat(model, [{"role": "system", "content": system}, {"role": "user", "content": content}],
                                timeout=timeout)
    return openrouter.message_text(msg).strip(), model


async def transcribe_wav(wav: bytes, timeout: float = 120.0) -> str:
    model = model_for("listener")
    audio = {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav).decode("ascii"), "format": "wav"}}
    if provider() == "gemini":
        return await _gemini_generate(model, TRANSCRIBE_PROMPT, [audio], json_out=False, timeout=timeout)
    msg = await openrouter.chat(model, [{"role": "user", "content": [{"type": "text", "text": TRANSCRIBE_PROMPT}, audio]}],
                                timeout=timeout, temperature=0.0)
    text = openrouter.message_text(msg)
    return openrouter._THINK.sub("", text).strip().strip('"')
