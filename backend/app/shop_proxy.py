"""Read-only proxy to Shopify's Shop MCP, for the storefront.

The browser cannot call mcp.shop.com directly (CORS, headers), and the frontend is deployed separately
from this API, so it posts its JSON-RPC calls here. Only read tools pass: anything that changes state
(carts, checkouts, spend requests, the complete_* tools) is refused, in line with the rule that the
frontend never moves money. The one exception is POST /api/checkout below: it starts a cart at a Shopify
store and returns the store's own checkout link, where the shopper pays with their own account.
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


# ---------------------------------------------------------------- start a checkout at a Shopify store
#
# The one state-changing call the storefront needs: put the shopper's lines in a cart *at the store* and hand
# back the store's own checkout link. The shopper signs in and pays there, with their own account; this API
# never completes a checkout, never sees payment details, and only accepts Shopify variant ids (the local
# marketplace's listings take no payment).

import re  # noqa: E402

from pydantic import BaseModel, Field  # noqa: E402

from app.shop_mcp import ShopMCP  # noqa: E402

SHOP_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")
VARIANT_PREFIX = "gid://shopify/ProductVariant/"


class CheckoutLine(BaseModel):
    variant_id: str = Field(max_length=120)
    quantity: int = Field(ge=1, le=20)


class CheckoutBody(BaseModel):
    shop: str = Field(max_length=200)
    lines: list[CheckoutLine] = Field(min_length=1, max_length=20)


@router.post("/api/checkout")
async def start_checkout(body: CheckoutBody):
    shop = body.shop.strip().lower()
    if not SHOP_RE.match(shop) or shop.endswith((".warehouse.local", ".example", ".local")):
        raise HTTPException(400, "that store doesn't take checkouts here")
    if any(not l.variant_id.startswith(VARIANT_PREFIX) for l in body.lines):
        raise HTTPException(400, "only Shopify products can be checked out")
    try:
        res = await ShopMCP().create_cart(shop, [{"variant_id": l.variant_id, "quantity": l.quantity} for l in body.lines])
    except Exception as exc:  # noqa: BLE001  (the error can carry a keyed URL: report the type only)
        raise HTTPException(502, f"the store didn't answer ({type(exc).__name__})") from None
    url = res.get("continue_url") or res.get("checkout_url")
    if not url:
        raise HTTPException(502, "the store didn't return a checkout link")
    return {"continue_url": url, "id": res.get("id") or res.get("checkout_id")}
