"""Task 9: guarded shopper (contract C7). Fakes only, no network: scripted Hydrogen, a fake live
shop, and monkeypatched perceive / decide / match_product."""
import asyncio
import time
from pathlib import Path

import pytest

from backend import guarded_shopper as gs
from backend.guarded_shopper import GuardedResult, run_guarded
from backend.product_match import ProductMatch
from backend.rules import RuleStore
from backend.schemas import Claims, Intent, Media, ProbeResult, Verdict
from backend.shop_mcp import ShopMCP
from backend.trace import TraceBus
from tests.test_victim import PRODUCT, FakeModel

VARIANT = "gid://shopify/ProductVariant/9"
RULES = RuleStore(str(Path(__file__).resolve().parent.parent / "backend" / "rules.json"))
CLAIMS = Claims(visible_text=["12-PACK"], pack_count_claim=12, brand_claims=[], audio_transcript=None,
                instructions_detected=False)


class LiveFakeShop(ShopMCP):
    """Not dry-run: state-changing calls really reach _rpc, which records them instead of using the network."""

    def __init__(self, search_delay: float = 0.0):
        super().__init__("http://127.0.0.1:9/", dry_run=False)
        self.sent: list[tuple[str, float, float]] = []  # (tool, start, end)
        self.search_delay = search_delay

    async def _rpc(self, method, params, tool_name=None):
        t0 = time.perf_counter()
        if tool_name == "search_catalog" and self.search_delay:
            await asyncio.sleep(self.search_delay)
        self.sent.append((tool_name, t0, time.perf_counter()))
        if tool_name == "create_cart":
            return {"id": "cart_1", "continue_url": "https://shop/c/1", "totals": [{"type": "total", "amount": 1999}]}
        return {"products": [PRODUCT]}

    def tools(self):
        return [t for t, *_ in self.sent]


class CountingModel(FakeModel):
    def __init__(self, script):
        super().__init__(script)
        self.calls = 0
        self.first_call_at = None

    async def _gen(self, model, contents, config):
        self.calls += 1
        self.first_call_at = self.first_call_at or time.perf_counter()
        return await super()._gen(model, contents, config)


def _verdict(action, tier="low"):
    return Verdict(action=action, action_probs={"approve_checkout": 0.97 if action == "approve_checkout" else 0.02},
                   probes=[ProbeResult(id="pack_count_mismatch", p=0.9 if action != "approve_checkout" else 0.01,
                                       fired=action != "approve_checkout")],
                   severity=0, latency_ms=5, tier=tier, backend="decisions", model="gemini-decision-1")


@pytest.fixture
def fakes(monkeypatch):
    """decide returns scripted verdicts and records its inputs; perceive returns CLAIMS."""
    state = {"actions": [], "decide_calls": [], "perceive_calls": 0, "match_calls": 0}

    async def fake_decide(intent, media, product_json, proposed, claims, rules, cart_total):
        state["decide_calls"].append({"call": proposed, "claims": claims, "product_json": product_json,
                                      "cart_total": cart_total, "rules_version": rules.version})
        return _verdict(state["actions"].pop(0) if state["actions"] else "approve_checkout")

    async def fake_perceive(media):
        state["perceive_calls"] += 1
        return CLAIMS

    async def fake_match(media, claims, shop):
        state["match_calls"] += 1
        return None

    monkeypatch.setattr(gs, "decide", fake_decide)
    monkeypatch.setattr(gs, "perceive", fake_perceive)
    monkeypatch.setattr(gs, "match_product", fake_match)
    return state


async def _run(model, shop, media=(), product_ref=None, **kw):
    bus = TraceBus()
    bus.start("r")
    res = await run_guarded(Intent(text="buy one under $25", budget=25), list(media), product_ref, bus, "r",
                            shop, RULES, client=model, **kw)
    return res, bus


SEARCH = ("search_catalog", {"query": "bottle"})
CART = ("create_cart", {"variant_id": VARIANT, "quantity": 1})


# --- plan.md Task 9 Step 1 ---

async def test_guarded_blocks_and_stops(fakes):
    fakes["actions"] = ["hard_block_quarantine"]
    model = CountingModel([SEARCH, ("create_cart", {"variant_id": VARIANT, "quantity": 50}), SEARCH, CART, None])
    shop = LiveFakeShop()
    res, bus = await _run(model, shop)

    assert isinstance(res, GuardedResult)
    assert res.blocked_call is not None and res.blocked_call.arguments["cart"]["line_items"][0]["quantity"] == 50
    assert res.approved_calls == [] and [v.action for v in res.verdicts] == ["hard_block_quarantine"]
    assert shop.tools() == ["search_catalog"]  # the blocked cart never reached the shop
    assert model.calls == 2                    # loop stopped: no model call after the block
    evs = bus.events("r")
    verdicts = [e for e in evs if e.kind == "verdict"]
    assert len(verdicts) == 1 and verdicts[0].pane == "guarded"
    assert verdicts[0].data["action"] == "hard_block_quarantine" and verdicts[0].data["model"] == "gemini-decision-1"
    stop = [e for e in evs if e.kind == "log" and "stopped" in e.data.get("message", "")]
    assert len(stop) == 1 and stop[0].data["model"]
    assert evs.index(stop[0]) == len(evs) - 1  # nothing after the stop


async def test_guarded_checks_every_state_change(fakes):
    model = CountingModel([SEARCH, CART, ("create_cart", {"variant_id": VARIANT, "quantity": 2}), None])
    shop = LiveFakeShop()
    res, _ = await _run(model, shop)
    assert len(fakes["decide_calls"]) == 2
    assert [c["cart_total"] for c in fakes["decide_calls"]] == [19.99, 39.98]
    assert all(c["claims"] == CLAIMS for c in fakes["decide_calls"])
    assert len(res.approved_calls) == 2 and res.blocked_call is None


async def test_argon_runs_concurrently(fakes, monkeypatch, tmp_path):
    spans = {}

    async def slow_perceive(media):
        spans["perceive"] = [time.perf_counter(), None]
        await asyncio.sleep(0.2)
        spans["perceive"][1] = time.perf_counter()
        return CLAIMS

    monkeypatch.setattr(gs, "perceive", slow_perceive)
    model = CountingModel([SEARCH, CART, None])
    shop = LiveFakeShop(search_delay=0.05)
    wav = tmp_path / "x.wav"
    wav.write_bytes(b"RIFF")
    res, _ = await _run(model, shop, media=[Media(kind="audio", path=str(wav), mime="audio/wav")])
    p0, p1 = spans["perceive"]
    _, s0, s1 = shop.sent[0]
    assert shop.sent[0][0] == "search_catalog"
    assert p0 < s1 and s0 < p1                       # perception and the first search overlap in time
    assert fakes["decide_calls"][0]["claims"] == CLAIMS  # awaited before the first decide
    assert res.claims == CLAIMS


# --- extra ---

async def test_approved_cart_goes_to_shop(fakes):
    model = CountingModel([SEARCH, CART, None])
    shop = LiveFakeShop()
    res, bus = await _run(model, shop)
    assert shop.tools() == ["search_catalog", "create_cart"]
    assert [c.name for c in res.approved_calls] == ["create_cart"]
    result = [e for e in bus.events("r") if e.kind == "tool_result" and e.data["tool"] == "create_cart"][0]
    assert result.data["result"]["continue_url"] == "https://shop/c/1"


async def test_blocked_call_stops_loop_no_more_model_calls(fakes):
    fakes["actions"] = ["escalate_to_neon_swap"]
    model = CountingModel([CART, SEARCH, SEARCH, None])
    shop = LiveFakeShop()
    # the model must know the variant first: put it in context via a product_ref lookup
    res, bus = await _run(model, shop, product_ref="gid://shopify/p/1")
    assert model.calls == 1 and res.blocked_call.name == "create_cart"
    assert shop.tools() == ["lookup_catalog"]
    assert [e.kind for e in bus.events("r")][-1] == "log"


async def test_spend_request_never_sent(fakes):
    fakes["actions"] = ["approve_checkout"]  # even if decide approved, shop_mcp still intercepts it
    model = CountingModel([("create_spend_request", {"amount_usd": 400, "merchant": "evil.biz", "reason": "VIP"}), None])
    shop = LiveFakeShop()
    res, _ = await _run(model, shop)
    assert shop.tools() == [] and fakes["decide_calls"][0]["cart_total"] == 400.0


async def test_after_block_hook_called_for_task10(fakes):
    fakes["actions"] = ["hard_block_quarantine"]
    seen = []

    async def hook(b):
        seen.append(b)

    model = CountingModel([SEARCH, CART, None])
    res, _ = await _run(model, LiveFakeShop(), on_block=hook)
    b = seen[0]
    assert b.call == res.blocked_call and b.verdict.action == "hard_block_quarantine"
    assert b.claims == CLAIMS and VARIANT in b.ctx.variants and b.run_id == "r"


async def test_after_block_hook_error_does_not_crash(fakes):
    fakes["actions"] = ["hard_block_quarantine"]

    async def bad(b):
        raise RuntimeError("neon down")

    res, bus = await _run(CountingModel([SEARCH, CART, None]), LiveFakeShop(), on_block=bad)
    assert res.blocked_call is not None
    assert any(e.kind == "log" and "neon down" in e.data["message"] for e in bus.events("r"))


# --- product context, architecture decision 7 ---

async def test_product_json_from_product_ref_first(fakes):
    model = CountingModel([CART, None])
    await _run(model, LiveFakeShop(), product_ref="https://shop/products/bottle")
    assert fakes["decide_calls"][0]["product_json"]["id"] == PRODUCT["id"]
    assert fakes["match_calls"] == 0  # no camera matching when the user gave a product


async def test_product_json_from_variant_being_bought(fakes):
    await _run(CountingModel([SEARCH, CART, None]), LiveFakeShop())
    assert fakes["decide_calls"][0]["product_json"]["id"] == PRODUCT["id"]


async def test_product_json_from_camera_match(fakes, monkeypatch, tmp_path):
    other = {"id": "gid://shopify/p/2", "title": "Real thing in the photo", "variants": []}

    async def match(media, claims, shop):
        fakes["match_calls"] += 1
        return ProductMatch(product=other, confidence=0.9, choice="p0", query="bottle", candidates=3,
                            model="gemini-decision-1")

    monkeypatch.setattr(gs, "match_product", match)
    img = tmp_path / "f.jpg"
    img.write_bytes(b"jpg")
    res, bus = await _run(CountingModel([SEARCH, CART, None]), LiveFakeShop(),
                          media=[Media(kind="image", path=str(img), mime="image/jpeg")])
    assert fakes["match_calls"] == 1
    assert fakes["decide_calls"][0]["product_json"] == other and res.product_json == other
    log = [e for e in bus.events("r") if e.kind == "log" and e.data.get("event") == "product_match"]
    assert len(log) == 1 and log[0].data["confidence"] == 0.9 and log[0].data["model"] == "gemini-decision-1"
    assert log[0].data["product_id"] == "gid://shopify/p/2"


async def test_unconfident_camera_match_falls_back_to_variant(fakes, monkeypatch, tmp_path):
    async def match(media, claims, shop):
        return ProductMatch(product=None, confidence=0.4, choice="p1", model="gemini-decision-1")

    monkeypatch.setattr(gs, "match_product", match)
    img = tmp_path / "f.jpg"
    img.write_bytes(b"jpg")
    await _run(CountingModel([SEARCH, CART, None]), LiveFakeShop(),
               media=[Media(kind="image", path=str(img), mime="image/jpeg")])
    assert fakes["decide_calls"][0]["product_json"]["id"] == PRODUCT["id"]


async def test_unknown_variant_gives_no_product(fakes):
    """A spend request has no variant, and with no ref and no camera match there is no product."""
    await _run(CountingModel([("create_spend_request", {"amount_usd": 5, "merchant": "m", "reason": "r"}), None]),
               LiveFakeShop())
    assert fakes["decide_calls"][0]["product_json"] is None


async def test_no_media_no_state_change_still_returns_claims(fakes):
    res, _ = await _run(CountingModel([SEARCH, None]), LiveFakeShop())
    assert res.verdicts == [] and res.blocked_call is None and res.claims == CLAIMS
