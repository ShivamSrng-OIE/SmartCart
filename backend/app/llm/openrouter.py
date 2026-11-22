"""OpenRouter chat-completions client (OpenAI-compatible) and its model catalogue.

Only free models are offered by default. Free endpoints are slow and rate limited (OpenRouter
allows 20 requests/minute and a daily cap), so every call retries 429/5xx with backoff, and
callers cache what they can (perception results are cached per file, see app/llm/media.py).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time

import httpx

from app.llm import settings

log = logging.getLogger(__name__)

BASE_URL = "https://openrouter.ai/api/v1"
FALLBACK_MODEL = "openrouter/free"  # OpenRouter's own router across free models
_HEADERS = {"HTTP-Referer": "http://localhost:5173", "X-Title": "CartTrap"}
_client: httpx.AsyncClient | None = None
_models_cache: tuple[float, list[dict]] | None = None
MODELS_TTL_S = 600

# Used when the model list can't be fetched (offline): the free models known to work for each role.
KNOWN_FREE = [
    {"id": "google/gemma-4-31b-it:free", "name": "Google: Gemma 4 31B", "input": ["image", "text", "video"], "tools": True, "json": True, "context": 262144},
    {"id": "google/gemma-4-26b-a4b-it:free", "name": "Google: Gemma 4 26B A4B", "input": ["image", "text", "video"], "tools": True, "json": True, "context": 262144},
    {"id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "name": "NVIDIA: Nemotron 3 Nano Omni", "input": ["text", "audio", "image", "video"], "tools": True, "json": False, "context": 256000},
    {"id": "nvidia/nemotron-3.5-super-vl:free", "name": "NVIDIA: Nemotron 3.5 Super VL", "input": ["text", "image", "video"], "tools": True, "json": True, "context": 1000000},
    {"id": "openrouter/free", "name": "OpenRouter: Free router", "input": ["text", "image"], "tools": True, "json": True, "context": 200000},
]


class OpenRouterError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(base_url=BASE_URL, timeout=httpx.Timeout(120.0, connect=15.0))
    return _client


def _summarize(m: dict) -> dict:
    arch = m.get("architecture") or {}
    params = set(m.get("supported_parameters") or [])
    return {
        "id": m["id"], "name": m.get("name") or m["id"],
        "input": sorted(arch.get("input_modalities") or ["text"]),
        "tools": "tools" in params,
        "json": bool({"response_format", "structured_outputs"} & params),
        "context": m.get("context_length"),
    }


def _is_free(m: dict) -> bool:
    pricing = m.get("pricing") or {}
    return m["id"].endswith(":free") or (str(pricing.get("prompt")) == "0" and str(pricing.get("completion")) == "0"
                                         and (m.get("architecture") or {}).get("output_modalities", ["text"]) == ["text"])


async def list_models(free_only: bool = True) -> list[dict]:
    """Model list with capabilities (cached 10 minutes). Falls back to KNOWN_FREE offline."""
    global _models_cache
    if _models_cache and time.monotonic() - _models_cache[0] < MODELS_TTL_S:
        models = _models_cache[1]
    else:
        try:
            r = await _http().get("/models", headers=_HEADERS, timeout=15.0)
            r.raise_for_status()
            models = r.json().get("data") or []
            _models_cache = (time.monotonic(), models)
        except Exception as exc:  # noqa: BLE001 - offline: offer the known free models
            log.warning("openrouter model list unavailable: %s", type(exc).__name__)
            return list(KNOWN_FREE)
    out = [_summarize(m) for m in models if not free_only or _is_free(m)]
    return [m for m in out if "text" in m["input"]] or list(KNOWN_FREE)


async def capabilities(model: str) -> dict:
    for m in await list_models(free_only=False):
        if m["id"] == model:
            return m
    return next((m for m in KNOWN_FREE if m["id"] == model),
                {"id": model, "input": ["text", "image"], "tools": True, "json": False})


def _retry_after(r: httpx.Response, attempt: int) -> float:
    try:
        return min(20.0, float(r.headers.get("retry-after", "")))
    except ValueError:
        return min(20.0, 2.0 * (2 ** attempt))


async def chat(model: str, messages: list[dict], *, tools: list[dict] | None = None,
               json_schema: dict | None = None, json_mode: bool = False, temperature: float = 0.2,
               max_tokens: int | None = None, timeout: float = 90.0, attempts: int = 3,
               allow_fallback: bool = True) -> dict:
    """One chat completion. Returns the assistant message dict ({content, tool_calls?}).

    Retries 429 / 5xx with backoff inside `timeout`. If the chosen model has no live free
    endpoint (404/400 "no endpoints"), retries once on OpenRouter's free router."""
    key = settings.api_key("openrouter")
    if not key:
        raise OpenRouterError("OPENROUTER_API_KEY is not set (add it on the Settings page or in backend/.env)")
    body: dict = {"model": model, "messages": messages, "temperature": temperature}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    if json_schema is not None:
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": "result", "strict": False, "schema": json_schema}}
    elif json_mode:
        body["response_format"] = {"type": "json_object"}
    if max_tokens:
        body["max_tokens"] = max_tokens
    headers = {**_HEADERS, "Authorization": f"Bearer {key}"}
    deadline = time.monotonic() + timeout
    last: OpenRouterError | None = None
    for attempt in range(attempts):
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            break
        try:
            r = await _http().post("/chat/completions", json=body, headers=headers, timeout=remaining)
        except httpx.TimeoutException as exc:
            raise OpenRouterError(f"{model} timed out") from exc
        except httpx.HTTPError as exc:
            last = OpenRouterError(f"network error: {type(exc).__name__}")
            await asyncio.sleep(min(2.0, max(0.0, deadline - time.monotonic() - 1)))
            continue
        data = _json_or_none(r)
        err = (data or {}).get("error") if isinstance(data, dict) else None
        if r.status_code == 200 and not err:
            choice = ((data or {}).get("choices") or [{}])[0]
            msg = choice.get("message") or {}
            if choice.get("error"):
                last = OpenRouterError(f"{model}: {choice['error'].get('message', 'provider error')}")
            elif msg.get("content") is None and not msg.get("tool_calls"):
                last = OpenRouterError(f"{model} returned an empty message")
            else:
                return msg
        else:
            status = (err or {}).get("code") if isinstance((err or {}).get("code"), int) else r.status_code
            message = (err or {}).get("message") or r.text[:200]
            last = OpenRouterError(f"{model}: HTTP {status} {message}"[:300], status=status)
            unsupported = status in (400, 404) and re.search(r"no endpoints|not a valid model|not found|unavailable", str(message), re.I)
            if unsupported and allow_fallback and model != FALLBACK_MODEL:
                log.warning("openrouter model %s unavailable, using %s", model, FALLBACK_MODEL)
                return await chat(FALLBACK_MODEL, messages, tools=tools, json_schema=json_schema, json_mode=json_mode,
                                  temperature=temperature, max_tokens=max_tokens,
                                  timeout=max(5.0, deadline - time.monotonic()), attempts=2, allow_fallback=False)
            if status in (401, 402, 403):
                break  # bad key / no credit: retrying won't help
            if json_schema is not None and status == 400 and attempt == 0:
                body.pop("response_format", None)  # some free endpoints reject structured output
                continue
        wait = _retry_after(r, attempt) if r.status_code == 429 else 1.5 * (attempt + 1)
        await asyncio.sleep(max(0.0, min(wait, deadline - time.monotonic() - 1)))
    raise last or OpenRouterError(f"{model} gave no answer in {timeout:.0f}s")


def _json_or_none(r: httpx.Response):
    try:
        return r.json()
    except ValueError:
        return None


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def extract_json(text: str | None):
    """The first JSON object (or array) in a model reply: tolerates ```json fences, <think>
    blocks and chatter around the JSON. Raises ValueError if there is none."""
    if not text:
        raise ValueError("empty reply")
    text = _THINK.sub("", text).strip()
    for candidate in [m.group(1) for m in _FENCE.finditer(text)] + [text]:
        candidate = candidate.strip()
        try:
            return json.loads(candidate)
        except ValueError:
            pass
        start = min((i for i in (candidate.find("{"), candidate.find("[")) if i >= 0), default=-1)
        if start < 0:
            continue
        decoder = json.JSONDecoder()
        for i in range(start, len(candidate)):
            if candidate[i] in "{[":
                try:
                    obj, _ = decoder.raw_decode(candidate[i:])
                    return obj
                except ValueError:
                    continue
    raise ValueError("no JSON object in reply")


def message_text(msg: dict) -> str:
    content = msg.get("content")
    if isinstance(content, list):  # some providers return content parts
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content or ""
