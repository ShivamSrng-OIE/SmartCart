"""Read-only proxy to Shopify's Shop MCP, for the storefront.

The browser cannot call mcp.shop.com directly (CORS, headers), and the frontend is deployed separately
from this API, so it posts its JSON-RPC calls here. Only read tools pass: anything that changes state
(carts, checkouts, spend requests, the complete_* tools) is refused, in line with the rule that the
frontend never moves money.
"""
from __future__ import annotations

import json

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from app import config
from app.shop_mcp import FORBIDDEN, PROTOCOL_VERSION, STATE_CHANGING

router = APIRouter()
READ_METHODS = {"tools/call", "tools/list", "initialize"}
MAX_BODY = 64 * 1024
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


@router.post("/shop-mcp")
async def shop_mcp(request: Request) -> Response:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "request too large")
    try:
        rpc = json.loads(raw)
        method = rpc["method"]
    except (ValueError, KeyError, TypeError):
        raise HTTPException(400, "not a JSON-RPC request")
    if method not in READ_METHODS:
        raise HTTPException(403, f"{method} is not allowed")
    tool = ((rpc.get("params") or {}).get("name")) if method == "tools/call" else None
    if tool and (tool in STATE_CHANGING or tool in FORBIDDEN):
        raise HTTPException(403, f"{tool} is not allowed from the storefront")
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
               "MCP-Protocol-Version": request.headers.get("mcp-protocol-version", PROTOCOL_VERSION),
               "Mcp-Method": method}
    if tool:
        headers["Mcp-Name"] = tool
    try:
        upstream = await _http().post(config.SHOP_MCP_URL, content=raw, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Shopify unreachable: {type(exc).__name__}")
    return Response(upstream.content, status_code=upstream.status_code,
                    media_type=upstream.headers.get("content-type", "application/json"))
