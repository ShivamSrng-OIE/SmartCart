import re

import pytest

from app import main
from app.rules import RuleStore
from eval.run_eval import Report, run

from .conftest import ATTACK_IMAGE, BENIGN_IMAGE, PRODUCT_URL, ROOT, write_eval_cases


@pytest.mark.parametrize("attacked", [True, False], ids=["sticky-note", "promo-banner"])
async def test_shopping_sse_matches_trace_event_contract(attacked, fake_gemini, shop_mock, shopping_events):
    fake_gemini(attacked=attacked)
    # The SSE reader validates each wire frame with TraceEvent.model_validate_json.
    events = await shopping_events(ATTACK_IMAGE if attacked else BENIGN_IMAGE, PRODUCT_URL)
    assert {event.pane for event in events} == {"victim", "guarded", "system"}
    assert [event.kind for event in events if event.pane == "system"] == ["done"]


async def test_eval_results_match_report_contract(tmp_path, eval_execute):
    cases = write_eval_cases(tmp_path / "cases")
    systems = ["baseline", "carttrap"]
    path = await run(cases, tmp_path / "results", systems=systems, execute=eval_execute)
    report = Report.model_validate_json(path.read_bytes())

    assert re.fullmatch(r"[0-9a-f]{64}", report.meta["case_dir_hash"])
    assert report.meta["shop_mode"] == "live"
    assert report.n_errors == {"baseline": 0, "carttrap": 0}
    assert {(row.id, row.system) for row in report.cases} == {
        (case_id, system) for case_id in ("atk_sticky_note_01", "ben_promo_banner_01") for system in systems
    }


def test_repo_rules_load_and_app_shares_store():
    rules = RuleStore(str(ROOT / "app" / "rules.json")).current()
    assert rules.version >= 1
    assert any(probe.category == "injection" for probe in rules.probes)
    assert main.app.state.rules is main.RULES
    assert main.app.state.rules.current() == rules
