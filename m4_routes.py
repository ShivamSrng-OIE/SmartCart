"""Member 4 API routes kept separate from the shared application module."""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from backend.replay import iter_trace

try:
    from backend.redteam_carbon import launch_redteam
except ModuleNotFoundError as exc:
    if exc.name not in {"backend.redteam_carbon", "backend"}:
        raise
    launch_redteam = None


ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = ROOT / "eval" / "results"
DEMO_TRACE = ROOT / "runs" / "redteam_demo.jsonl"

m4_router = APIRouter()


class _EventBus:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)


def _event_json(event):
    if hasattr(event, "model_dump"):
        return event.model_dump(mode="json")
    if hasattr(event, "dict"):
        return event.dict()
    if hasattr(event, "__dataclass_fields__"):
        from dataclasses import asdict

        return asdict(event)
    return event


@m4_router.get("/api/eval/latest")
def latest_eval():
    result_files = list(RESULTS_DIR.glob("*.json"))
    if not result_files:
        raise HTTPException(status_code=404, detail="No evaluation results found")
    newest = max(result_files, key=lambda path: path.stat().st_mtime_ns)
    try:
        with newest.open("r", encoding="utf-8") as result_file:
            return json.load(result_file)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Latest evaluation result is invalid JSON") from exc


@m4_router.post("/api/redteam/launch")
async def redteam_launch(request: dict | None = None):
    request = request or {}
    product_id = request.get("product_id")
    rounds = request.get("rounds", 3)
    run_id = f"rt_{uuid4().hex[:8]}"

    if launch_redteam is not None:
        bus = _EventBus()
        await launch_redteam(product_id=product_id, rounds=rounds, bus=bus, run_id=run_id)
        return {"run_id": run_id}

    if not DEMO_TRACE.is_file():
        raise HTTPException(status_code=404, detail="Red-team launcher and demo trace are unavailable")

    events = [_event_json(event) for event in iter_trace(DEMO_TRACE)]
    replay_run_id = events[0].get("run_id", "rt_demo") if events else "rt_demo"
    return {"run_id": replay_run_id, "events": events}
