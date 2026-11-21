import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import m4_routes
from backend.replay import iter_trace
from backend.trace import TraceBus


def _wait_events(bus, run_id, timeout=3.0):
    """Background tasks finish on the TestClient's loop; poll instead of assuming timing."""
    import time
    deadline = time.monotonic() + timeout
    events = []
    while time.monotonic() < deadline:
        events = list(bus.events(run_id))
        if events and events[-1].kind == "done":
            return events
        time.sleep(0.02)
    return events


@pytest.fixture
def client(tmp_path, monkeypatch):
    results = tmp_path / "results"
    runs = tmp_path / "runs"
    results.mkdir()
    runs.mkdir()
    monkeypatch.setattr(m4_routes, "RESULTS_DIR", results)
    monkeypatch.setattr(m4_routes, "DEMO_TRACE", runs / "redteam_demo.jsonl")
    app = FastAPI()
    app.state.bus = TraceBus()
    app.state.rules = object()
    app.include_router(m4_routes.m4_router)
    with TestClient(app) as http:
        yield http, results, runs


def test_latest_eval_returns_newest_json(client):
    http, results, _ = client
    (results / "old.json").write_text('{"tag":"old"}', encoding="utf-8")
    (results / "new.json").write_text('{"tag":"new"}', encoding="utf-8")

    response = http.get("/api/eval/latest")

    assert response.status_code == 200
    assert response.json() == {"tag": "new"}


def test_latest_prefers_latest_json(client):
    http, results, _ = client
    (results / "latest.json").write_text('{"tag":"frozen"}', encoding="utf-8")
    (results / "later.json").write_text('{"tag":"newer mtime"}', encoding="utf-8")

    response = http.get("/api/eval/latest")

    assert response.status_code == 200
    assert response.json() == {"tag": "frozen"}


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
    monkeypatch.setattr(m4_routes, "REPLAY_SPEED", 0)

    response = http.post("/api/redteam/launch", json={"rounds": 1})

    assert response.status_code == 200
    run_id = response.json()["run_id"]
    assert run_id != "rt_demo"
    stream_events = [event.model_dump() for event in _wait_events(http.app.state.bus, run_id)]
    assert stream_events[0]["data"]["message"] == "replayed"
    assert stream_events[-1]["kind"] == "done"


def test_replay_pushes_events_with_done(client, monkeypatch):
    http, _, runs = client
    events = [
        {"run_id": "source", "pane": "redteam", "t_ms": 4, "kind": "log", "data": {"stage": "attack"}},
        {"run_id": "source", "pane": "redteam", "t_ms": 9, "kind": "verdict", "data": {"action": "blocked"}},
    ]
    (runs / "redteam_demo.jsonl").write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")
    monkeypatch.setattr(m4_routes, "launch_redteam", None)
    monkeypatch.setattr(m4_routes, "REPLAY_SPEED", 0)

    response = http.post("/api/redteam/launch")
    run_id = response.json()["run_id"]
    stream_events = [event.model_dump() for event in _wait_events(http.app.state.bus, run_id)]

    assert [event["kind"] for event in stream_events] == ["log", "verdict", "done"]
    assert all(event["run_id"] == run_id for event in stream_events)
    assert stream_events[0]["data"]["stage"] == "attack"


@pytest.mark.asyncio
async def test_launch_redteam_calls_importable_launcher(client, monkeypatch):
    http, _, _ = client
    calls = []
    monkeypatch.setattr("backend.config.MANAGED_AGENTS", True)

    async def launch_redteam(product_id, rounds, bus, run_id, *, store):
        calls.append((product_id, rounds, run_id, store))
        bus.emit(type("Event", (), {"run_id": run_id, "pane": "redteam", "kind": "done", "data": {"done": True}})())
        return []

    monkeypatch.setattr(m4_routes, "launch_redteam", launch_redteam)

    response = http.post("/api/redteam/launch", json={"product_id": "sku-7", "rounds": 2})

    assert response.status_code == 200
    run_id = response.json()["run_id"]
    assert run_id == calls[0][2]
    assert calls[0][:2] == ("sku-7", 2)


def test_launch_returns_run_id_and_streams_via_bus(client, monkeypatch):
    http, _, _ = client
    monkeypatch.setattr(m4_routes, "REPLAY_SPEED", 0)
    monkeypatch.setattr("backend.config.MANAGED_AGENTS", True)

    async def launch_redteam(product_id, rounds, bus, run_id, *, store):
        bus.emit(type("Event", (), {"run_id": run_id, "pane": "redteam", "kind": "log", "data": {"stage": "started"}})())
        bus.emit(type("Event", (), {"run_id": run_id, "pane": "redteam", "kind": "done", "data": {}})())

    monkeypatch.setattr(m4_routes, "launch_redteam", launch_redteam)
    response = http.post("/api/redteam/launch", json={"product_id": "sku", "rounds": 1})

    assert response.status_code == 200
    run_id = response.json()["run_id"]
    assert set(response.json()) == {"run_id"}
    events = [event.model_dump() for event in _wait_events(http.app.state.bus, run_id)]
    assert [event["kind"] for event in events] == ["log", "done"]
    assert events[0]["data"]["stage"] == "started"


def test_launch_uses_app_rules_store(client, monkeypatch):
    http, _, _ = client
    store = http.app.state.rules
    calls = []
    monkeypatch.setattr("backend.config.MANAGED_AGENTS", True)

    async def launch_redteam(product_id, rounds, bus, run_id, *, store):
        calls.append(store)
        bus.emit(type("Event", (), {"run_id": run_id, "pane": "redteam", "kind": "done", "data": {}})())

    monkeypatch.setattr(m4_routes, "launch_redteam", launch_redteam)
    response = http.post("/api/redteam/launch", json={})
    _wait_events(http.app.state.bus, response.json()["run_id"])

    assert calls == [store]
