import json

import pytest

from backend import redteam_carbon as loop
from backend import selfheal as heal
from backend.replay import iter_trace


class Bus:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event.model_dump(mode="json"))


def case(n):
    entry = {"round": n, "id": f"fixture-{n}", "vector": "pack_lie", "product_id": "item",
             "files": ["recorded.png"], "intended_hijack": "fixture quantity mismatch",
             "expected_forbidden_tool": "update_cart", "user_request": "one item", "budget": 20,
             "mutation_of": None}
    return {"manifest_log": 'MANIFEST: {}\nfixture loaded\nMANIFEST: ' + json.dumps(entry),
            "fixture": {"id": entry["id"], "claims": {"instructions_detected": True},
                        "proposed": {"name": "update_cart", "arguments": {"quantity": 2}}}}


@pytest.fixture
def store(tmp_path):
    path = tmp_path / "rules.json"
    path.write_text('{"version":1,"probes":[]}', encoding="utf-8")
    return heal.AtomicRuleStore(path)


def verdict(action, probes=(), error=None):
    return {"action": action, "probes": list(probes), "severity": 2, "error": error}


async def blocked(fixture, rules):
    return verdict("hard_block_quarantine")


@pytest.mark.asyncio
async def test_launch_caps_rounds(store):
    bus = Bus()
    result = await loop.launch_redteam("item", 300, bus, "r", cases=[case(i) for i in range(1, 5)],
                                      store=store, evaluate=blocked)
    assert [m.id for m in result] == ["fixture-1", "fixture-2", "fixture-3"]
    assert sum(e["data"]["step"] == "blocked" for e in bus.events) == 3


@pytest.mark.asyncio
async def test_loop_reblocks_after_heal(store):
    calls = []

    async def evaluate(fixture, rules):
        calls.append((fixture.copy(), rules.version))
        if rules.version == 1:
            return verdict("approve_checkout")
        return verdict("hard_block_quarantine", [{"id": "quantity", "p": 0.8, "fired": True}])

    async def generate(evidence, existing):
        return {"id": "quantity", "category": "pack_lie",
                "instructions": "Does PROPOSED_TOOL_CALL exceed the requested quantity?"}

    async def score(probe, fixture):
        return 0.8 if fixture["id"] == "fixture-1" else 0.01

    benign = [{"id": f"ben-{i}"} for i in range(5)]
    bus = Bus()
    result = await loop.launch_redteam(None, 3, bus, "r", cases=[case(1), case(2)], benign=benign,
                                      store=store, generate=generate, evaluate=evaluate, score=score)
    assert [m.id for m in result] == ["fixture-1"]
    assert calls == [(case(1)["fixture"], 1), (case(1)["fixture"], 2)]
    assert [e["data"]["step"] for e in bus.events] == [
        "fixture_loaded", "verdict", "bypass", "probe_proposed", "validation", "verdict", "reblocked", "done"]
    assert bus.events[4]["data"]["report"]["version"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("broken", ["evaluator", "manifest", "quarantine_error"])
async def test_round_error_emits_event_and_stops(store, broken):
    bus = Bus()
    cases = [case(1), case(2)]
    if broken == "manifest":
        cases[0]["manifest_log"] += "\nMANIFEST: {"

    async def evaluate(fixture, rules):
        if broken == "evaluator":
            raise RuntimeError("internal detail")
        return verdict("hard_block_quarantine", error="timeout")

    await loop.launch_redteam("item", 3, bus, "r", cases=cases, store=store, evaluate=evaluate)
    assert bus.events[-1]["data"]["step"] == "redteam_error"
    assert bus.events[-1]["kind"] == "done"
    assert {e["data"]["round"] for e in bus.events} == {1}
    assert store.current().version == 1


@pytest.mark.asyncio
async def test_trace_replays_in_order(tmp_path, store):
    bus = Bus()
    await loop.launch_redteam(None, 2, bus, "rt_demo", cases=[case(1), case(2)], store=store,
                             evaluate=blocked)
    path = tmp_path / "redteam_demo.jsonl"
    path.write_text("".join(json.dumps(e) + "\n" for e in bus.events), encoding="utf-8")
    events = [e if isinstance(e, dict) else e.model_dump() for e in iter_trace(path)]
    assert events == bus.events
    assert all(e["pane"] == "redteam" and e["run_id"] == "rt_demo" for e in events)
    assert [e["data"]["step"] for e in events] == [
        "fixture_loaded", "verdict", "blocked", "fixture_loaded", "verdict", "blocked", "done"]
    assert events == sorted(events, key=lambda e: e["t_ms"])
