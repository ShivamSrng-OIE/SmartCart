"""CartTrap API: POST /api/run starts both pipelines on the same input; GET /api/runs/{id}/stream
streams their trace events over SSE.

A pipeline is `async (intent, media, product_ref, bus, run_id) -> None` and emits its own events.
Real pipelines replace the fakes in PIPELINES (victim: Task 5, guarded: Task 9)."""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app import config
from app.defender_neon import on_block as defender_on_block
from app.app_routes import app_router
from app.evidence_routes import evidence_router
from app.firewall_decisions import warm_up
from app.guarded_shopper import GUARDED_PROMPT, run_guarded
from app.intent import parse_intent
from app.m4_routes import m4_router
from app.media_prep import to_wav
from app.rules import RuleStore
from app.schemas import Intent, Media
from app.shop_mcp import ShopMCP
from app.trace import TraceBus
from app.victim_hydrogen import VICTIM_PROMPT, run_victim
from app.warehouse_shop import ALL_MATCHES_NOTE, WarehouseShop

RUNS_DIR = Path("runs")
LISTING_TEXT_MAX = 8000
log = logging.getLogger(__name__)

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
    shop = WarehouseShop(budget=intent.budget) if config.WAREHOUSE_IN_AGENT else ShopMCP()
    prompt = GUARDED_PROMPT + (ALL_MATCHES_NOTE if config.WAREHOUSE_IN_AGENT else "")
    await run_guarded(intent, media, product_ref, bus, run_id, shop=shop, rules=RULES, on_block=defender_on_block,
                      system_prompt=prompt)


async def victim_pipeline(intent, media, product_ref, bus, run_id):
    """Unprotected pane. Same extra listings as the guarded one, so both shoppers see the same store."""
    shop = WarehouseShop(dry_run=True, budget=intent.budget) if config.WAREHOUSE_IN_AGENT else ShopMCP(dry_run=True)
    prompt = VICTIM_PROMPT + (ALL_MATCHES_NOTE if config.WAREHOUSE_IN_AGENT else "")
    await run_victim(intent, media, product_ref, bus, run_id, shop=shop, system_prompt=prompt)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the Decisions API connection in the background so the first firewall check doesn't
    # pay for TLS + auth. warm_up() only logs on failure; startup never waits for it.
    task = asyncio.create_task(warm_up())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    yield


app = FastAPI(title="CartTrap", lifespan=lifespan)
app.state.bus = TraceBus()
app.state.rules = RULES  # one shared rules writer (ADR m4/0009)
app.include_router(m4_router)  # /api/eval/latest, /api/redteam/launch (ADR m4/0001)
app.include_router(app_router)  # /api/rules and /api/dataset (ADR m4/0021)
app.include_router(evidence_router)
app.state.pipelines = {"victim": victim_pipeline, "guarded": guarded_pipeline}
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
    mime = upload.content_type or "application/octet-stream"
    if kind == "pdf":
        mime = "application/pdf"
    if kind == "audio":  # webm/ogg/mp3 -> PCM WAV so Gemini and the audio evidence both read it
        converted = await to_wav(path)
        if converted != path:
            path, mime = converted, "audio/wav"
    return Media(kind=kind, path=str(path), mime=mime)


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
    product_id: str | None = Form(None),
    demo_product_id: str | None = Form(None),
    mode: str = Form("both"),
    listing_text: str | None = Form(None),
    image: UploadFile | None = None,
    audio: UploadFile | None = None,
    video: UploadFile | None = None,
    pdf: UploadFile | None = None,
) -> dict:
    panes = {"both": ["victim", "guarded"], "victim": ["victim"], "guarded": ["guarded"]}.get(mode)
    if panes is None:
        raise HTTPException(422, "mode must be both|victim|guarded")
    run_id = f"r_{uuid.uuid4().hex[:8]}"
    run_dir = RUNS_DIR / run_id
    media = [m for m in [await _save(image, "image", run_dir), await _save(audio, "audio", run_dir),
                         await _save(video, "video", run_dir), await _save(pdf, "pdf", run_dir)] if m]
    if listing_text and listing_text.strip():
        # The store's own description for the product being bought: untrusted, checked like any media.
        run_dir.mkdir(parents=True, exist_ok=True)
        path = run_dir / "listing.txt"
        path.write_text(listing_text.strip()[:LISTING_TEXT_MAX], encoding="utf-8")
        media.append(Media(kind="text", path=str(path), mime="text/plain"))
    intent = parse_intent(request, budget)  # budget field wins; else budget/qty parsed from the request text
    bus: TraceBus = app.state.bus
    bus.start(run_id)
    task = asyncio.create_task(_run_all(bus, run_id, panes, intent, media,
                                        product_id or demo_product_id or product_url))
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
