"""Shared contract types (spec: docs/team/member-2.md, Task 3).
Member 1 added the four types the API needs; Member 2 adds Claims, Probe, ProbeResult, Verdict, FraudCard here."""
from typing import Literal

from pydantic import BaseModel


class Media(BaseModel):
    kind: Literal["image", "audio", "video", "pdf"]
    path: str
    mime: str


class Intent(BaseModel):
    text: str
    budget: float | None
    quantity: int = 1


class ToolCall(BaseModel):
    name: str
    arguments: dict


class TraceEvent(BaseModel):
    run_id: str
    # "system" is used only for the final `done` event, which belongs to no pane.
    pane: Literal["victim", "guarded", "redteam", "system"]
    t_ms: int
    kind: Literal["tool_call", "tool_result", "intercepted", "verdict", "fraud_card", "log", "done"]
    data: dict
