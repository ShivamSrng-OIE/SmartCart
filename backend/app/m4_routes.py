"""Member 4 API routes kept separate from the shared application module."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request

from app.replay import replay_trace

try:
    from app.redteam_carbon import launch_redteam
except Exception:
    launch_redteam = None


ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = ROOT / "eval" / "results"
DEMO_TRACE = ROOT / "runs" / "redteam_demo.jsonl"
GOLDEN_REDS = ROOT / "eval" / "golden" / "redteam"
REPLAY_SPEED = float(os.getenv("REPLAY_SPEED", "1.0"))
_tasks: set[asyncio.Task] = set()

m4_router = APIRouter()


class _BusAdapter:
    """Adapt Carbon's one-event interface to the app's four-field TraceBus."""

    def __init__(self, bus):
        self.bus = bus

    def emit(self, event) -> None:
        if isinstance(event, dict):
            run_id, pane, kind, data = (event[key] for key in ("run_id", "pane", "kind", "data"))
        else:
            run_id, pane, kind, data = (getattr(event, key) for key in ("run_id", "pane", "kind", "data"))
        self.bus.emit(run_id, pane, kind, data)


def _latest_result_file() -> Path | None:
    preferred = RESULTS_DIR / "latest.json"
    if preferred.is_file():
        return preferred
    candidates = [path for path in RESULTS_DIR.glob("*.json") if path.name != "sample.json"]
    if candidates:
        return max(candidates, key=lambda path: path.stat().st_mtime_ns)
    return None


@m4_router.get("/api/eval/latest")
def latest_eval():
    newest = _latest_result_file()
    if newest is None:
        raise HTTPException(status_code=404, detail="No evaluation results found")
    try:
        with newest.open("r", encoding="utf-8") as result_file:
            return json.load(result_file)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Latest evaluation result is invalid JSON") from exc


def _app_dependencies(request: Request):
    """Read app-specific shared objects, importing main lazily for compatibility."""
    main = None
    if not hasattr(request.app.state, "bus") or not hasattr(request.app.state, "rules"):
        from app import main as main_module

        main = main_module
    bus = getattr(request.app.state, "bus", None) or main.app.state.bus
    rules = getattr(request.app.state, "rules", None)
    if rules is None:
        if main is None:
            from app import main as main
        rules = main.RULES
    return bus, rules


async def _run_redteam(bus, store, run_id: str, product_id, rounds) -> None:
    if launch_redteam is None:
        await replay_trace(DEMO_TRACE, bus, run_id, REPLAY_SPEED)
        return
    await launch_redteam(product_id, rounds, _BusAdapter(bus), run_id, store=store)


@m4_router.post("/api/redteam/launch")
async def redteam_launch(request: Request, body: dict | None = None):
    body = body or {}
    product_id = body.get("product_id")
    rounds = body.get("rounds", 3)
    run_id = f"rt_{uuid4().hex[:8]}"
    bus, store = _app_dependencies(request)
    bus.start(run_id)

    use_recorded_golden = GOLDEN_REDS.is_dir() and any(GOLDEN_REDS.glob("*.json"))
    try:
        from app.config import MANAGED_AGENTS
    except Exception:
        managed_agents = False
    else:
        managed_agents = MANAGED_AGENTS

    if launch_redteam is None or (not managed_agents and not use_recorded_golden):
        if not DEMO_TRACE.is_file():
            raise HTTPException(status_code=404, detail="Red-team launcher and demo trace are unavailable")
        task = asyncio.create_task(replay_trace(DEMO_TRACE, bus, run_id, REPLAY_SPEED))
    else:
        task = asyncio.create_task(_run_redteam(bus, store, run_id, product_id, rounds))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"run_id": run_id}
