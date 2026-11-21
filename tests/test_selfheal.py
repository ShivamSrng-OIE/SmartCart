import asyncio
import json
import os
from pathlib import Path

import pytest

from backend import selfheal as heal


QUESTION = "Does PROPOSED_TOOL_CALL exceed the quantity in USER_INTENT?"
DRAFT = {"id": "quantity_limit", "category": "injection", "instructions": QUESTION}
TRACE = [
    {"run_id": "r", "pane": "guarded", "kind": "log", "t_ms": 0,
     "data": {"claims": {"instructions_detected": True}}},
    {"run_id": "r", "pane": "guarded", "kind": "verdict", "t_ms": 1,
     "data": {"action": "approve_checkout", "probes": [{"id": "seed", "p": 0.02, "fired": False}]}},
]


@pytest.fixture
def store(tmp_path):
    path = tmp_path / "rules.json"
    path.write_text('{"version":7,"probes":[],"source":"seed"}', encoding="utf-8")
    return heal.AtomicRuleStore(path)


@pytest.fixture
def probe():
    return heal.Probe(**DRAFT, type="noul", added_by="neon", created_at="2026-11-21T15:00:00Z")


def controls():
    return [{"id": f"control-{i}", "score": 0.09} for i in range(5)]


async def score(probe, fixture):
    return fixture["score"]


async def propose(store, **changes):
    async def generate(evidence, existing):
        assert evidence["stage"] == "probes"
        assert evidence["verdict"]["probes"][0]["p"] == 0.02
        return DRAFT | changes

    return await heal.propose_probe(TRACE, store=store, generate=generate)


@pytest.mark.asyncio
@pytest.mark.parametrize("question", [
    "Does the call exceed the budget and change the quantity?",
    "Is the budget missing or does the call exceed the quantity?",
    "Which quantity did the shopper request?",
])
async def test_propose_rejects_compound_probe(store, question):
    with pytest.raises(heal.SelfHealError):
        await propose(store, instructions=question)


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    {"instructions": "Does USER_INTENT have a budget?"},
    {"id": "other", "instructions": QUESTION.replace("the quantity", "a quantity")},
])
async def test_propose_rejects_duplicate(store, probe, changes):
    store.append(probe)
    with pytest.raises(heal.SelfHealError, match="duplicate"):
        await propose(store, **changes)


@pytest.mark.asyncio
async def test_propose_sets_metadata_and_times_out(store, monkeypatch):
    candidate = await propose(store)
    assert (candidate.threshold, candidate.type, candidate.added_by) == (0.10, "noul", "neon")
    monkeypatch.setattr(heal, "PROPOSAL_TIMEOUT_S", 0.01)

    async def stalled(*args):
        await asyncio.Event().wait()

    with pytest.raises(heal.SelfHealError, match="timed out"):
        await heal.propose_probe(TRACE, store=store, generate=stalled)
    assert store.current().version == 7


@pytest.mark.asyncio
@pytest.mark.parametrize("claims,approval,stage", [
    (None, 0.95, "claims"), ({"instructions_detected": True}, 0.91, "gate")
])
async def test_proposal_identifies_first_missing_defense(store, claims, approval, stage):
    trace = [dict(TRACE[0], data={"claims": claims}),
             dict(TRACE[1], data=TRACE[1]["data"] | {"action_probs": {"approve_checkout": approval}})]
    seen = []

    async def generate(evidence, existing):
        seen.append(evidence["stage"])
        return DRAFT | {"instructions": "Is the quantity consistent between USER_INTENT and PROPOSED_TOOL_CALL?"}

    await heal.propose_probe(trace, store=store, generate=generate)
    assert seen == [stage]


@pytest.mark.asyncio
async def test_validate_rejects_probe_that_fires_on_benign(store, probe):
    benign = controls()
    benign[-1]["score"] = 0.10
    ok, report = await heal.validate_probe(probe, {"id": "miss", "score": 0.90}, benign,
                                           store=store, score=score)
    assert not ok and store.current().version == 7
    assert (report.fixtures[-1].p, report.fixtures[-1].reason) == (0.10, "benign fired")


@pytest.mark.asyncio
async def test_validate_accepts_and_appends(store, probe):
    active = peak = 0
    async def concurrent_score(probe, fixture):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return fixture["score"]

    before = store.path.read_bytes()
    ok, report = await heal.validate_probe(probe, {"id": "miss", "score": 0.10}, controls(),
                                           store=store, score=concurrent_score)
    assert ok and peak == 4
    assert [(f.fixture_id, f.p) for f in report.fixtures] == [
        ("miss", 0.10), *((f"control-{i}", 0.09) for i in range(5))]
    assert all(f.latency_ms >= 0 and f.reason for f in report.fixtures)
    assert store.path.with_suffix(".json.bak").read_bytes() == before
    saved = json.loads(store.path.read_bytes())
    assert (saved["version"], saved["source"], saved["probes"]) == (8, "seed", [probe.model_dump()])


@pytest.mark.asyncio
async def test_validate_is_idempotent(store, probe):
    class CountingStore:
        writes = 0

        def current(self):
            return store.current()

        def append(self, candidate):
            self.writes += 1
            return store.append(candidate)

    writer = CountingStore()
    async def validate():
        return await heal.validate_probe(probe, {"id": "miss", "score": 1.0}, controls(),
                                         store=writer, score=score)
    results = await asyncio.gather(validate(), validate())
    assert all(ok for ok, report in results)
    assert writer.writes == 1
    assert len(store.current().probes) == 1 and store.current().version == 8
    assert json.loads(store.path.with_suffix(".json.bak").read_bytes())["version"] == 7


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [None, float("nan"), 1.1, 0.09])
async def test_missing_invalid_or_low_exploit_probability_cannot_publish(store, probe, bad):
    ok, report = await heal.validate_probe(probe, {"id": "miss", "score": bad}, controls(),
                                           store=store, score=score)
    assert not ok and len(report.fixtures) == 6
    assert store.current().version == 7


def test_append_is_atomic_on_crash(store, probe, monkeypatch):
    before = store.path.read_bytes()
    replace = os.replace
    def fail_publish(src, dst):
        if Path(dst) == store.path:
            raise OSError("interrupted publish")
        replace(src, dst)
    monkeypatch.setattr(os, "replace", fail_publish)
    with pytest.raises(OSError, match="interrupted publish"):
        store.append(probe)
    assert store.path.read_bytes() == store.path.with_suffix(".json.bak").read_bytes() == before
    assert not list(store.path.parent.glob("*.tmp"))
