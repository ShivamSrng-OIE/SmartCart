"""Neon defender: fraud card, Dollars Defended, safe swap (Task 10).

Shop access goes only through the ShopMCP interface. This module never calls
the forbidden Shop tools (checkout completion, spend-request completion or creation).

The stubs below are used only until the real modules exist:
  - backend.schemas   (Member 2, C1)  -> Intent, Claims, ToolCall, ProbeResult, Verdict, FraudCard
  - backend.config    (Member 1)      -> MODELS["defender"]
  - ShopMCP           (Member 1, C2)  -> structural Protocol ShopLike below
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel

log = logging.getLogger(__name__)

# ---------------------------------------------------------------- schema stubs
try:  # real schemas win as soon as they exist
    from backend.schemas import Claims, FraudCard, Intent, ProbeResult, ToolCall, Verdict
except ImportError:  # STUB: remove when backend/schemas.py lands (C1)

    class Intent(BaseModel):
        text: str
        budget: float | None = None
        quantity: int = 1

    class Claims(BaseModel):
        visible_text: list[str] = []
        pack_count_claim: int | None = None
        brand_claims: list[str] = []
        audio_transcript: str | None = None
        instructions_detected: bool = False
        notes: str = ""

    class ToolCall(BaseModel):
        name: str
        arguments: dict

    class ProbeResult(BaseModel):
        id: str
        p: float
        fired: bool

    class Verdict(BaseModel):
        action: Literal["approve_checkout", "escalate_to_neon_swap", "hard_block_quarantine"]
        action_probs: dict[str, float]
        probes: list[ProbeResult]
        severity: int
        latency_ms: int
        tier: Literal["low", "normal", "high", "spend_request"]
        backend: Literal["decisions", "json_llm"]
        error: str | None = None

    class FraudCard(BaseModel):
        reason: str
        media_claimed: list[str]
        shopify_sells: dict | None
        top_probes: list[ProbeResult]
        dollars_defended: float
        safe_cart: dict | None


try:
    from backend.config import MODELS

    NEON_MODEL = MODELS["defender"]
except (ImportError, KeyError):  # TODO: remove stub once backend/config.py exists (model IDs live only there)
    NEON_MODEL = "TODO-neon-model-id"

NEON_TIMEOUT_S = 8.0
PROMPT_PATH = Path(__file__).parent / "prompts" / "neon_fraud_card.md"


class ShopLike(Protocol):
    """The slice of ShopMCP (C2) the defender uses. Signatures follow ADR m4/0008."""

    async def search_catalog(self, query: str, **filters) -> list[dict]: ...
    async def get_product(self, product_id: str) -> dict: ...
    async def create_checkout(self, shop: str, lines: list[dict]) -> dict: ...
    async def create_cart(self, shop: str, lines: list[dict]) -> dict: ...


# ------------------------------------------------------------------- money
def dollars_defended(attempted: float, safe_total: float | None) -> float:
    return max(0.0, attempted - (safe_total or 0))


# ------------------------------------------------------------- product facts
def _price(product: dict) -> float | None:
    raw = product.get("price")
    if isinstance(raw, dict):
        raw = raw.get("amount")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _shop_domain(product: dict) -> str | None:
    seller = product.get("seller")
    if isinstance(seller, dict) and seller.get("domain"):
        return seller["domain"]
    return product.get("shop") or product.get("domain")


def _shopify_sells(product_json: dict | None) -> dict | None:
    """Quote real get_product fields only. Missing fields stay missing."""
    if not product_json:
        return None
    sells = {"title": product_json.get("title"), "price": product_json.get("price")}
    pid = product_json.get("id") or product_json.get("product_id")
    if pid is not None:
        sells["product_id"] = pid
    for key in ("units", "pack_size", "quantity"):
        if key in product_json:
            sells[key] = product_json[key]
    return sells


# --------------------------------------------------------------- fraud card
def _media_claimed(claims: Claims | None) -> list[str]:
    if claims is None:
        return []
    out = list(claims.visible_text)
    if claims.audio_transcript:
        out.append(claims.audio_transcript)
    if claims.pack_count_claim:
        out.append(f"{claims.pack_count_claim}-pack")
    return out


def _top_probes(verdict: Verdict, n: int = 3) -> list[ProbeResult]:
    fired = [p for p in verdict.probes if p.fired]
    pool = fired or verdict.probes
    return sorted(pool, key=lambda p: p.p, reverse=True)[:n]


def _template_reason(verdict, claims, product_json, blocked, attempted) -> str:
    parts = [f"CartTrap blocked {blocked.name} before any money moved (attempted ${attempted:,.2f})."]
    if claims is not None and claims.instructions_detected:
        parts.append("The photo, audio or document contained text trying to give orders to the shopping agent.")
    if claims is not None and claims.pack_count_claim and product_json:
        title = product_json.get("title")
        parts.append(
            f'The media claims a {claims.pack_count_claim}-pack, but Shopify lists "{title}" '
            f"at {product_json.get('price')}."
        )
    elif product_json is None:
        parts.append("The product could not be verified against Shopify.")
    return " ".join(parts)


def template_fraud_card(verdict, claims, product_json, blocked, attempted) -> FraudCard:
    return FraudCard(
        reason=_template_reason(verdict, claims, product_json, blocked, attempted),
        media_claimed=_media_claimed(claims),
        shopify_sells=_shopify_sells(product_json),
        top_probes=_top_probes(verdict),
        dollars_defended=dollars_defended(attempted, None),
        safe_cart=None,
    )


def _neon_prompt(verdict, claims, product_json, blocked, attempted) -> str:
    fired = [{"id": p.id, "p": p.p} for p in _top_probes(verdict, 5)]
    claims_json = claims.model_dump_json() if claims is not None else "null"
    subs = {
        "<<INTENT>>": "(see blocked call)",
        "<<BLOCKED>>": json.dumps(blocked.model_dump()),
        "<<ATTEMPTED>>": f"{attempted:.2f}",
        "<<PRODUCT>>": json.dumps(product_json),
        "<<CLAIMS>>": claims_json,
        "<<PROBES>>": json.dumps(fired),
    }
    text = PROMPT_PATH.read_text(encoding="utf-8")
    for k, v in subs.items():
        text = text.replace(k, v)
    return text


class _NeonText(BaseModel):
    reason: str


async def _neon_reason(prompt: str) -> str:
    """One Neon call, structured output. Raises on any failure; caller falls back."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    resp = await client.aio.models.generate_content(
        model=NEON_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_NeonText
        ),
    )
    parsed = resp.parsed
    if parsed is None or not parsed.reason.strip():
        raise ValueError("empty neon reason")
    return parsed.reason.strip()


async def build_fraud_card(verdict, claims, product_json, blocked, attempted, safe_cart) -> FraudCard:
    card = template_fraud_card(verdict, claims, product_json, blocked, attempted)
    card.safe_cart = safe_cart
    card.dollars_defended = dollars_defended(attempted, (safe_cart or {}).get("total"))
    try:
        prompt = _neon_prompt(verdict, claims, product_json, blocked, attempted)
        card.reason = await asyncio.wait_for(_neon_reason(prompt), timeout=NEON_TIMEOUT_S)
    except Exception as exc:  # timeout or any Neon error: template reason stays, UI never hangs
        log.warning("neon fraud card fell back to template: %r", exc)
    return card


# ---------------------------------------------------------------- safe swap
async def safe_swap(intent: Intent, original: dict | None, shop: ShopLike) -> dict | None:
    """Honest product within the user's budget and quantity, ending in a real checkout link.

    Returns {checkout_id, continue_url, shop, line_items, total} or None. continue_url is
    passed through byte for byte (ADR m4/0008).
    """
    query = (original or {}).get("title") or intent.text
    qty = intent.quantity
    candidates = []
    for offer in await shop.search_catalog(query):
        price = _price(offer)
        if price is not None:
            candidates.append((price, offer))
    candidates.sort(key=lambda c: c[0])

    for _, offer in candidates:
        product = await shop.get_product(offer["id"])  # truth ledger, not the search snippet
        price = _price(product)
        domain = _shop_domain(product) or _shop_domain(offer)
        if price is None or domain is None:
            continue
        total = round(price * qty, 2)
        if intent.budget is not None and total > intent.budget:
            continue
        lines = [{"product_id": product.get("id", offer["id"]), "quantity": qty}]
        try:
            res = await shop.create_checkout(domain, lines)
        except Exception as exc:  # ADR 0008: anonymous checkout may fail live; fall back to cart
            log.warning("create_checkout failed (%r); falling back to create_cart", exc)
            res = await shop.create_cart(domain, lines)
        out = {
            "checkout_id": res.get("id") or res.get("checkout_id"),
            "continue_url": res.get("continue_url"),
            "shop": domain,
            "line_items": lines,
            "total": total,
        }
        if res.get("intercepted"):
            out["intercepted"] = True
        return out
    return None
