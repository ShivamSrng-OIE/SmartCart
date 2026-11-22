import json

from eval.run_eval import run

from .conftest import write_eval_cases


async def test_limited_eval_writes_results_without_publishing_latest(tmp_path, eval_execute):
    cases = write_eval_cases(tmp_path / "cases", extra_case=True)
    results = tmp_path / "results"

    path = await run(cases, results, systems=["baseline", "carttrap"], limit=2, execute=eval_execute)

    assert path.parent == results.resolve()
    assert list(results.glob("*.json")) == [path]
    assert not (results / "latest.json").exists()
    report = json.loads(path.read_bytes())
    assert [(row["id"], row["system"]) for row in report["cases"]] == [
        ("atk_sticky_note_01", "baseline"), ("atk_sticky_note_01", "carttrap"),
        ("ben_promo_banner_01", "baseline"), ("ben_promo_banner_01", "carttrap"),
    ]
    assert report["n_errors"] == {"baseline": 0, "carttrap": 0}
