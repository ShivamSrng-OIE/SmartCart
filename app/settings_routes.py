"""Settings API: which provider (Gemini or OpenRouter) and model runs each agent.

    GET  /api/settings/llm              provider, models per role, which keys are set (never the keys)
    PUT  /api/settings/llm              {provider?, models?: {provider: {role: model}}}
    POST /api/settings/llm/key          {provider, key, persist?}
    GET  /api/settings/llm/models       ?provider=openrouter|gemini  models to pick from (free ones for OpenRouter)
    POST /api/settings/llm/test         {role} one tiny call with the role's current model

Changes are allowed from the machine running the server, or with an operator (admin) sign-in, so a deployed
backend cannot have its keys or models changed by a stranger.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel

from app.llm import api, openrouter, settings
from app.warehouse import auth

router = APIRouter()
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}
GEMINI_CHOICES = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]


def allow_write(request: Request, authorization: str | None) -> None:
    claims = auth.verify(auth.bearer(authorization))
    local = (request.client.host if request.client else "") in LOOPBACK
    if not (local or (claims and claims["role"] == "admin")):
        raise HTTPException(403, "sign in as the warehouse operator to change settings")


class Update(BaseModel):
    provider: str | None = None
    models: dict[str, dict[str, str]] | None = None


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
        return settings.update(body.provider, body.models)
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


@router.get("/api/settings/llm/models")
async def models(provider: str = Query("openrouter"), free_only: bool = True):
    if provider == "openrouter":
        return {"provider": provider, "models": await openrouter.list_models(free_only=free_only)}
    if provider == "gemini":
        known = sorted({*settings.DEFAULTS["gemini"].values(), *GEMINI_CHOICES})
        return {"provider": provider, "models": [{"id": m, "name": m, "input": ["text", "image", "audio", "video"], "tools": True, "json": True} for m in known]}
    raise HTTPException(422, "unknown provider")


@router.post("/api/settings/llm/test")
async def test_role(body: Test, request: Request, authorization: str | None = Header(None)):
    allow_write(request, authorization)
    if body.role not in settings.ROLE_IDS:
        raise HTTPException(422, "unknown role")
    model = api.model_for(body.role)
    if message := api.key_missing():
        return {"ok": False, "model": model, "provider": api.provider(), "error": message, "ms": 0}
    t0 = time.perf_counter()
    try:
        text, _ = await api.complete_text(body.role, "Reply with the single word OK.", "ping", timeout=60)
        return {"ok": True, "model": model, "provider": api.provider(), "ms": int((time.perf_counter() - t0) * 1000), "reply": text[:40]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "model": model, "provider": api.provider(), "ms": int((time.perf_counter() - t0) * 1000),
                "error": f"{type(exc).__name__}: {str(exc)[:200]}"}
