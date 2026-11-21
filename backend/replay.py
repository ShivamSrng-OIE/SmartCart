"""Read recorded trace events without executing their tool calls."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator


def _trace_event(payload: dict):
    """Build the shared TraceEvent type when available; otherwise retain JSON."""
    try:
        from backend.schemas import TraceEvent
    except ModuleNotFoundError as exc:
        if exc.name not in {"backend", "backend.schemas"}:
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
