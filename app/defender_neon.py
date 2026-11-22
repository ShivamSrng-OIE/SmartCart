"""Neon defender: fraud card, Dollars Defended, and safe swap via ShopMCP."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel

from app import config, gemini
from app.schemas import Claims, FraudCard, Intent, ProbeResult, ToolCall, Verdict

if TYPE_CHECKING:
    from app.guarded_shopper import BlockContext

log = logging.getLogger(__name__)

# Measured live: the Neon wording call takes ~15-17 s. An 8 s deadline meant the written
# explanation never arrived and every card fell back to the generic template. The template card
# and then the safe cart are emitted first, so nothing on screen waits for the wording.
NEON_TIMEOUT_S = 30.0
ON_BLOCK_TIMEOUT_S = 45.0
PROMPT_PATH = Path(__file__).parent / "prompts" / "neon_fraud_card.md"


class ShopLike(Protocol):
    """Catalog and cart operations used by the defender."""

    async def search_catalog(self, query: str, **filters) -> list[dict]: ...
    async def get_product(self, product_id: str) -> dict: ...
    async def create_cart(self, shop: str, lines: list[dict]) -> dict: ...


# ------------------------------------------------------------------- money
def dollars_defended(attempted: float, safe_total: float | None) -> float:
    return max(0.0, attempted - (safe_total or 0))


# ------------------------------------------------------------- product facts
BUDGET_CURRENCY = "USD"
_UNAVAILABLE_WORDS = ("out_of_stock", "out of stock", "outofstock", "unavailable", "sold_out", "sold out", "preorder_closed")


def _minor_units_to_dollars(amount: object) -> Decimal | None:
    if isinstance(amount, bool) or not isinstance(amount, (int, str)):
        return None
    try:
        cents = int(amount)
    except ValueError:
        return None
    return Decimal(cents) / 100 if cents >= 0 else None


def _usd_price(price: object) -> Decimal | None:
    if not isinstance(price, dict) or price.get("currency") != BUDGET_CURRENCY:
        return None
    return _minor_units_to_dollars(price.get("amount"))


def _purchasable(variant: dict) -> bool:
    """No availability field: assume purchasable. Otherwise it must not say unavailable."""
    if "availability" not in variant:
        return True
    av = variant["availability"]
    if isinstance(av, dict):
        for key in ("available", "purchasable", "in_stock"):
            if key in av:
                return bool(av[key])
        av = av.get("status") or av.get("state") or ""
    if isinstance(av, bool):
        return av
    return bool(av) and not any(w in str(av).lower() for w in _UNAVAILABLE_WORDS)


def _shopify_sells(product_json: dict | None) -> dict | None:
    """Quote real get_product fields only. Missing fields stay missing."""
    if not product_json:
        return None
    sells = {"title": product_json.get("title")}
    variants = product_json.get("variants") or []
    price = _usd_price(variants[0].get("price") if variants else product_json.get("price"))
    if price is not None:
        sells["price"] = float(price)
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
        out.append(f"Count claimed: {claims.pack_count_claim}")
    return out


def _top_probes(verdict: Verdict, n: int = 3) -> list[ProbeResult]:
    fired = [p for p in verdict.probes if p.fired]
    pool = fired or verdict.probes
    return sorted(pool, key=lambda p: p.p, reverse=True)[:n]


def _action_label(tool: str) -> str:
    return {"create_cart": "adding it to a cart", "update_cart": "changing a cart", "create_checkout": "starting a checkout",
            "update_checkout": "changing a checkout", "create_spend_request": "paying outside Shopify"}.get(tool, tool.replace("_", " "))


def flagged_quotes(media, claims: Claims | None) -> list[str]:
    """The exact sentences in the listing (its description, the text read off photos, the audio) that the rule
    scan recognises as orders to a shopping agent. They are quoted on the Fraud Card."""
    from app import scanner

    texts: list[str] = []
    for m in media or []:
        if m.kind == "text":
            try:
                texts.append(Path(m.path).read_text(encoding="utf-8", errors="replace"))
            except OSError:
                pass
    if claims is not None:
        texts += list(claims.visible_text)
        if claims.audio_transcript:
            texts.append(claims.audio_transcript)
    out: list[str] = []
    for text in texts:
        for f in scanner.scan(text):
            if f.quote not in out:
                out.append(f.quote)
    return out[:3]


def _template_reason(claims: Claims | None, sells: dict | None, blocked: ToolCall, attempted: float,
                     quotes: list[str] | None = None) -> str:
    parts = [f"Safe Checkout held this order before any money moved ({_action_label(blocked.name)} for ${attempted:,.2f})."]
    if quotes:
        parts.append(f"The listing contained text trying to give orders to the shopping agent: \u201c{quotes[0]}\u201d.")
    elif claims is not None and claims.instructions_detected:
        parts.append("The listing's photos, audio, video or description contained text trying to give orders to the shopping agent.")
    if claims is not None and claims.pack_count_claim and sells and sells.get("title"):
        price = sells.get("price")
        price_text = f" at ${price:,.2f}" if price is not None else ""
        parts.append(
            f'The media mentions a count of {claims.pack_count_claim}, but the store lists "{sells["title"]}"{price_text}.'
        )
    elif sells is None:
        parts.append("The product could not be checked against the store's listing.")
    return " ".join(parts)


def template_fraud_card(verdict, claims, product_json, blocked, attempted, quotes: list[str] | None = None) -> FraudCard:
    sells = _shopify_sells(product_json)
    return FraudCard(
        reason=_template_reason(claims, sells, blocked, attempted, quotes),
        media_claimed=_media_claimed(claims),
        shopify_sells=sells,
        top_probes=_top_probes(verdict),
        dollars_defended=dollars_defended(attempted, None),
        safe_cart=None,
    )


def _neon_prompt(verdict, claims, product_json, blocked, attempted, quotes: list[str] | None = None) -> str:
    fired = [{"id": p.id, "p": p.p} for p in _top_probes(verdict, 5)]
    claims_json = claims.model_dump_json() if claims is not None else "null"
    subs = {
        "<<INTENT>>": "(see blocked call)",
        "<<BLOCKED>>": json.dumps(blocked.model_dump()),
        "<<ATTEMPTED>>": f"{attempted:.2f}",
        "<<PRODUCT>>": json.dumps(product_json),
        "<<CLAIMS>>": claims_json,
        "<<PROBES>>": json.dumps(fired),
        "<<QUOTES>>": json.dumps(quotes or []),
    }
    text = PROMPT_PATH.read_text(encoding="utf-8")
    # Single pass: untrusted product/claims text that contains a placeholder token is never re-substituted.
    return re.sub(r"<<[A-Z]+>>", lambda m: subs.get(m.group(0), m.group(0)), text)


class _NeonText(BaseModel):
    reason: str


async def _neon_reason(prompt: str) -> str:
    """One Neon call, structured output. Raises on any failure; caller falls back."""
    from app.llm import api

    if api.provider() == "openrouter":
        data, _model = await api.complete_json("defender", "", prompt, {"type": "object", "properties": {"reason": {"type": "string"}},
                                                                       "required": ["reason"]}, timeout=NEON_TIMEOUT_S)
        reason = str(data.get("reason") or "").strip()
        if not reason:
            raise ValueError("empty neon reason")
        return reason
    from google.genai import types

    resp = await gemini.client().aio.models.generate_content(
        model=config.MODELS["defender"],
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_NeonText
        ),
    )
    parsed = resp.parsed
    if parsed is None or not parsed.reason.strip():
        raise ValueError("empty neon reason")
    return parsed.reason.strip()


async def build_fraud_card(verdict, claims, product_json, blocked, attempted, safe_cart, quotes: list[str] | None = None) -> FraudCard:
    card = template_fraud_card(verdict, claims, product_json, blocked, attempted, quotes)
    card.safe_cart = safe_cart
    card.dollars_defended = dollars_defended(attempted, (safe_cart or {}).get("total"))
    try:
        prompt = _neon_prompt(verdict, claims, product_json, blocked, attempted, quotes)
        card.reason = await asyncio.wait_for(_neon_reason(prompt), timeout=NEON_TIMEOUT_S)
    except Exception as exc:  # timeout or any Neon error: template reason stays, UI never hangs
        log.warning("neon fraud card fell back to template: %s", type(exc).__name__)
    return card


# ---------------------------------------------------------------- safe swap
def _best_variant(
    products: dict[str, dict], qty: int, budget: Decimal | None,
) -> tuple[Decimal, str, dict, dict] | None:
    best = None
    for product_id, product in products.items():
        for variant in product.get("variants") or []:
            unit = _usd_price(variant.get("price"))
            domain = (variant.get("seller") or {}).get("domain")
            if unit is None or not domain or not variant.get("id") or not _purchasable(variant):
                continue
            if budget is not None and unit * qty > budget:
                continue
            if best is None or unit < best[0]:
                best = (unit, product_id, product, variant)
    return best


ALTERNATIVES = 6
LOCAL_PREFIX = "wh:"  # the local marketplace's listings are never offered as the safe alternative


def _image(product: dict, variant: dict) -> str | None:
    """The first photo of an offer, wherever the Shop MCP result keeps it."""
    for src in (variant.get("media"), variant.get("image"), product.get("media"), product.get("images"),
                product.get("image"), product.get("image_url"), product.get("featured_image")):
        if isinstance(src, str) and src.startswith("http"):
            return src
        if isinstance(src, dict):
            src = [src]
        if isinstance(src, list):
            for m in src:
                url = m.get("url") or m.get("src") if isinstance(m, dict) else m if isinstance(m, str) else None
                if isinstance(url, str) and url.startswith("http") and (not isinstance(m, dict) or m.get("type", "image") == "image"):
                    return url
    return None


def _offers(products: dict[str, dict], qty: int, budget: Decimal | None) -> list[dict]:
    """Every other product's cheapest offer that can be bought within the budget, cheapest first: the choices
    shown beside the safe cart. Each links to its own store's checkout (the shopper pays there, on their own)."""
    out = []
    for product_id, product in products.items():
        if str(product_id).startswith(LOCAL_PREFIX):
            continue
        best = _best_variant({product_id: product}, qty, budget)
        if best is None:
            continue
        unit, _pid, _product, variant = best
        rating = product.get("rating") if isinstance(product.get("rating"), dict) else None
        out.append({
            "product_id": product_id, "variant_id": variant["id"], "title": product.get("title") or variant.get("title"),
            "variant_title": variant.get("title"), "shop": variant["seller"]["domain"],
            "shop_name": (variant.get("seller") or {}).get("name"), "price": float(unit), "total": float(unit * qty),
            "image": _image(product, variant), "checkout_url": variant.get("checkout_url") or variant.get("url") or product.get("url"),
            "rating": {"value": rating.get("value"), "count": rating.get("count")} if rating and rating.get("value") else None,
        })
    out.sort(key=lambda o: o["total"])
    return out


async def safe_swap(
    intent: Intent, original: dict | None, shop: ShopLike, *, known: dict[str, dict] | None = None,
) -> dict | None:
    """Create a cart for a matching Shopify offer within the user's budget."""
    original = original or {}
    known = known or {}
    qty = intent.quantity
    budget = None if intent.budget is None else Decimal(str(intent.budget))
    query = original.get("title") or intent.text
    if str(original.get("id") or "").startswith(LOCAL_PREFIX):
        # a local listing's own title finds mostly itself: look for the same kind of product on Shopify instead
        query = original.get("product_type") or (original.get("title") or intent.text)

    # Restrict candidates to the original product and results relevant to this search.
    products = {}
    for offer in [original, *(await shop.search_catalog(query, limit=12))[:12]]:
        product_id = offer.get("id") or offer.get("product_id")
        if not product_id or str(product_id).startswith(LOCAL_PREFIX) or (products.get(product_id) or {}).get("variants"):
            continue
        cached = known.get(product_id)
        products[product_id] = cached if cached and cached.get("variants") else offer

    best = _best_variant(products, qty, budget)
    if best is None:
        missing = [product_id for product_id, product in products.items() if not product.get("variants")]
        details = {product_id: await shop.get_product(product_id) for product_id in missing[:3]}
        best = _best_variant(details, qty, budget)
    if best is None:
        return None

    unit, product_id, product, variant = best
    domain = variant["seller"]["domain"]
    variant_id = variant["id"]
    res = await shop.create_cart(domain, [{"variant_id": variant_id, "quantity": qty}])
    total = unit * qty
    for entry in res.get("totals") or []:
        if entry.get("type") == "total":
            cart_total = _minor_units_to_dollars(entry.get("amount"))
            if cart_total is not None:
                total = cart_total
                break
    if budget is not None and total > budget:
        return None

    title = product.get("title") or variant.get("title")
    others = [o for o in _offers(products, qty, budget) if o["product_id"] != product_id][:ALTERNATIVES - 1]
    out = {
        "checkout_id": res.get("id") or res.get("checkout_id"),
        "continue_url": res.get("continue_url"),
        "shop": domain,
        "title": title,
        "line_items": [{
            "item": {"id": variant_id},
            "variant_id": variant_id,
            "product_id": product_id,
            "title": variant.get("title") or title,
            "price": float(unit),
            "quantity": qty,
        }],
        "total": float(total),
        "image": _image(product, variant),
        # more safe choices, each with its own store's checkout link
        "alternatives": others,
    }
    if res.get("intercepted"):
        out["intercepted"] = True
    return out


async def on_block(b: BlockContext) -> FraudCard | None:
    """Explain the guarded block and offer a safe cart within one deadline.

    The template card is emitted first (no network), so the UI always shows a Fraud Card; the
    safe cart and the Neon wording are added in a second fraud_card event when they arrive."""
    quotes = flagged_quotes(b.media, b.claims)
    try:
        card = template_fraud_card(b.verdict, b.claims, b.product_json, b.call, b.cart_total, quotes)
        b.bus.emit(b.run_id, "guarded", "fraud_card", card.model_dump())
    except Exception as exc:  # never break the guarded pane
        log.warning("template fraud card failed: %s", type(exc).__name__)
        b.bus.emit(b.run_id, "guarded", "log", {"level": "error", "event": "fraud_card",
                                                "message": f"fraud card failed: {type(exc).__name__}"})
        return None
    async def emit_evidence():
        from app.evidence import locate

        try:
            items = await locate(b.media, b.claims, b.run_id)
            if items:
                b.bus.emit(b.run_id, "guarded", "evidence", {"items": items})
        except Exception as exc:
            log.warning("evidence event unavailable: %s", type(exc).__name__)

    async with asyncio.TaskGroup() as group:
        group.create_task(emit_evidence())
        try:
            async with asyncio.timeout(ON_BLOCK_TIMEOUT_S):
                safe_cart = await safe_swap(b.intent, b.product_json, b.ctx.shop, known=b.ctx.products)
                if safe_cart is not None:
                    # Show the alternative now; the Neon wording (slow) replaces the text when it lands.
                    card = template_fraud_card(b.verdict, b.claims, b.product_json, b.call, b.cart_total, quotes)
                    card.safe_cart = safe_cart
                    card.dollars_defended = dollars_defended(b.cart_total, safe_cart.get("total"))
                    b.bus.emit(b.run_id, "guarded", "fraud_card", card.model_dump())
                card = await build_fraud_card(b.verdict, b.claims, b.product_json, b.call, b.cart_total, safe_cart, quotes)
                b.bus.emit(b.run_id, "guarded", "fraud_card", card.model_dump())
        except Exception as exc:
            # Shop errors can contain access-keyed cart URLs: log the type only.
            log.warning("Neon block handler failed: %s", type(exc).__name__)
            b.bus.emit(b.run_id, "guarded", "log", {"level": "warn", "event": "safe_swap",
                                                    "message": f"safe swap/Neon unavailable: {type(exc).__name__}"})
    return card


# ---------------------------------------------------------------- self-heal re-exports (ADR m4/0003)
# Self-heal lives in backend/selfheal.py; these keep plan.md Task 16's names on this module.
async def propose_probe(bypass_trace, **kwargs):
    from app import selfheal

    return await selfheal.propose_probe(bypass_trace, **kwargs)


async def validate_probe(probe, exploit: dict, benign: list[dict], **kwargs) -> bool:
    """plan.md contract: returns bool. The full ValidationReport is on backend.selfheal.validate_probe."""
    from app import selfheal

    ok, _report = await selfheal.validate_probe(probe, exploit, benign, **kwargs)
    return ok
