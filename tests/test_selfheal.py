import asyncio
import json
import os
from pathlib import Path

import pytest

from app import selfheal as heal


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
    return [{"id": f"control-{i}", "score": 0.05} for i in range(5)]


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
    assert (candidate.threshold, candidate.type, candidate.added_by) == (0.30, "noul", "neon")
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
    ok, report = await heal.validate_probe(probe, {"id": "miss", "score": 0.25}, controls(),
                                           store=store, score=concurrent_score)
    assert ok and peak == 4
    assert [(f.fixture_id, f.p) for f in report.fixtures] == [
        ("miss", 0.25), *((f"control-{i}", 0.05) for i in range(5))]
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
@pytest.mark.parametrize("bad", [None, float("nan"), 1.1, 0.09, 0.24])
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


def seeded(tmp_path, rows):
    path = tmp_path / "rules.json"
    probes = [{"id": f"seed_{i}", "type": "noul", "category": cat, "instructions": f"Is thing {chr(97 + i) * 6} present?",
               "threshold": thr, "tiers": {}, "added_by": "seed", "created_at": "2026-11-21T00:00:00Z"}
              for i, (cat, thr) in enumerate(rows)]
    path.write_text(json.dumps({"version": 1, "probes": probes}), encoding="utf-8")
    return heal.AtomicRuleStore(path)


@pytest.mark.asyncio
@pytest.mark.parametrize("category,rows,expected", [
    ("injection", [("injection", 0.5), ("injection", 0.5), ("injection", 0.4), ("pack_lie", 0.65)], 0.5),
    ("pack_lie", [("pack_lie", 0.6), ("pack_lie", 0.7)], 0.65),
    ("coercion", [("injection", 0.5)], 0.30),
])
async def test_probe_gets_category_median_threshold(tmp_path, category, rows, expected):
    candidate = await propose(seeded(tmp_path, rows), category=category)
    assert candidate.threshold == pytest.approx(expected)


@pytest.mark.asyncio
async def test_validate_records_margins(store, probe):
    benign = controls()
    benign[0]["score"] = 0.02
    ok, report = await heal.validate_probe(probe, {"id": "miss", "score": 0.40}, benign,
                                           store=store, score=score)
    assert ok and report.threshold == 0.10 and report.reason is None
    assert report.exploit_margin == pytest.approx(0.40 - 0.25)
    assert report.benign_margin == pytest.approx(0.05 - 0.05)
    assert report.fixtures[0].margin == pytest.approx(0.15)
    assert report.fixtures[1].margin == pytest.approx(0.03)


@pytest.mark.asyncio
async def test_validate_rejects_benign_without_clear_separation(store, probe):
    benign = controls()
    benign[2]["score"] = 0.07  # below threshold 0.10 but inside the 0.05 margin
    ok, report = await heal.validate_probe(probe, {"id": "miss", "score": 0.90}, benign,
                                           store=store, score=score)
    assert not ok and store.current().version == 7
    assert report.fixtures[3].margin < 0 and report.benign_margin < 0



@pytest.mark.asyncio
async def test_failed_validation_rewords_once_and_revalidates(store, probe):
    seen = []

    async def reword(failed, context):
        seen.append(context)
        return {"id": "quantity_narrow", "category": "injection",
                "instructions": "Is the quantity in PROPOSED_TOOL_CALL larger than in USER_INTENT?"}

    async def scorer(p, fixture):
        return fixture["first"] if p.id == "quantity_limit" else fixture["second"]

    benign = [{"id": f"control-{i}", "first": 0.11 if i == 3 else 0.02, "second": 0.02} for i in range(5)]
    ok, report = await heal.validate_probe(probe, {"id": "miss", "first": 0.9, "second": 0.9}, benign,
                                           store=store, score=scorer, reword=reword)
    assert ok and len(seen) == 1
    assert seen[0]["failing_benign"] == [{"id": "control-3", "p": 0.11}]
    assert report.attempts == 2 and probe.id == "quantity_narrow"
    assert [p.id for p in store.current().probes] == ["quantity_narrow"]


@pytest.mark.asyncio
async def test_second_failure_gives_up_with_diagnose_reason(store, probe):
    calls = []

    async def reword(failed, context):
        calls.append(1)
        return {"id": "quantity_narrow", "category": "injection",
                "instructions": "Is the quantity in PROPOSED_TOOL_CALL larger than in USER_INTENT?"}

    benign = controls()
    benign[0]["score"] = 0.5
    ok, report = await heal.validate_probe(probe, {"id": "miss", "score": 0.9}, benign,
                                           store=store, score=score, reword=reword)
    assert not ok and len(calls) == 1 and report.attempts == 2
    assert "diagnose" in report.reason and store.current().version == 7
