import json
import os
import shutil
from collections import Counter
from pathlib import Path

import pytest

from app.rules import RuleSet, RuleStore
from app.schemas import Probe

SEED = Path(__file__).resolve().parent.parent / "app" / "rules.json"
ATTACK_CATEGORIES = ["injection", "pack_lie", "spend_hijack", "coercion", "split_payload"]


@pytest.fixture
def store_path(tmp_path):
    p = tmp_path / "rules.json"
    shutil.copy(SEED, p)
    return p


def _bump_mtime(path: Path):
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))


# --- plan.md Task 6 required tests ---

def test_seed_rules_valid():
    rs = RuleStore(str(SEED)).current()
    assert 40 <= len(rs.probes) <= 60
    ids = [p.id for p in rs.probes]
    assert len(ids) == len(set(ids))


def test_hot_reload(store_path):
    store = RuleStore(str(store_path))
    v1 = store.current().version
    data = json.loads(store_path.read_text())
    data["version"] = v1 + 5
    store_path.write_text(json.dumps(data))
    _bump_mtime(store_path)
    assert store.current().version == v1 + 5


def test_append_bumps_version(store_path):
    store = RuleStore(str(store_path))
    before = store.current()
    probe = Probe(id="new_probe_x", type="noul", category="injection", instructions="Is it bad?",
                  added_by="neon", created_at="2026-11-21T15:00:00-05:00")
    v = store.append(probe)
    assert v == before.version + 1
    after = store.current()
    assert after.version == v
    assert after.probes[-1].id == "new_probe_x"
    # persisted, so a fresh store sees it too
    assert RuleStore(str(store_path)).current().version == v


# --- seed coverage required by plan.md and the firewall-rules skill ---

def test_seed_category_coverage():
    counts = Counter(p.category for p in RuleStore(str(SEED)).current().probes)
    for c in ATTACK_CATEGORIES:
        assert counts[c] >= 8, c
    assert counts["promo_benign"] >= 5


def test_cross_modal_split_payload():
    probes = [p for p in RuleStore(str(SEED)).current().probes if p.category == "split_payload"]
    cross = [p for p in probes if "audio" in p.instructions.lower() and "image" in p.instructions.lower()
             and "SHOP_PRODUCT_JSON" in p.instructions]
    assert len(cross) >= 3


def test_pack_lie_probes_reference_product_json():
    # Task 7 skips these when product_json is None, so they must depend on it.
    for p in RuleStore(str(SEED)).current().probes:
        if p.category == "pack_lie":
            assert "SHOP_PRODUCT_JSON" in p.instructions, p.id


def test_promo_probes_relax_in_low_tier():
    for p in RuleStore(str(SEED)).current().probes:
        if p.category == "promo_benign":
            assert p.tiers.get("low", 0) > p.threshold, p.id


def test_thresholds_in_range():
    for p in RuleStore(str(SEED)).current().probes:
        assert 0 < p.threshold < 1
        assert all(0 < t < 1 for t in p.tiers.values())


# --- robustness ---

def test_append_rejects_duplicate_id(store_path):
    store = RuleStore(str(store_path))
    existing = store.current().probes[0]
    with pytest.raises(ValueError):
        store.append(existing)


def test_bad_edit_keeps_last_good(store_path):
    store = RuleStore(str(store_path))
    good = store.current()
    store_path.write_text("{ not json")
    _bump_mtime(store_path)
    assert store.current().version == good.version
    assert len(store.current().probes) == len(good.probes)


def test_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        RuleStore(str(tmp_path / "nope.json")).current()


def test_ruleset_rejects_duplicate_ids():
    p = Probe(id="a", type="noul", category="injection", instructions="?", added_by="seed", created_at="t")
    with pytest.raises(ValueError):
        RuleSet(version=1, probes=[p, p])


def test_append_leaves_no_temp_files(store_path):
    store = RuleStore(str(store_path))
    store.append(Probe(id="tmp_check", type="noul", category="coercion", instructions="?",
                       added_by="neon", created_at="t"))
    assert sorted(os.listdir(store_path.parent)) == ["rules.json"]


def test_probe_id_must_be_valid_question_key():
    """Decisions API question keys: [A-Za-z0-9_-]{1,64}. A bad id is rejected at load/append."""
    good = Probe(id="ok_id-1", type="noul", category="injection", instructions="?",
                 added_by="seed", created_at="2026-11-21T11:30:00-05:00")
    for bad in ["has space", "x" * 65, "dots.not.ok", ""]:
        with pytest.raises(ValueError):
            RuleSet(version=1, probes=[good, good.model_copy(update={"id": bad})])
