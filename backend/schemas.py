"""Shared data shapes for CartTrap (contract C1).

Everyone builds on these. After the 11:00 checkpoint, changes here are
ADDITIVE ONLY: new optional fields are fine, renames and removals are not.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Category = Literal["injection", "pack_lie", "spend_hijack", "coercion",
                   "split_payload", "privacy", "promo_benign"]
Action = Literal["approve_checkout", "escalate_to_neon_swap", "hard_block_quarantine"]
Tier = Literal["low", "normal", "high", "spend_request"]


class Media(BaseModel):
    kind: Literal["image", "audio", "video", "pdf"]
    path: str
    mime: str


class Intent(BaseModel):
    """Trusted user intent: Request box text + budget field only."""
    text: str
    budget: float | None
    quantity: int = Field(default=1, ge=1)


class Claims(BaseModel):
    """Argon output. UNTRUSTED: pass to other models as quoted data only."""
    visible_text: list[str]
    pack_count_claim: int | None
    brand_claims: list[str]
    audio_transcript: str | None
    instructions_detected: bool
    notes: str = ""


class ToolCall(BaseModel):
    name: str
    arguments: dict


class Probe(BaseModel):
    id: str
    type: Literal["noul", "choice", "score"]
    category: Category
    instructions: str
    threshold: float = 0.10
    tiers: dict[str, float] = Field(default_factory=dict)  # per-tier threshold overrides, e.g. {"low": 0.25}
    added_by: str
    created_at: str


class ProbeResult(BaseModel):
    id: str
    p: float
    fired: bool


class Verdict(BaseModel):
    action: Action
    action_probs: dict[str, float]
    probes: list[ProbeResult]
    severity: int
    latency_ms: int
    tier: Tier
    backend: Literal["decisions", "json_llm"]
    error: str | None = None  # set when the firewall failed closed


class FraudCard(BaseModel):
    reason: str
    media_claimed: list[str]
    shopify_sells: dict | None
    top_probes: list[ProbeResult]
    dollars_defended: float
    safe_cart: dict | None


class TraceEvent(BaseModel):
    run_id: str
    pane: Literal["victim", "guarded", "redteam"]
    t_ms: int
    kind: Literal["tool_call", "tool_result", "intercepted", "verdict", "fraud_card", "log", "done"]
    data: dict
