import json

import httpx
import pytest

from backend.main import app, make_fake


@pytest.fixture
async def client():
    real = app.state.pipelines
    app.state.pipelines = {"victim": make_fake("victim"), "guarded": make_fake("guarded")}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c
    app.state.pipelines = real


def parse_sse(text: str) -> list[dict]:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


async def test_run_returns_id(client):
    r = await client.post("/api/run", data={"request": "buy one pack under $25"})
    assert r.status_code == 200 and r.json()["run_id"].startswith("r_")


async def test_stream_emits_both_panes_then_done(client):
    run_id = (await client.post("/api/run", data={"request": "buy one"})).json()["run_id"]
    events = parse_sse((await client.get(f"/api/runs/{run_id}/stream")).text)
    assert {e["pane"] for e in events[:-1]} == {"victim", "guarded"}
    assert len(events) == 5 and events[-1]["kind"] == "done"


async def test_stream_replays_from_start(client):
    run_id = (await client.post("/api/run", data={"request": "buy one"})).json()["run_id"]
    await app.state.bus.wait_done(run_id)  # pipelines already finished
    events = parse_sse((await client.get(f"/api/runs/{run_id}/stream")).text)
    assert [e["kind"] for e in events].count("tool_call") == 2 and events[-1]["kind"] == "done"


async def test_crashing_pipeline_still_finishes(client, monkeypatch):
    async def boom(*_):
        raise RuntimeError("model down")
    monkeypatch.setitem(app.state.pipelines, "guarded", boom)
    run_id = (await client.post("/api/run", data={"request": "buy one"})).json()["run_id"]
    events = parse_sse((await client.get(f"/api/runs/{run_id}/stream")).text)
    assert any(e["kind"] == "log" and "model down" in e["data"]["message"] for e in events)
    assert events[-1]["kind"] == "done"


async def test_image_upload_saved(client, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.main.RUNS_DIR", tmp_path)
    seen = {}

    async def capture(intent, media, product_ref, bus, run_id):
        seen["media"], seen["budget"] = media, intent.budget
    monkeypatch.setitem(app.state.pipelines, "victim", capture)
    r = await client.post("/api/run", data={"request": "buy one", "budget": "25", "mode": "victim"},
                          files={"image": ("note.png", b"\x89PNG fake", "image/png")})
    await app.state.bus.wait_done(r.json()["run_id"])
    assert seen["budget"] == 25.0 and seen["media"][0].kind == "image"
    assert (tmp_path / r.json()["run_id"] / "image.png").read_bytes() == b"\x89PNG fake"


async def test_run_prefers_product_id_over_demo_id_and_url(client, monkeypatch):
    seen = {}

    async def capture(intent, media, product_ref, bus, run_id):
        seen["product_ref"] = product_ref

    monkeypatch.setitem(app.state.pipelines, "victim", capture)
    response = await client.post(
        "/api/run",
        data={"request": "buy one", "mode": "victim", "product_id": "sku-selected",
              "demo_product_id": "sku-demo", "product_url": "https://shop.example/product"},
    )
    await app.state.bus.wait_done(response.json()["run_id"])

    assert seen["product_ref"] == "sku-selected"


async def test_unknown_run_404(client):
    assert (await client.get("/api/runs/nope/stream")).status_code == 404
