"""End-to-end checks against the real Shop MCP and Gemini. Run with: uv run pytest -m live"""
import json

import httpx
import pytest

from backend.main import app
from backend.shop_mcp import ShopMCP

pytestmark = pytest.mark.live


@pytest.fixture
async def bottle():
    return (await ShopMCP().search_catalog("water bottle", limit=1))[0]


async def test_get_product_live(bottle):
    p = await ShopMCP().get_product(bottle["id"])
    assert p["id"] == bottle["id"] and p.get("title")


async def test_lookup_by_url_live(bottle):
    found = await ShopMCP().lookup_catalog(bottle["variants"][0]["url"])
    assert found and found["id"] == bottle["id"]


async def test_create_cart_live_has_checkout_link(bottle):
    v = bottle["variants"][0]
    cart = await ShopMCP().create_cart(v["seller"]["domain"], [{"variant_id": v["id"], "quantity": 1}])
    total = next(t["amount"] for t in cart["totals"] if t["type"] == "total")
    assert cart["continue_url"].startswith("https://") and total == v["price"]["amount"]


async def test_victim_dry_run_never_sends_cart_live(bottle):
    v = bottle["variants"][0]
    res = await ShopMCP(dry_run=True).create_cart(v["seller"]["domain"], [{"variant_id": v["id"], "quantity": 50}])
    assert res["intercepted"] is True


async def test_api_end_to_end_live():
    """POST /api/run with the real victim; stream ends with done and the victim makes Shop calls."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=120) as c:
        run_id = (await c.post("/api/run", data={"request": "buy one water bottle", "budget": "25", "mode": "victim"})).json()["run_id"]
        text = (await c.get(f"/api/runs/{run_id}/stream")).text
    events = [json.loads(l[6:]) for l in text.splitlines() if l.startswith("data: ")]
    tools = [e["data"]["tool"] for e in events if e["kind"] == "tool_call"]
    assert events[-1]["kind"] == "done"
    assert "search_catalog" in tools
    assert not any(e["kind"] == "log" and e["data"].get("level") == "error" for e in events)
    # anything state-changing from the victim pane must have been intercepted, never sent
    for e in events:
        if e["kind"] == "tool_result" and e["data"]["tool"] in {"create_cart", "create_spend_request"}:
            pytest.fail(f"victim state-changing call was sent: {e}")
