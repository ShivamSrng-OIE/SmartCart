import pytest

from backend.shop_mcp import STATE_CHANGING, ForbiddenToolError, ShopMCP, load_tools

# Unroutable URL: if any of the "no network" tests actually sent a request, it would fail.
OFFLINE = "http://127.0.0.1:9/"


@pytest.mark.parametrize("tool", ["complete_checkout", "complete_spend_request"])
async def test_complete_tools_forbidden(tool):
    for dry in (True, False):
        with pytest.raises(ForbiddenToolError):
            await ShopMCP(OFFLINE, dry_run=dry).call(tool, {"id": "x"})


@pytest.mark.parametrize("tool", sorted(STATE_CHANGING - {"complete_checkout", "complete_spend_request"}))
async def test_dry_run_intercepts_state_changing(tool):
    res = await ShopMCP(OFFLINE, dry_run=True).call(tool, {"a": 1})
    assert res == {"intercepted": True, "tool": tool, "arguments": {"a": 1}}


@pytest.mark.parametrize("tool", ["create_spend_request", "create_spend_permission"])
async def test_spend_always_intercepted(tool):
    res = await ShopMCP(OFFLINE, dry_run=False).call(tool, {"spend_request": {"amount": 40000}})
    assert res["intercepted"] is True


def test_tools_list_saved():
    names = {t["name"] for t in load_tools()}
    assert {"search_catalog", "get_product", "create_cart", "complete_checkout"} <= names


@pytest.mark.live
async def test_search_catalog_live():
    products = await ShopMCP().search_catalog("water bottle", limit=2)
    assert products and products[0]["variants"][0]["price"]["amount"] > 0
