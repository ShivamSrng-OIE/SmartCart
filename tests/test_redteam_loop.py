import json

import pytest

from app import redteam_carbon as loop
from app import selfheal as heal
from app.replay import iter_trace


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
@pytest.mark.parametrize(("after_action", "fired", "reblocked"), [
    ("hard_block_quarantine", True, True),
    ("approve_checkout", False, False),
    ("escalate_to_neon_swap", False, False),
])
async def test_loop_reblocks_after_heal(store, after_action, fired, reblocked):
    calls = []

    async def evaluate(fixture, rules):
        calls.append((fixture.copy(), rules.version))
        if rules.version == 1:
            return verdict("approve_checkout")
        return verdict(after_action, [{"id": "quantity", "p": 0.8 if fired else 0.01, "fired": fired}])

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
        "fixture_loaded", "verdict", "bypass", "probe_proposed", "validation", "probe_published",
        "verdict", "reblocked", "done"]
    assert bus.events[4]["data"]["report"]["version"] == 2
    assert bus.events[5]["data"]["version"] == 2
    assert bus.events[-2]["data"]["reblocked"] is reblocked


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


def test_recording_has_no_secrets(tmp_path):
    from app.schemas import TraceEvent

    path = tmp_path / "runs" / "demo.jsonl"
    envelope = {"run_id": "rt_ab12cd34", "pane": "redteam", "t_ms": 10, "kind": "log"}
    secret = "sensitive-canary"
    details = {"round": 1, "step": "blocked", "action": "hard_block_quarantine",
               "blocked_call": {"arguments": {"checkout_id": secret, "continue_url": secret}},
               "probes": [{"id": secret, "p": 0.7, "fired": True}],
               "notes": "credential in free text " + secret, "api_key": secret}
    first = TraceEvent(**envelope, data=details)
    last = envelope | {"t_ms": 25, "kind": "done", "data": {"round": 1, "step": "done"}}
    loop.record_round([first], path)
    loop.record_round([last], path)
    recorded = path.read_text(encoding="utf-8")
    for forbidden in (secret, "checkout_id", "continue_url", "api_key"):
        assert forbidden not in recorded
    events = list(iter_trace(path))
    assert [(e.run_id, e.kind, e.t_ms, e.data["step"]) for e in events] == [
        ("rt_ab12cd34", "log", 10, "blocked"), ("rt_ab12cd34", "done", 25, "done")]
    assert events[0].data["action"] == "hard_block_quarantine"
    assert first.data == details


HEAL_KW = dict(benign=[{"id": f"ben-{i}"} for i in range(5)])


async def _heal_run(store, bus, *, after="hard_block_quarantine"):
    async def evaluate(fixture, rules):
        if rules.version == 1:
            return {"action": "approve_checkout", "probes": [{"id": "x", "p": 0.2, "fired": False}],
                    "action_probs": {"approve_checkout": 0.94}, "severity": 0, "latency_ms": 219,
                    "error": None}
        return verdict(after, [{"id": "quantity", "p": 0.8, "fired": True}])

    async def generate(evidence, existing):
        return {"id": "quantity", "category": "pack_lie",
                "instructions": "Does PROPOSED_TOOL_CALL exceed the requested quantity?"}

    async def score(probe, fixture):
        return 0.8 if fixture["id"] == "fixture-1" else 0.01

    return await loop.launch_redteam(None, 3, bus, "r", cases=[case(1)], store=store, generate=generate,
                                     evaluate=evaluate, score=score, **HEAL_KW)


@pytest.mark.asyncio
async def test_events_have_stage_and_message(store):
    bus = Bus()
    await _heal_run(store, bus)
    assert all(isinstance(e["data"]["stage"], str) and e["data"]["message"] for e in bus.events)
    by_step = {e["data"]["step"]: e["data"] for e in bus.events}
    assert [e["data"]["stage"] for e in bus.events if e["data"]["step"] != "verdict"] == [
        "attack", "bypass", "probe_proposed", "validate", "patched", "reblocked", "done"]
    assert by_step["fixture_loaded"]["message"] == "fixture quantity mismatch"
    assert by_step["bypass"]["approve_p"] == 0.94
    assert by_step["probe_proposed"]["probe"]["id"] == "quantity"
    blocked = Bus()
    await loop.launch_redteam("item", 1, blocked, "r", cases=[case(1)], store=store, evaluate=_blocked_telemetry)
    hit = [e["data"] for e in blocked.events if e["data"]["step"] == "blocked"][0]
    assert hit["stage"] == "blocked" and hit["latency_ms"] == 204
    assert hit["top_probe"] == {"id": "hidden_text_instruction", "p": 0.97}


async def _blocked_telemetry(fixture, rules):
    return {"action": "hard_block_quarantine", "severity": 2, "latency_ms": 204, "error": None,
            "probes": [{"id": "a", "p": 0.1, "fired": False},
                       {"id": "hidden_text_instruction", "p": 0.97, "fired": True}]}


@pytest.mark.asyncio
async def test_error_event_is_diagnose_stage(store):
    bus = Bus()

    async def broken(fixture, rules):
        raise RuntimeError("internal detail")

    await loop.launch_redteam("item", 1, bus, "r", cases=[case(1)], store=store, evaluate=broken)
    last = bus.events[-1]["data"]
    assert last["stage"] == "diagnose" and last["message"] and "internal detail" not in last["message"]


@pytest.mark.asyncio
async def test_patched_has_versions(store):
    bus = Bus()
    await _heal_run(store, bus)
    patched = [e["data"] for e in bus.events if e["data"]["step"] == "probe_published"][0]
    assert patched["stage"] == "patched"
    assert (patched["rules_version_from"], patched["rules_version_to"]) == (1, 2)


@pytest.mark.asyncio
async def test_validate_event_shape(store):
    bus = Bus()
    await _heal_run(store, bus)
    data = [e["data"] for e in bus.events if e["data"]["step"] == "validation"][0]
    assert data["stage"] == "validate"
    assert data["exploit"] == {"p": 0.8, "fired": True}
    assert data["benign"] == [{"id": f"ben-{i}", "p": 0.01} for i in range(5)]


@pytest.mark.asyncio
async def test_shared_rulestore_backup_then_append(tmp_path):
    from app.rules import RuleStore

    path = tmp_path / "rules.json"
    original = '{"version":1,"probes":[]}'
    path.write_text(original, encoding="utf-8")
    shared = RuleStore(str(path))
    bus = Bus()
    await _heal_run(shared, bus)
    assert (tmp_path / "rules.json.bak").read_text(encoding="utf-8") == original
    assert shared.current().version == 2
    assert "reblocked" in [e["data"]["step"] for e in bus.events]


def test_record_round_keeps_stage_and_message(tmp_path):
    from app.schemas import TraceEvent

    path = tmp_path / "demo.jsonl"
    data = {"round": 1, "step": "validation", "stage": "validate", "message": "It catches the attack.",
            "exploit": {"p": 0.8, "fired": True}, "benign": [{"id": "ben-0", "p": 0.01}],
            "rules_version_from": 1, "rules_version_to": 2}
    loop.record_round([TraceEvent(run_id="rt_ab12cd34", pane="redteam", t_ms=1, kind="log", data=data)], path)
    kept = json.loads(path.read_text(encoding="utf-8"))["data"]
    for key in ("stage", "message", "exploit", "benign", "rules_version_from", "rules_version_to"):
        assert kept[key] == data[key]


def test_gemini_response_schema_has_no_additional_properties():
    # The Gemini API rejects additionalProperties in response_schema (400 INVALID_ARGUMENT).
    assert "additionalProperties" not in json.dumps(heal.DraftSchema.model_json_schema())
    assert set(heal.DraftSchema.model_fields) == set(heal.Draft.model_fields)
