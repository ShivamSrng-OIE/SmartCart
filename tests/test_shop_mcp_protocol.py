"""Wire-level behaviour of ShopMCP against a fake server (httpx.MockTransport)."""
import json

import httpx
import pytest

from backend.shop_mcp import ShopMCP, ShopMCPError


def shop_with(handler) -> tuple[ShopMCP, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)
    return ShopMCP("https://fake.shop/", transport=httpx.MockTransport(wrapped)), seen


def ok(result: dict) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})


async def test_sends_required_headers_and_meta():
    shop, seen = shop_with(lambda r: ok({"structuredContent": {"products": []}}))
    await shop.search_catalog("mug", limit=3)
    req = seen[0]
    body = json.loads(req.content)
    assert req.headers["MCP-Protocol-Version"] == "2026-07-28"
    assert req.headers["Mcp-Method"] == "tools/call" and req.headers["Mcp-Name"] == "search_catalog"
    assert body["params"]["name"] == "search_catalog"
    assert body["params"]["arguments"] == {"catalog": {"query": "mug", "pagination": {"limit": 3}}}
    assert set(body["params"]["_meta"]) == {"io.modelcontextprotocol/protocolVersion",
                                            "io.modelcontextprotocol/clientCapabilities"}


async def test_falls_back_to_text_content():
    shop, _ = shop_with(lambda r: ok({"content": [{"type": "text", "text": '{"products": [{"id": "p1"}]}'}]}))
    assert (await shop.search_catalog("x"))[0]["id"] == "p1"


async def test_jsonrpc_error_raises():
    shop, _ = shop_with(lambda r: httpx.Response(400, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32602, "message": "bad"}}))
    with pytest.raises(ShopMCPError, match="bad"):
        await shop.get_product("gid://x")


async def test_tool_error_raises():
    shop, _ = shop_with(lambda r: ok({"isError": True, "content": [{"type": "text", "text": "no such product"}]}))
    with pytest.raises(ShopMCPError, match="no such product"):
        await shop.get_product("gid://x")


async def test_lookup_no_match_returns_none():
    shop, _ = shop_with(lambda r: ok({"structuredContent": {"products": []}}))
    assert await shop.lookup_catalog("https://example.com/nothing") is None


async def test_create_cart_builds_real_shop_args():
    shop, seen = shop_with(lambda r: ok({"structuredContent": {"id": "cart1", "continue_url": "https://x"}}))
    res = await shop.create_cart("s.myshopify.com", [{"variant_id": "gid://v/1", "quantity": 2}])
    args = json.loads(seen[0].content)["params"]["arguments"]
    assert res["continue_url"] == "https://x"
    assert args["shop"] == "s.myshopify.com" and args["meta"]["idempotency-key"]
    assert args["cart"]["line_items"] == [{"item": {"id": "gid://v/1"}, "quantity": 2}]


async def test_dry_run_still_sends_read_calls():
    shop, seen = shop_with(lambda r: ok({"structuredContent": {"products": []}}))
    shop.dry_run = True
    await shop.search_catalog("x")
    assert len(seen) == 1
