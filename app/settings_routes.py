"""Settings API: which provider (Gemini or OpenRouter) runs the agents. Models are fixed (best free ones per job).

    GET  /api/settings/llm              provider, the model(s) each job uses, which keys are set (never the keys)
    PUT  /api/settings/llm              {provider}
    POST /api/settings/llm/key          {provider, key, persist?}
    POST /api/settings/llm/test         {role} one tiny call for that job; says which model answered

Changes are allowed from the machine running the server, or with an operator (admin) sign-in, so a deployed
backend cannot have its keys or models changed by a stranger.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.llm import api, settings
from app.warehouse import auth

router = APIRouter()
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def allow_write(request: Request, authorization: str | None) -> None:
    claims = auth.verify(auth.bearer(authorization))
    local = (request.client.host if request.client else "") in LOOPBACK
    if not (local or (claims and claims["role"] == "admin")):
        raise HTTPException(403, "sign in as the warehouse operator to change settings")


class Update(BaseModel):
    provider: str


class Key(BaseModel):
    provider: str
    key: str
    persist: bool = False


class Test(BaseModel):
    role: str


@router.get("/api/settings/llm")
def get_settings():
    return settings.snapshot()


@router.put("/api/settings/llm")
def put_settings(body: Update, request: Request, authorization: str | None = Header(None)):
    allow_write(request, authorization)
    try:
        return settings.update(body.provider)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/api/settings/llm/key")
def put_key(body: Key, request: Request, authorization: str | None = Header(None)):
    allow_write(request, authorization)
    try:
        settings.set_key(body.provider, body.key, body.persist)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return settings.snapshot()


@router.post("/api/settings/llm/test")
async def test_role(body: Test, request: Request, authorization: str | None = Header(None)):
    """One tiny request for a job. On OpenRouter it walks that job's free models, so `model` is the one that
    actually answered (a rate-limited first choice is skipped)."""
    allow_write(request, authorization)
    if body.role not in settings.ROLE_IDS:
        raise HTTPException(422, "unknown role")
    if body.role == "listener" and api.provider() == "openrouter":
        return {"ok": False, "provider": "openrouter", "model": api.model_for("listener"), "ms": 0,
                "error": "Free OpenRouter models cannot take audio (it needs paid balance); Gemini transcribes audio when its key is set."
                         if not settings.api_key("gemini") else "Audio is transcribed by Gemini (free OpenRouter models cannot take audio)."}
    if message := api.key_missing():
        return {"ok": False, "model": api.model_for(body.role), "provider": api.provider(), "error": message, "ms": 0}
    t0 = time.perf_counter()
    try:
        text, used = await api.complete_text(body.role, "Reply with the single word OK.", "ping", timeout=75)
        return {"ok": True, "model": used, "provider": api.provider(), "ms": int((time.perf_counter() - t0) * 1000), "reply": text[:40]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "model": api.model_for(body.role), "provider": api.provider(), "ms": int((time.perf_counter() - t0) * 1000),
                "error": f"{type(exc).__name__}: {str(exc)[:200]}"}
