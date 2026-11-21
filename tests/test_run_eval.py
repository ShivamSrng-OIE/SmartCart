import asyncio
import json
import re
import runpy
import sys
from collections import Counter
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from pydantic import TypeAdapter

from eval.build_cases import StubCatalog, build_cases, stub_forge, write_cases
from eval.metrics import Metrics


@pytest.fixture
def dataset(tmp_path):
    directory = tmp_path / "cases"
    cases = build_cases(StubCatalog(), stub_forge)
    # Include both labels and write in reverse id order.
    selected = cases[:3] + cases[-3:]
    write_cases(reversed(selected), directory)
    return directory, sorted(c["id"] for c in selected)


def cart_trace(case, quantity=1):
    from eval.runner.systems import Trace

    product = case["product_id"]
    call = SimpleNamespace(name="create_cart", arguments={
        "lines": [{"product_id": product, "quantity": quantity}]
    })
    return Trace([call], [], {product: {"price": 1}})


async def success(system, case):
    return cart_trace(case)


@pytest.mark.asyncio
async def test_runner_records_timeout_as_error(dataset, tmp_path):
    from eval.run_eval import run

    directory, ids = dataset
    active = peak = 0

    async def execute(system, case):
        nonlocal active, peak
        active += 1
        peak = max(active, peak)
        try:
            if case["id"] == ids[0]:
                await asyncio.Event().wait()
            await asyncio.sleep(0)
            if case["id"] == ids[1]:
                raise RuntimeError("fixture unavailable")
            return cart_trace(case)
        finally:
            active -= 1

    path = await run(directory, tmp_path / "out", ["baseline"], execute=execute,
                     concurrency=2, timeout=0.1)
    report = json.loads(path.read_text())
    assert peak == 2 and active == 0
    assert [r["id"] for r in report["cases"]] == ids
    assert [r["id"] for r in report["failures"]] == ids[:2]
    assert "timeout" in report["cases"][0]["error"].lower()
    assert "fixture unavailable" in report["cases"][1]["error"]
    assert report["cases"][0]["score"] is None
    assert report["systems"]["baseline"]["n_attack"] == 1


@pytest.mark.asyncio
async def test_resume_skips_done_cases(dataset, tmp_path):
    from eval.run_eval import run

    directory, ids = dataset
    out = tmp_path / "out"
    calls = []

    async def interrupted(system, case):
        if len(calls) == 3:
            raise asyncio.CancelledError
        calls.append((case["id"], system))
        return cart_trace(case)

    systems = ["baseline", "carttrap"]
    with pytest.raises(asyncio.CancelledError):
        await run(directory, out, systems, concurrency=1, execute=interrupted)
    checkpoint, = out.glob("*.jsonl")
    durable = checkpoint.read_bytes()
    assert len(calls) == 3
    with checkpoint.open("ab") as stream:
        stream.write(b'{"id":"torn')

    async def remainder(system, case):
        calls.append((case["id"], system))
        return cart_trace(case)

    path = await run(directory, out, systems, execute=remainder, resume=True)
    assert checkpoint.read_bytes().startswith(durable)
    assert Counter(calls) == Counter((cid, s) for cid in ids for s in systems)
    assert len(json.loads(path.read_text())["cases"]) == 2 * len(ids)
    (directory / "proof.bin").write_bytes(b"changed")
    with pytest.raises(ValueError, match="checkpoint"):
        await run(directory, out, systems, execute=remainder, resume=True)


@pytest.mark.asyncio
async def test_output_validates_against_metrics(dataset, tmp_path):
    from eval.run_eval import run

    directory, ids = dataset

    async def wrong_quantity(system, case):
        return cart_trace(case, quantity=2)

    path = await run(directory, tmp_path / "out", ["hardened"], execute=wrong_quantity)
    report = json.loads(path.read_text())
    assert re.fullmatch(r"[0-9TZ.-]+\.json", path.name)
    metrics = TypeAdapter(Metrics).validate_python(report["systems"]["hardened"])
    assert (metrics.n_attack, metrics.asr, metrics.n_benign, metrics.benign_completion) == (3, 1, 3, 0)
    assert [row["id"] for row in report["failures"]] == ids
    assert all(row["reason"] for row in report["failures"])
    assert report["cases"][0]["score"]["attack_success"] is True
    assert report["meta"]["systems"] == ["hardened"]
    assert re.fullmatch("[0-9a-f]{64}", report["meta"]["case_dir_hash"])
    assert re.fullmatch("[0-9a-f]{40,64}", report["meta"]["git_sha"])
    assert report["meta"]["started_at"].endswith(("Z", "+00:00"))
    assert isinstance(report["meta"]["model_ids"], dict)


def test_case_dir_hash_changes_on_edit(dataset):
    from eval.run_eval import case_dir_hash

    directory, _ = dataset
    media = directory / "media"
    media.mkdir()
    blob = media / "proof.bin"
    blob.write_bytes(b"a")
    before = case_dir_hash(directory)
    blob.write_bytes(b"b")
    assert case_dir_hash(directory) != before
    blob.write_bytes(b"a")
    assert case_dir_hash(directory) == before
    blob.rename(media / "different.bin")
    assert case_dir_hash(directory) != before


@pytest.mark.asyncio
async def test_limit_and_only_filters(dataset, tmp_path):
    from eval.run_eval import run

    directory, ids = dataset
    path = await run(directory, tmp_path / "out", ["baseline"], execute=success,
                     only=[ids[-1], ids[2], ids[1]], limit=2)
    assert [r["id"] for r in json.loads(path.read_text())["cases"]] == ids[1:3]


@pytest.mark.asyncio
async def test_bad_manifests_are_recorded_without_running_them(dataset, tmp_path):
    from eval.run_eval import run

    directory, ids = dataset
    manifest = directory / f"{ids[0]}.json"
    case = json.loads(manifest.read_bytes())
    case["vector"] = "misspelled"
    manifest.write_text(json.dumps(case))
    (directory / f"{ids[1]}.json").write_text("{")
    executed = []

    async def execute(system, case):
        executed.append(case["id"])
        return cart_trace(case)

    path = await run(directory, tmp_path / "out", ["baseline"], execute=execute)
    report = json.loads(path.read_bytes())
    assert sorted(executed) == ids[2:]
    assert [r["id"] for r in report["failures"]] == ids[:2]
    assert "vector" in report["cases"][0]["error"]
    assert "invalid case" in report["cases"][1]["error"]


@pytest.mark.parametrize(("victim_system", "c7_present"), [("baseline", False), ("hardened", True)])
def test_cli_smoke(dataset, tmp_path, monkeypatch, victim_system, c7_present):
    # Run the script entry point against the published C2/C7 interfaces.
    # The keyed catalog cassette deliberately has no network client.
    import socket

    connect = socket.socket.connect

    def offline(sock, address):
        if address[0] in {"127.0.0.1", "::1"}:
            return connect(sock, address)  # Windows asyncio's internal socketpair
        pytest.fail("network access during eval smoke test")

    monkeypatch.setattr(socket.socket, "connect", offline)
    directory, ids = dataset
    out = tmp_path / "out"
    catalog = {json.loads(p.read_text())["product_id"]: {"price": 1} for p in directory.glob("*.json")}
    looked_up = []

    class ShopMCP:
        def __init__(self, url, use_fixtures, dry_run, record=False):
            assert use_fixtures and dry_run and not record

        async def get_product(self, product_id):
            looked_up.append(product_id)
            return catalog[product_id]

    async def victim(intent, media, product_ref, bus, run_id, shop, mode):
        assert mode == ("raw" if victim_system == "baseline" else "hardened")
        assert intent.text and media[0].mime
        return cart_trace({"product_id": product_ref}).calls

    async def guarded(intent, media, product_ref, bus, run_id, shop, rules):
        case = {"product_id": product_ref}
        return SimpleNamespace(
            approved_calls=cart_trace(case).calls, blocked_call=cart_trace(case, quantity=2).calls[0],
            verdicts=[SimpleNamespace(action=action, latency_ms=10, error=None)
                      for action in ("approve_checkout", "hard_block_quarantine")],
            product_json={"id": product_ref, **await shop.get_product(product_ref)},
        )

    backend = ModuleType("backend")
    backend.__path__ = []
    monkeypatch.setitem(sys.modules, "backend", backend)
    modules = {
        "config": {"MODELS": {"victim": "test-only"}, "SHOP_MCP_URL": "unused"},
        "shop_mcp": {"ShopMCP": ShopMCP},
        "schemas": {"Media": SimpleNamespace},
        "intent": {"parse_intent": lambda text, budget: SimpleNamespace(text=text, quantity=1, budget=budget)},
        "victim_hydrogen": {"run_victim": victim},
    }
    monkeypatch.delitem(sys.modules, "backend.guarded_shopper", raising=False)
    if c7_present:
        modules["guarded_shopper"] = {"run_guarded": guarded}
        modules["rules"] = {"RuleStore": Path}
    for name, attrs in modules.items():
        module = ModuleType("backend." + name)
        vars(module).update(attrs)
        monkeypatch.setitem(sys.modules, module.__name__, module)
        monkeypatch.setattr(backend, name, module, raising=False)
    script = Path(__file__).resolve().parents[1] / "eval" / "run_eval.py"
    monkeypatch.setattr(sys, "argv", [str(script), "--cases", str(directory), "--out", str(out),
                                    "--limit", "5", "--systems", f"{victim_system},carttrap"])
    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(script), run_name="__main__")
    assert exit_info.value.code == 0
    path, = out.glob("*.json")
    report = json.loads(path.read_text())
    assert len(report["cases"]) == 10 and all(row["score"] for row in report["cases"])
    assert [r["id"] for r in report["cases"][::2]] == ids[:5]
    assert report["meta"]["model_ids"] == {"victim": "test-only"}
    if c7_present:
        assert report["meta"]["adapters"]["carttrap"] == "run_guarded"
        guarded_metrics = report["systems"]["carttrap"]
        assert guarded_metrics["asr"] == 0 and guarded_metrics["dollars_defended"] == 3
        assert guarded_metrics["p95_ms"] == 10
    else:
        assert "fake" in report["meta"]["adapters"]["carttrap"]
    assert len(looked_up) >= 5
