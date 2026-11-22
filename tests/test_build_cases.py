"""Tests for eval/build_cases.py, run against stubs (no network, no real forge).

Stubs copy plan.md Task 2/13 interfaces; swap for the real ShopMCP / forge at C2/C5.
"""
from collections import Counter

import pytest

from eval.build_cases import (
    LEGACY_ATTACK_VECTORS,
    CATEGORIES,
    PROP_PHOTOS,
    StubCatalog,
    stub_forge,
    build_cases,
)

CASE_KEYS = {"id", "label", "vector", "user_request", "budget", "product_id", "media", "expected"}
EXPECTED_KEYS = {"max_spend", "allowed_tools", "forbid"}
VALID_VECTORS = {"sticky_note", "pack_lie", "pdf_spend", "voice_coercion", "split_payload",
                 "promo_banner", "blurry_photo", "casual_voice", "plain"}


@pytest.fixture
def cases():
    return build_cases(StubCatalog(), stub_forge, seed=7)


def test_six_cases_per_attack_vector(cases):
    attacks = [c for c in cases if c["label"] == "attack"]
    assert len(attacks) == 30
    assert Counter(c["vector"] for c in attacks) == {v: 6 for v in LEGACY_ATTACK_VECTORS}
    assert len(LEGACY_ATTACK_VECTORS) == 5


def test_twenty_benign_four_per_category(cases):
    benign = [c for c in cases if c["label"] == "benign"]
    assert len(benign) == 20
    assert len(CATEGORIES) == 5
    assert Counter(c["category"] for c in benign) == {k: 4 for k in CATEGORIES}


def test_every_case_matches_architecture_shape_and_ids_unique(cases):
    assert len(cases) == 50
    for c in cases:
        assert CASE_KEYS <= set(c), c["id"]
        assert c["label"] in {"attack", "benign"}
        assert c["vector"] in VALID_VECTORS
        assert isinstance(c["budget"], (int, float)) or c["budget"] is None
        assert isinstance(c["media"], list) and c["media"]
        assert EXPECTED_KEYS <= set(c["expected"])
        assert "create_spend_request" in c["expected"]["forbid"] or c["label"] == "benign"
        assert set(c["expected"]["allowed_tools"]) <= {"create_cart", "create_checkout", "update_cart"}
        if c["budget"] is not None:
            assert c["expected"]["max_spend"] == c["budget"]
    assert len({c["id"] for c in cases}) == 50


def test_sticky_note_cases_use_prop_photos(cases):
    sticky = [c for c in cases if c["vector"] == "sticky_note"]
    assert len(PROP_PHOTOS) == 6
    assert all(p.startswith("eval/props/") for p in PROP_PHOTOS)
    assert sorted(m for c in sticky for m in c["media"]) == sorted(PROP_PHOTOS)


def test_non_sticky_attacks_do_not_use_prop_photos(cases):
    for c in cases:
        if c["vector"] != "sticky_note":
            assert not any(m.startswith("eval/props/") for m in c["media"]), c["id"]


def test_deterministic_for_fixed_seed():
    a = build_cases(StubCatalog(), stub_forge, seed=3)
    b = build_cases(StubCatalog(), stub_forge, seed=3)
    assert a == b


def test_different_seed_changes_product_sampling():
    a = build_cases(StubCatalog(), stub_forge, seed=1)
    b = build_cases(StubCatalog(), stub_forge, seed=2)
    assert [c["product_id"] for c in a] != [c["product_id"] for c in b]
