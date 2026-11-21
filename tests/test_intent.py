import pytest
from pydantic import ValidationError

from backend.intent import parse_intent
from backend.schemas import Intent, Probe, TraceEvent, Verdict


# --- plan.md Task 3 required tests ---

def test_parse_intent_budget_from_text():
    i = parse_intent("buy one pack under $25", None)
    assert i.budget == 25
    assert i.quantity == 1


def test_parse_intent_field_wins():
    i = parse_intent("buy one pack under $25", 40)
    assert i.budget == 40


def test_parse_intent_no_budget():
    i = parse_intent("buy one of these", None)
    assert i.budget is None
    assert i.quantity == 1


# --- extra cases the live demo will hit ---

@pytest.mark.parametrize("text,budget", [
    ("buy one of these under 25", 25),
    ("get me a mug for less than $18.50", 18.5),
    ("max $30, one bottle", 30),
    ("buy this, budget of 40 dollars", 40),
    ("up to $1,200 for a laptop", 1200),
    ("I'll take the $12 one", 12),
])
def test_budget_variants(text, budget):
    assert parse_intent(text, None).budget == budget


@pytest.mark.parametrize("text,qty", [
    ("buy two of these under $25", 2),
    ("buy 3 bottles under $60", 3),
    ("buy a 12-pack under $25", 1),          # pack size is not quantity
    ("buy one 16 oz bottle", 1),            # unit size is not quantity
    ("buy these", 1),
    ("buy a pair of socks", 2),
    ("order 2 x shampoo", 2),
])
def test_quantity_variants(text, qty):
    assert parse_intent(text, None).quantity == qty


def test_money_number_is_not_quantity():
    assert parse_intent("buy under 25", None).quantity == 1


def test_text_is_kept_verbatim():
    assert parse_intent("  buy one pack under $25 ", None).text == "  buy one pack under $25 "


def test_quantity_must_be_positive():
    with pytest.raises(ValidationError):
        Intent(text="x", budget=None, quantity=0)


# --- schema smoke tests (contract with other members) ---

def test_probe_tiers_default_not_shared():
    a = Probe(id="a", type="noul", category="injection", instructions="?", added_by="seed", created_at="t")
    b = Probe(id="b", type="noul", category="injection", instructions="?", added_by="seed", created_at="t")
    a.tiers["low"] = 0.25
    assert b.tiers == {}
    assert a.threshold == 0.10


def test_probe_ignores_unknown_fields():
    p = Probe.model_validate({"id": "x", "type": "noul", "category": "pack_lie", "instructions": "?",
                              "added_by": "seed", "created_at": "t", "version": 3})
    assert p.id == "x"


def test_verdict_error_defaults_none():
    v = Verdict(action="hard_block_quarantine", action_probs={}, probes=[], severity=3,
                latency_ms=0, tier="normal", backend="decisions")
    assert v.error is None


def test_trace_event_round_trip():
    e = TraceEvent(run_id="r1", pane="guarded", t_ms=12, kind="verdict", data={"a": 1})
    assert TraceEvent.model_validate_json(e.model_dump_json()) == e


def test_trace_event_rejects_bad_kind():
    with pytest.raises(ValidationError):
        TraceEvent(run_id="r1", pane="guarded", t_ms=1, kind="nope", data={})
