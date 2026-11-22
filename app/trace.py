"""In-memory event bus. Every run's events are kept in a list, so a subscriber that connects
late (or reconnects) replays from the start, then follows live until the `done` event."""
from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

from app.schemas import TraceEvent


class TraceBus:
    def __init__(self) -> None:
        self._events: dict[str, list[TraceEvent]] = {}
        self._wakeup: dict[str, asyncio.Event] = {}
        self._t0: dict[str, float] = {}

    def start(self, run_id: str) -> None:
        self._events[run_id] = []
        self._wakeup[run_id] = asyncio.Event()
        self._t0[run_id] = time.perf_counter()

    def has(self, run_id: str) -> bool:
        return run_id in self._events

    def emit(self, run_id: str, pane: str, kind: str, data: dict | None = None) -> TraceEvent:
        t_ms = int((time.perf_counter() - self._t0[run_id]) * 1000)
        e = TraceEvent(run_id=run_id, pane=pane, t_ms=t_ms, kind=kind, data=data or {})
        self._events[run_id].append(e)
        old, self._wakeup[run_id] = self._wakeup[run_id], asyncio.Event()
        old.set()
        return e

    def events(self, run_id: str) -> list[TraceEvent]:
        return list(self._events[run_id])

    async def subscribe(self, run_id: str) -> AsyncIterator[TraceEvent]:
        i = 0
        while True:
            evs = self._events[run_id]
            while i < len(evs):
                e = evs[i]
                i += 1
                yield e
                if e.kind == "done":
                    return
            await self._wakeup[run_id].wait()

    async def wait_done(self, run_id: str) -> list[TraceEvent]:
        return [e async for e in self.subscribe(run_id)]
