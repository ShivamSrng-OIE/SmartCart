"""CartTrap API: POST /api/run starts both pipelines on the same input; GET /api/runs/{id}/stream
streams their trace events over SSE.

A pipeline is `async (intent, media, product_ref, bus, run_id) -> None` and emits its own events.
Real pipelines replace the fakes in PIPELINES (victim: Task 5, guarded: Task 9)."""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from backend.guarded_shopper import run_guarded
from backend.intent import parse_intent
from backend.rules import RuleStore
from backend.schemas import Intent, Media
from backend.shop_mcp import ShopMCP
from backend.trace import TraceBus
from backend.victim_hydrogen import run_victim

RUNS_DIR = Path("runs")

Pipeline = Callable[[Intent, list[Media], str | None, TraceBus, str], Awaitable[None]]


def make_fake(pane: str) -> Pipeline:
    async def run(intent, media, product_ref, bus, run_id):
        bus.emit(run_id, pane, "tool_call", {"tool": "search_catalog", "arguments": {"catalog": {"query": intent.text}}})
        await asyncio.sleep(0.05)
        bus.emit(run_id, pane, "tool_result", {"tool": "search_catalog", "result": {"products": []}})
    return run


RULES = RuleStore(str(Path(__file__).resolve().parent / "rules.json"))  # shared, hot-reloads on edit


async def guarded_pipeline(intent, media, product_ref, bus, run_id):
    """Task 9: protected pane. Live ShopMCP (approved carts are really created; spend requests
    are still always intercepted and complete_* is forbidden inside shop_mcp)."""
    await run_guarded(intent, media, product_ref, bus, run_id, shop=ShopMCP(), rules=RULES)


app = FastAPI(title="CartTrap")
app.state.bus = TraceBus()
app.state.pipelines = {"victim": run_victim, "guarded": guarded_pipeline}
_tasks: set[asyncio.Task] = set()


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


async def _save(upload: UploadFile | None, kind: str, run_dir: Path) -> Media | None:
    if upload is None or not upload.filename:
        return None
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / f"{kind}{Path(upload.filename).suffix}"
    path.write_bytes(await upload.read())
    return Media(kind=kind, path=str(path), mime=upload.content_type or "application/octet-stream")


async def _run_all(bus: TraceBus, run_id: str, panes: list[str], intent: Intent, media: list[Media], product_ref: str | None):
    async def one(pane: str):
        try:
            await app.state.pipelines[pane](intent, media, product_ref, bus, run_id)
        except Exception as exc:  # a crashed pane must not hang the stream
            bus.emit(run_id, pane, "log", {"level": "error", "message": f"{type(exc).__name__}: {exc}"})

    await asyncio.gather(*(one(p) for p in panes))
    bus.emit(run_id, "system", "done", {})


@app.post("/api/run")
async def start_run(
    request: str = Form(...),
    budget: float | None = Form(None),
    product_url: str | None = Form(None),
    demo_product_id: str | None = Form(None),
    mode: str = Form("both"),
    image: UploadFile | None = None,
    audio: UploadFile | None = None,
    video: UploadFile | None = None,
) -> dict:
    panes = {"both": ["victim", "guarded"], "victim": ["victim"], "guarded": ["guarded"]}.get(mode)
    if panes is None:
        raise HTTPException(422, "mode must be both|victim|guarded")
    run_id = f"r_{uuid.uuid4().hex[:8]}"
    run_dir = RUNS_DIR / run_id
    media = [m for m in [await _save(image, "image", run_dir), await _save(audio, "audio", run_dir),
                         await _save(video, "video", run_dir)] if m]
    intent = parse_intent(request, budget)  # budget field wins; else budget/qty parsed from the request text
    bus: TraceBus = app.state.bus
    bus.start(run_id)
    task = asyncio.create_task(_run_all(bus, run_id, panes, intent, media, product_url or demo_product_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"run_id": run_id}


@app.get("/api/runs/{run_id}/stream")
async def stream(run_id: str) -> StreamingResponse:
    bus: TraceBus = app.state.bus
    if not bus.has(run_id):
        raise HTTPException(404, "unknown run")

    async def sse():
        async for e in bus.subscribe(run_id):
            yield f"data: {e.model_dump_json()}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
