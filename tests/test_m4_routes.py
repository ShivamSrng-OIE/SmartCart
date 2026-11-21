import json
from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import m4_routes
from backend.replay import iter_trace


@pytest.fixture
def client(tmp_path, monkeypatch):
    results = tmp_path / "results"
    runs = tmp_path / "runs"
    results.mkdir()
    runs.mkdir()
    monkeypatch.setattr(m4_routes, "RESULTS_DIR", results)
    monkeypatch.setattr(m4_routes, "DEMO_TRACE", runs / "redteam_demo.jsonl")
    app = FastAPI()
    app.include_router(m4_routes.m4_router)
    return TestClient(app), results, runs


def test_latest_eval_returns_newest_json(client):
    http, results, _ = client
    (results / "old.json").write_text('{"tag":"old"}', encoding="utf-8")
    (results / "new.json").write_text('{"tag":"new"}', encoding="utf-8")

    response = http.get("/api/eval/latest")

    assert response.status_code == 200
    assert response.json() == {"tag": "new"}


def test_latest_eval_returns_404_when_no_results(client):
    http, _, _ = client

    response = http.get("/api/eval/latest")

    assert response.status_code == 404


def test_iter_trace_yields_jsonl_events_in_order(tmp_path):
    trace = tmp_path / "trace.jsonl"
    events = [
        {"run_id": "rt_1", "pane": "redteam", "t_ms": 1, "kind": "log", "data": {"step": 1}},
        {"run_id": "rt_1", "pane": "redteam", "t_ms": 2, "kind": "done", "data": {"step": 2}},
    ]
    trace.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")

    got = [e.model_dump() if hasattr(e, "model_dump") else e for e in iter_trace(trace)]
    assert got == events


def test_launch_redteam_replays_demo_when_live_module_missing(client, monkeypatch):
    http, _, runs = client
    events = [
        {"run_id": "rt_demo", "pane": "redteam", "t_ms": 1, "kind": "log", "data": {"message": "replayed"}},
    ]
    (runs / "redteam_demo.jsonl").write_text(
        "\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8"
    )
    monkeypatch.setattr(m4_routes, "launch_redteam", None)

    response = http.post("/api/redteam/launch", json={"rounds": 1})

    assert response.status_code == 200
    assert response.json() == {"run_id": "rt_demo", "events": events}


@pytest.mark.asyncio
async def test_launch_redteam_calls_importable_launcher(client, monkeypatch):
    http, _, _ = client
    calls = []

    @dataclass
    class Event:
        run_id: str = "rt_live"
        pane: str = "redteam"
        t_ms: int = 1
        kind: str = "done"
        data: dict | None = None

    class Bus:
        def emit(self, event):
            calls.append(event)

    async def launch_redteam(product_id, rounds, bus, run_id):
        calls.append((product_id, rounds, run_id))
        bus.emit(Event(data={"done": True}))
        return []

    monkeypatch.setattr(m4_routes, "launch_redteam", launch_redteam)

    response = http.post("/api/redteam/launch", json={"product_id": "sku-7", "rounds": 2})

    assert response.status_code == 200
    assert response.json() == {"run_id": calls[0][2]}
    assert calls[0][:2] == ("sku-7", 2)
