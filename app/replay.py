"""Read and replay recorded trace events without executing their tool calls."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Iterator


def _trace_event(payload: dict):
    """Build the shared TraceEvent type when available; otherwise retain JSON."""
    try:
        from app.schemas import TraceEvent
    except ModuleNotFoundError as exc:
        if exc.name not in {"app", "app.schemas"}:
            raise
        return payload

    if hasattr(TraceEvent, "model_validate"):
        return TraceEvent.model_validate(payload)
    if hasattr(TraceEvent, "parse_obj"):
        return TraceEvent.parse_obj(payload)
    return TraceEvent(**payload)


def iter_trace(path: str | Path) -> Iterator[object]:
    """Yield JSONL trace events in file order, ignoring blank lines."""
    with Path(path).open("r", encoding="utf-8") as trace_file:
        for line_number, line in enumerate(trace_file, start=1):
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid trace JSON on line {line_number}") from exc
            if not isinstance(payload, dict):
                raise ValueError(f"Trace event on line {line_number} must be a JSON object")
            yield _trace_event(payload)


def event_data(event: object) -> dict:
    """Return the fields of either a Pydantic event or a JSON dictionary."""
    if isinstance(event, dict):
        return event
    if hasattr(event, "model_dump"):
        return event.model_dump(mode="json")
    if hasattr(event, "dict"):
        return event.dict()
    if hasattr(event, "__dataclass_fields__"):
        from dataclasses import asdict

        return asdict(event)
    raise TypeError(f"Unsupported trace event: {type(event).__name__}")


async def replay_trace(path: str | Path, bus, run_id: str, speed: float = 1.0) -> None:
    """Replay a JSONL trace into ``bus``, remapping its run id and preserving timing gaps."""
    previous_t_ms = 0
    ended = False
    try:
        for source in iter_trace(path):
            event = event_data(source)
            t_ms = int(event.get("t_ms", 0))
            if speed > 0:
                await asyncio.sleep(max(0, t_ms - previous_t_ms) / 1000 / speed)
            previous_t_ms = t_ms
            kind = event.get("kind", "log")
            if kind == "done":
                ended = True
            bus.emit(run_id, event.get("pane", "redteam"), kind, event.get("data", {}))
    finally:
        if not ended:
            bus.emit(run_id, "system", "done", {})
