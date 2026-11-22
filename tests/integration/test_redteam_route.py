import asyncio

from app import config, m4_routes, main
from app.schemas import TraceEvent

from .conftest import PRODUCT_ID, read_sse


async def test_redteam_launch_streams_background_stages(api_client, monkeypatch):
    release = asyncio.Event()
    calls = []

    async def fake_launch(product_id, rounds, bus, run_id, *, store):
        calls.append((product_id, rounds, run_id, store))
        await release.wait()
        for kind, stage, message in [
            ("log", "attack", "Loaded the recorded attack."),
            ("log", "blocked", "The firewall blocked the cart."),
            ("done", "done", "Finished."),
        ]:
            bus.emit(TraceEvent(
                run_id=run_id, pane="redteam", t_ms=0, kind=kind, data={"stage": stage, "message": message},
            ))

    monkeypatch.setattr(config, "MANAGED_AGENTS", True)
    monkeypatch.setattr(m4_routes, "launch_redteam", fake_launch)
    try:
        response = await asyncio.wait_for(
            api_client.post("/api/redteam/launch", json={"product_id": PRODUCT_ID, "rounds": 1}), 5,
        )
    finally:
        release.set()
    response.raise_for_status()
    run_id = response.json()["run_id"]
    assert run_id.startswith("rt_")
    events = await read_sse(api_client, run_id)
    assert [(event.pane, event.kind, event.data["stage"]) for event in events] == [
        ("redteam", "log", "attack"), ("redteam", "log", "blocked"), ("redteam", "done", "done"),
    ]
    assert all(event.data["message"] for event in events)
    assert calls == [(PRODUCT_ID, 1, run_id, main.app.state.rules)]
