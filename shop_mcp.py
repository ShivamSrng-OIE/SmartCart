"""Thin client for Shopify's Shop MCP (https://mcp.shop.com/).

The server speaks stateless MCP 2026-07-28: every request needs the MCP-Protocol-Version and
Mcp-Method headers plus `_meta` in params. Tool arguments are nested objects
(`{"catalog": {...}}`, `{"shop": ..., "cart": {...}}`); see fixtures/shop/tools_list.json.
Money amounts are integer minor units (cents for USD).

Safety (non-negotiable):
- complete_checkout / complete_spend_request raise ForbiddenToolError, always.
- create_spend_request / create_spend_permission are always intercepted, never sent.
- dry_run=True (victim pane) intercepts every state-changing call after logging it.
"""
from __future__ import annotations

import json
import uuid
from itertools import count
from pathlib import Path

import httpx

from backend import config

PROTOCOL_VERSION = "2026-07-28"
TOOLS_LIST_PATH = Path(__file__).parent / "fixtures" / "shop" / "tools_list.json"

FORBIDDEN = {"complete_checkout", "complete_spend_request"}
ALWAYS_INTERCEPT = {"create_spend_request", "create_spend_permission"}
STATE_CHANGING = {
    "create_cart", "update_cart",
    "create_checkout", "update_checkout",
    "create_spend_request", "update_spend_request", "cancel_spend_request",
    "create_spend_permission",
} | FORBIDDEN


class ForbiddenToolError(Exception):
    """Raised for tools CartTrap must never call (they complete a real purchase)."""


class ShopMCPError(Exception):
    """The server returned a JSON-RPC error or a tool error."""


_ids = count(1)


class ShopMCP:
    def __init__(self, url: str = config.SHOP_MCP_URL, dry_run: bool = False, timeout: float = 30.0):
        self.url = url
        self.dry_run = dry_run
        self.timeout = timeout

    async def call(self, tool: str, args: dict) -> dict:
        if tool in FORBIDDEN:
            raise ForbiddenToolError(f"{tool} is forbidden in CartTrap")
        if tool in ALWAYS_INTERCEPT or (self.dry_run and tool in STATE_CHANGING):
            return {"intercepted": True, "tool": tool, "arguments": args}
        return await self._rpc("tools/call", {"name": tool, "arguments": args}, tool_name=tool)

    async def _rpc(self, method: str, params: dict, tool_name: str | None = None) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
            "Mcp-Method": method,
        }
        if tool_name:
            headers["Mcp-Name"] = tool_name
        params = {**params, "_meta": {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
        }}
        payload = {"jsonrpc": "2.0", "id": next(_ids), "method": method, "params": params}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(self.url, headers=headers, json=payload)
        body = r.json()
        if "error" in body:
            raise ShopMCPError(f"{method} {tool_name or ''}: {body['error']}")
        result = body["result"]
        if method != "tools/call":
            return result
        if result.get("isError"):
            raise ShopMCPError(f"{tool_name}: {result.get('content')}")
        if "structuredContent" in result:
            return result["structuredContent"]
        return json.loads(result["content"][0]["text"])

    # ---- convenience wrappers -------------------------------------------------

    async def search_catalog(self, query: str, limit: int = 5, **catalog: object) -> list[dict]:
        res = await self.call("search_catalog", {"catalog": {"query": query, "pagination": {"limit": limit}, **catalog}})
        return res.get("products", [])

    async def lookup_catalog(self, ref: str) -> dict | None:
        """ref = product/variant GID, GTIN/UPC or a public product URL. None if no match."""
        res = await self.call("lookup_catalog", {"catalog": {"ids": [ref]}})
        products = res.get("products", [])
        return products[0] if products else None

    async def get_product(self, product_id: str) -> dict:
        res = await self.call("get_product", {"catalog": {"id": product_id}})
        return res.get("product", res)

    async def create_cart(self, shop: str, lines: list[dict]) -> dict:
        """shop = variant["seller"]["domain"]; lines = [{"variant_id": gid, "quantity": n}]."""
        return await self.call("create_cart", {
            "shop": shop,
            "meta": {"idempotency-key": str(uuid.uuid4())},
            "cart": {"line_items": [{"item": {"id": l["variant_id"]}, "quantity": l["quantity"]} for l in lines]},
        })


def load_tools() -> list[dict]:
    """Tool definitions saved from tools/list (name, description, inputSchema)."""
    return json.loads(TOOLS_LIST_PATH.read_text(encoding="utf-8"))["result"]["tools"]
