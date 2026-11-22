"""Marketplace trust: merchant scores, flagged listings and Carbon's analysis.

    GET  /api/trust            merchants (trust, status), recent incidents, Carbon's insights and actions
    POST /api/trust/briefing   a written briefing from the `carbon` model (falls back to a rules-based one)
    POST /api/trust/reset      start over: a visitor's session clears its own incidents; the shared ledger
                               (no session) needs the warehouse operator's sign-in
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from app.merchant_routes import current
from app.warehouse import carbon, reputation

router = APIRouter()


@router.get("/api/trust")
def trust():
    overview = reputation.overview()
    return {**overview, "analysis": carbon.analyze()}


@router.post("/api/trust/briefing")
async def briefing():
    return await carbon.narrate()


@router.post("/api/trust/reset")
def reset(authorization: str | None = Header(None)):
    if not reputation.SESSION.get():
        claims = current(authorization)
        if claims["role"] != "admin":
            raise HTTPException(403, "only the warehouse operator can reset reputation")
    reputation.reset()
    return {"reset": True}
