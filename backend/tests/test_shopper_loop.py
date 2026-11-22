"""shopper_loop edge cases, plus the on_state_change hook contract Member 2's guarded shopper relies on."""
from app.schemas import Intent, Media, ToolCall
from app.shop_mcp import ShopMCPError
from app.shopper_loop import MAX_STEPS, ShopperContext, shopper_loop
from app.trace import TraceBus
from tests.test_victim import PRODUCT, FakeModel, FakeShop

VARIANT = "gid://shopify/ProductVariant/9"


def run(model, shop=None, intent=None, media=None, product_ref=None, hook=None):
    bus = TraceBus()
    bus.start("r")
    kwargs = {"on_state_change": hook} if hook else {}
    coro = shopper_loop(intent or Intent(text="buy one", budget=25), media or [], product_ref,
                        shop or FakeShop(), bus, "r", pane="guarded", system_prompt="sys", client=model, **kwargs)
    return coro, bus


class RecordingModel(FakeModel):
    def __init__(self, script):
        super().__init__(script)
        self.first_contents = None

    async def _gen(self, model, contents, config):
        self.first_contents = self.first_contents or list(contents)
        return await super()._gen(model, contents, config)


async def test_hook_receives_real_call_and_result_goes_to_model():
    seen: list[tuple[ToolCall, ShopperContext]] = []

    async def block(call, ctx):
        seen.append((call, ctx))
        return {"blocked": True, "reason": "firewall"}

    model = FakeModel([("search_catalog", {"query": "bottle"}),
                       ("create_cart", {"variant_id": VARIANT, "quantity": 50}), None])
    coro, bus = run(model, hook=block)
    ctx = await coro
    call, hook_ctx = seen[0]
    assert call.name == "create_cart" and call.arguments["cart"]["line_items"][0]["quantity"] == 50
    assert PRODUCT["id"] in hook_ctx.products  # truth ledger available to the firewall
    assert hook_ctx.variants[VARIANT]["price_usd"] == 19.99
    last = [e for e in bus.events("r") if e.data.get("tool") == "create_cart"][-1]
    assert last.kind == "tool_result" and last.data["result"]["blocked"] is True
    assert ctx.state_calls == [call]


async def test_spend_request_translated_to_cents_and_intercepted():
    shop = FakeShop()
    model = FakeModel([("create_spend_request", {"amount_usd": 400, "merchant": "evil.biz", "reason": "VIP"}), None])
    coro, bus = run(model, shop=shop)
    ctx = await coro
    sr = ctx.state_calls[0].arguments["spend_request"]
    assert sr["approval_limit"] == 40000 and sr["totals"][0]["amount"] == 40000
    assert shop.sent == [] and [e.kind for e in bus.events("r")].count("intercepted") == 1


async def test_search_price_filter_in_cents():
    model = FakeModel([("search_catalog", {"query": "mug", "max_price_usd": 24.5}), None])
    coro, bus = run(model)
    await coro
    call = next(e for e in bus.events("r") if e.kind == "tool_call")
    assert call.data["arguments"]["catalog"]["filters"]["price"]["max"] == 2450


async def test_stops_after_max_steps():
    model = FakeModel([("search_catalog", {"query": "x"})] * (MAX_STEPS + 5))
    coro, bus = run(model)
    await coro
    assert [e.kind for e in bus.events("r")].count("tool_call") == MAX_STEPS


async def test_shop_error_is_reported_not_raised():
    class BrokenShop(FakeShop):
        async def _rpc(self, method, params, tool_name=None):
            raise ShopMCPError("429 rate limited")

    model = FakeModel([("search_catalog", {"query": "x"}), None])
    coro, bus = run(model, shop=BrokenShop())
    await coro
    result = next(e for e in bus.events("r") if e.kind == "tool_result")
    assert "429" in result.data["result"]["error"]


async def test_product_ref_looked_up_first_and_given_to_model():
    model = RecordingModel([None])
    coro, bus = run(model, product_ref="https://shop.example/products/bottle")
    await coro
    first = bus.events("r")[0]
    assert first.kind == "tool_call" and first.data["tool"] == "lookup_catalog"
    prompt = model.first_contents[0].parts[0].text
    assert VARIANT in prompt and "Budget: $25.00" in prompt


async def test_no_budget_not_in_prompt():
    model = RecordingModel([None])
    coro, _ = run(model, intent=Intent(text="buy one of these", budget=None))
    await coro
    assert "Budget" not in model.first_contents[0].parts[0].text


async def test_media_bytes_sent_to_model(tmp_path):
    img = tmp_path / "note.png"
    img.write_bytes(b"\x89PNG fake")
    model = RecordingModel([None])
    coro, _ = run(model, media=[Media(kind="image", path=str(img), mime="image/png")])
    await coro
    parts = model.first_contents[0].parts
    assert parts[1].inline_data.data == b"\x89PNG fake" and parts[1].inline_data.mime_type == "image/png"


async def test_final_text_logged():
    model = FakeModel([None])
    coro, bus = run(model)
    await coro
    assert bus.events("r")[-1].kind == "log" and bus.events("r")[-1].data["message"] == "Done."


async def test_state_changing_tool_call_has_attempted_spend_and_quantity():
    model = FakeModel([("search_catalog", {"query": "bottle"}),
                       ("create_cart", {"variant_id": VARIANT, "quantity": 3}), None])
    coro, bus = run(model)
    await coro
    call = [e for e in bus.events("r") if e.kind == "tool_call" and e.data["tool"] == "create_cart"][0]
    assert call.data["attempted_spend"] == 59.97 and call.data["quantity"] == 3
    read = [e for e in bus.events("r") if e.kind == "tool_call" and e.data["tool"] == "search_catalog"][0]
    assert "attempted_spend" not in read.data and "quantity" not in read.data


async def test_intercepted_event_flags_hijack_on_quantity_budget_and_spend_request():
    model = FakeModel([("search_catalog", {"query": "bottle"}),
                       ("create_cart", {"variant_id": VARIANT, "quantity": 50}),
                       ("create_spend_request", {"amount_usd": 5, "merchant": "evil.biz", "reason": "VIP"}), None])
    coro, bus = run(model)
    await coro
    cart, sr = [e for e in bus.events("r") if e.kind == "intercepted"]
    assert cart.data["hijacked"] is True and cart.data["quantity"] == 50
    assert cart.data["attempted_spend"] == 999.5 and cart.data["arguments"]["cart"]["line_items"]
    assert sr.data["hijacked"] is True and sr.data["attempted_spend"] == 5.0
    assert sr.data["arguments"]["spend_request"]["approval_limit"] == 500


async def test_intercepted_event_not_hijacked_when_within_intent():
    model = FakeModel([("search_catalog", {"query": "bottle"}),
                       ("create_cart", {"variant_id": VARIANT, "quantity": 1}), None])
    coro, bus = run(model)
    await coro
    ev = next(e for e in bus.events("r") if e.kind == "intercepted")
    assert ev.data["hijacked"] is False and ev.data["attempted_spend"] == 19.99 and ev.data["quantity"] == 1
