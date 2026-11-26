"""The Performance page's numbers always come from the per-case records, never from a stale summary."""
from app.eval_routes import summarize_results


def case(system, label, *, success=None, completed=None, defended=0.0, latencies=(), error=None):
    score = None if error else {"attack_success": success, "benign_completed": completed, "dollars_defended": defended,
                                "fw_latencies": list(latencies)}
    return {"id": f"c-{system}-{label}-{len(latencies)}-{success}-{completed}", "system": system, "label": label, "score": score,
            "error": error, "product_snapshot": {"big": "x" * 1000}}


def doc(systems):
    return {"systems": systems, "meta": {}, "cases": [
        case("baseline", "attack", success=True), case("baseline", "attack", success=True), case("baseline", "benign", completed=True),
        case("carttrap", "attack", success=False, defended=40.0, latencies=[100, 300]),
        case("carttrap", "attack", success=False, defended=10.5, latencies=[200]),
        case("carttrap", "benign", completed=False), case("carttrap", "benign", error="timeout"),
    ]}


def test_numbers_are_recomputed_from_the_cases_and_the_heavy_part_dropped():
    stale = {"baseline": {"asr": 0.0, "benign_completion": 0.0, "p50_ms": 0, "p95_ms": 0, "dollars_defended": 0, "n_attack": 2, "n_benign": 1},
             "carttrap": {"asr": 1.0, "benign_completion": 1.0, "p50_ms": 1, "p95_ms": 1, "dollars_defended": 0, "n_attack": 2, "n_benign": 1}}
    out = summarize_results(doc(stale))
    assert "cases" not in out and out["meta"]["recomputed"] is True
    base, ct = out["systems"]["baseline"], out["systems"]["carttrap"]
    assert base["asr"] == 1.0 and base["benign_completion"] == 1.0 and (base["n_attack"], base["n_benign"]) == (2, 1)
    assert ct["asr"] == 0.0 and ct["benign_completion"] == 0.0 and ct["dollars_defended"] == 50.5
    assert (ct["n_attack"], ct["n_benign"]) == (2, 1) and ct["p50_ms"] == 200.0
    assert out["n_errors"] == {"carttrap": 1} and out["meta"]["n_cases"] == {"baseline": 3, "carttrap": 4}
    assert out["meta"]["n_scored"] == {"baseline": 3, "carttrap": 3}


def test_a_correct_summary_is_left_as_is():
    first = summarize_results(doc({}))
    again = summarize_results(doc(first["systems"]))
    assert again["meta"]["recomputed"] is False and again["systems"] == first["systems"]


def test_a_summary_only_file_passes_through():
    sample = {"systems": {"carttrap": {"asr": 0.1}}, "meta": {"sample": True}}
    assert summarize_results(sample) == sample
