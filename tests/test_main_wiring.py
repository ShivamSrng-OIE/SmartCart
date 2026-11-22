"""Task 9 Step 4: run_guarded and parse_intent are wired into main.py (Member 2's own tests)."""
import httpx

import backend.main as main
from backend.rules import RuleStore
from backend.shop_mcp import ShopMCP


async def test_guarded_pipeline_calls_run_guarded(monkeypatch):
    seen = {}

    async def fake_run_guarded(intent, media, product_ref, bus, run_id, shop, rules, on_block=None, system_prompt=None):
        seen.update(intent=intent, shop=shop, rules=rules, ref=product_ref, on_block=on_block, prompt=system_prompt)

    monkeypatch.setattr(main, "run_guarded", fake_run_guarded)
    assert main.app.state.pipelines["guarded"] is main.guarded_pipeline
    bus = main.TraceBus()
    bus.start("r")
    await main.guarded_pipeline(main.parse_intent("buy one", None), [], "gid://p/1", bus, "r")
    assert isinstance(seen["shop"], ShopMCP) and seen["shop"].dry_run is False
    assert isinstance(seen["rules"], RuleStore) and seen["rules"] is main.RULES
    assert seen["rules"].current().version >= 1 and seen["ref"] == "gid://p/1"
    assert seen["on_block"] is main.defender_on_block  # ADR m4/0010
    assert seen["prompt"].startswith(main.GUARDED_PROMPT) and "buy all of something" in seen["prompt"]  # same note as the victim
    assert main.app.state.rules is main.RULES  # ADR m4/0009


async def test_run_uses_parse_intent(monkeypatch):
    seen = {}

    async def capture(intent, media, product_ref, bus, run_id):
        seen["intent"] = intent

    monkeypatch.setitem(main.app.state.pipelines, "guarded", capture)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://t") as c:
        r = await c.post("/api/run", data={"request": "buy two packs under $25", "mode": "guarded"})
        await main.app.state.bus.wait_done(r.json()["run_id"])
    assert seen["intent"].budget == 25 and seen["intent"].quantity == 2


async def test_victim_pipeline_uses_the_warehouse_shop_and_the_same_prompt(monkeypatch):
    seen = {}

    async def fake_run_victim(intent, media, product_ref, bus, run_id, shop=None, client=None, system_prompt=None):
        seen.update(shop=shop, prompt=system_prompt)

    monkeypatch.setattr(main, "run_victim", fake_run_victim)
    assert main.app.state.pipelines["victim"] is main.victim_pipeline
    bus = main.TraceBus()
    bus.start("r")
    await main.victim_pipeline(main.parse_intent("buy all the multivitamins under $240", None), [], None, bus, "r")
    assert isinstance(seen["shop"], main.WarehouseShop) and seen["shop"].dry_run and seen["shop"].budget_cents == 24000
    assert seen["prompt"] == main.VICTIM_PROMPT + main.ALL_MATCHES_NOTE


async def test_warehouse_can_be_switched_off(monkeypatch):
    seen = {}

    async def fake_run_victim(intent, media, product_ref, bus, run_id, shop=None, client=None, system_prompt=None):
        seen.update(shop=shop, prompt=system_prompt)

    monkeypatch.setattr(main, "run_victim", fake_run_victim)
    monkeypatch.setattr(main.config, "WAREHOUSE_IN_AGENT", False)
    bus = main.TraceBus()
    bus.start("r")
    await main.victim_pipeline(main.parse_intent("buy one", None), [], None, bus, "r")
    assert not isinstance(seen["shop"], main.WarehouseShop) and seen["prompt"] == main.VICTIM_PROMPT
