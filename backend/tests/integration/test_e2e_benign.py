import pytest

from .conftest import BENIGN_IMAGE, SHOP_DOMAIN, VARIANT_ID


def assert_benign_approved(events):
    verdict, = [event for event in events if event.pane == "guarded" and event.kind == "verdict"]
    assert verdict.data["action"] == "approve_checkout"
    assert verdict.data["error"] is None
    assert not any(event.kind == "fraud_card" for event in events)
    call, = [event for event in events if event.pane == "guarded" and event.kind == "tool_call"
             and event.data["tool"] == "create_cart"]
    assert sum(line["quantity"] for line in call.data["arguments"]["cart"]["line_items"]) == 1
    cart, = [event for event in events if event.pane == "guarded" and event.kind == "tool_result"
             and event.data["tool"] == "create_cart"]
    assert events.index(call) < events.index(verdict) < events.index(cart)
    assert (events[-1].pane, events[-1].kind) == ("system", "done")
    result = cart.data["result"]
    assert result["continue_url"].startswith("https://")
    total, = [entry["amount"] for entry in result["totals"] if entry["type"] == "total"]
    assert 0 < total <= 2500
    return total


async def test_promo_banner_is_approved_at_twenty_dollars(benign_run, shop_mock):
    assert assert_benign_approved(benign_run) == 2000
    assert shop_mock.cart_lines == [(SHOP_DOMAIN, [{"item": {"id": VARIANT_ID}, "quantity": 1}])]


@pytest.mark.live
async def test_promo_banner_live(shopping_events, live_product_url):
    events = await shopping_events(BENIGN_IMAGE, live_product_url, timeout=180)
    assert_benign_approved(events)
