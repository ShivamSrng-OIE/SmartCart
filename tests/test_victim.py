from types import SimpleNamespace

from google.genai import types

from backend.schemas import Intent
from backend.shop_mcp import ShopMCP
from backend.trace import TraceBus
from backend.victim_hydrogen import run_victim

PRODUCT = {"id": "gid://shopify/p/1", "title": "Bottle", "variants": [{
    "id": "gid://shopify/ProductVariant/9", "title": "Bottle 20oz", "price": {"amount": 1999, "currency": "USD"},
    "availability": {"available": True}, "seller": {"name": "Shop", "domain": "shop.myshopify.com"}, "options": []}]}


class FakeShop(ShopMCP):
    """Dry-run shop whose read calls return a canned product; any real network call would fail."""
    def __init__(self):
        super().__init__("http://127.0.0.1:9/", dry_run=True)
        self.sent: list[str] = []

    async def _rpc(self, method, params, tool_name=None):
        self.sent.append(tool_name)
        return {"products": [PRODUCT]}


class FakeModel:
    """Scripted Hydrogen: search, then a hijacked create_cart(qty 50), then stop."""
    def __init__(self, script):
        self.script = list(script)
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._gen))

    async def _gen(self, model, contents, config):
        step = self.script.pop(0)
        if step is None:
            return SimpleNamespace(function_calls=None, text="Done.", candidates=[])
        name, args = step
        fc = types.FunctionCall(name=name, args=args)
        return SimpleNamespace(function_calls=[fc], text=None,
                               candidates=[SimpleNamespace(content=types.Content(role="model", parts=[types.Part(function_call=fc)]))])


async def test_victim_emits_intercepted_on_state_change():
    bus, shop = TraceBus(), FakeShop()
    bus.start("r1")
    model = FakeModel([("search_catalog", {"query": "bottle"}),
                       ("create_cart", {"variant_id": "gid://shopify/ProductVariant/9", "quantity": 50}),
                       None])
    calls = await run_victim(Intent(text="buy one under $25", budget=25), [], None, bus, "r1", shop=shop, client=model)

    assert shop.sent == ["search_catalog"]  # create_cart never left the process
    intercepted = [e for e in bus.events("r1") if e.kind == "intercepted"]
    assert len(intercepted) == 1 and intercepted[0].data["tool"] == "create_cart"
    assert calls[0].arguments["shop"] == "shop.myshopify.com"
    assert calls[0].arguments["cart"]["line_items"][0]["quantity"] == 50


async def test_unknown_variant_is_reported_to_model_not_crash():
    bus, shop = TraceBus(), FakeShop()
    bus.start("r2")
    model = FakeModel([("create_cart", {"variant_id": "made-up", "quantity": 1}), None])
    calls = await run_victim(Intent(text="buy", budget=None), [], None, bus, "r2", shop=shop, client=model)
    assert calls == [] and shop.sent == []
