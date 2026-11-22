"""Cart check: what happens the moment a shopper adds a listing to their cart.

No shopping model is involved: the order is already chosen. The check reads the listing the way the
autonomous agent's guard does (photos, video, audio and the store's description as untrusted input),
asks the firewall about the cart, and either lets the item in or explains why not, with a Fraud Card, the
evidence, and a safe alternative. It emits the same trace events as a guarded run, on the `guarded` pane.
"""
from __future__ import annotations

import logging

from app import config, outcomes, scanner, warehouse_shop
from app.defender_neon import on_block as defender_on_block
from app.firewall_decisions import backend_model, decide
from app.guarded_shopper import (AGENT_INSTRUCTION_PROBE, AGENT_INSTRUCTION_REASON, BlockContext, GuardedResult,
                                 hold_if_agent_instructions)
from app.money import attempted_spend
from app.perception_argon import perceive
from app.rules import RuleStore
from app.schemas import Intent
from app.shop_mcp import ShopMCP, ShopMCPError
from app.shopper_loop import ShopperContext, _quantity, _state_facts, to_shop_call
from app.trace import TraceBus

log = logging.getLogger(__name__)
PANE = "guarded"
LISTING_PERCEPTION_S = 90.0


async def _load_product(product_id: str, shop: ShopMCP) -> dict | None:
    if product_id.startswith(warehouse_shop.PREFIX):
        return warehouse_shop.find(product_id)
    try:
        return await shop.get_product(product_id)
    except ShopMCPError:
        return None


def _pick_variant(product: dict, variant_id: str | None) -> dict | None:
    variants = product.get("variants") or []
    return next((v for v in variants if v.get("id") == variant_id), variants[0] if variants else None)


async def run_cart_check(*, product_id: str, variant_id: str | None, quantity: int, budget: float | None, request_text: str | None,
                         bus: TraceBus, run_id: str, rules: RuleStore, shop: ShopMCP, source: str = "cart",
                         on_block=defender_on_block) -> GuardedResult | None:
    import asyncio

    quantity = max(1, min(int(quantity or 1), 99))
    product = await _load_product(product_id, shop)
    variant = _pick_variant(product, variant_id) if product else None
    if not product or not variant:
        bus.emit(run_id, PANE, "log", {"level": "error", "event": "cart_check",
                                       "message": "That listing could not be found, so nothing was added."})
        return None

    title = product.get("title") or "this item"
    intent = Intent(text=request_text or f"Add {quantity} × {title} to my cart", budget=budget, quantity=quantity)
    ctx = ShopperContext(intent=intent, media=[], shop=shop, bus=bus, run_id=run_id, pane=PANE)
    ctx.remember(product)
    call = to_shop_call("create_cart", {"variant_id": variant["id"], "quantity": quantity}, ctx)
    facts = _state_facts(call, ctx)
    bus.emit(run_id, PANE, "tool_call", {"tool": call.name, "arguments": call.arguments, **facts})

    warehouse = warehouse_shop.is_warehouse(product)
    media = warehouse_shop.listing_media(product) if warehouse else []
    listing_text = product.get("listing_text") or ""
    claims = None
    # Argon reads the listing while the firewall judges the same media, so the two waits overlap. The
    # firewall sees the raw photos and text itself; Argon's reading is then applied on top (a listing whose
    # media tells the agent what to do is held even if the cart itself matches).
    reading = asyncio.create_task(asyncio.wait_for(perceive(media), timeout=LISTING_PERCEPTION_S)) if media else None

    public = warehouse_shop.public_view(product) if warehouse else product
    cart_total = attempted_spend(call, ctx.variants)
    verdict = await decide(intent, media, public, call, None, rules.current(), cart_total)
    if reading is not None:
        try:
            claims = await reading
            bus.emit(run_id, PANE, "log", {
                "event": "perception", "model": config.MODELS["perception"],
                "message": f"Argon read the listing: instructions_detected={claims.instructions_detected}",
                "instructions_detected": claims.instructions_detected, "visible_text": claims.visible_text[:5],
                "pack_count_claim": claims.pack_count_claim, "notes": claims.notes})
        except Exception:  # noqa: BLE001 - the firewall still saw the raw media
            log.warning("cart check perception failed", exc_info=True)
    verdict = hold_if_agent_instructions(verdict, claims)
    bus.emit(run_id, PANE, "verdict", {**verdict.model_dump(), "tool": call.name, "cart_total": cart_total,
                                       "product_id": product.get("id")})

    approved: list = []
    if verdict.action != "approve_checkout":
        bus.emit(run_id, PANE, "log", {
            "event": "stopped", "model": verdict.model or backend_model(verdict.backend), "action": verdict.action,
            "tool": call.name, "error": verdict.error,
            "message": f"cart check stopped: {verdict.action} on {call.name}"
                       + (f" (firewall error: {verdict.error})" if verdict.error else "")
                       + (f" ({AGENT_INSTRUCTION_REASON})" if any(p.id == AGENT_INSTRUCTION_PROBE for p in verdict.probes) else "")})
        try:
            await on_block(BlockContext(intent=intent, media=media, call=call, verdict=verdict, claims=claims, product_json=public,
                                        cart_total=cart_total, ctx=ctx, bus=bus, run_id=run_id))
        except Exception as exc:  # noqa: BLE001 - the block result must not be lost
            log.exception("after_block failed")
            bus.emit(run_id, PANE, "log", {"level": "error", "event": "after_block",
                                           "message": f"after_block failed: {type(exc).__name__}: {exc}"})
    else:
        result = await shop.call(call.name, call.arguments)
        approved.append(call)
        bus.emit(run_id, PANE, "tool_result", {"tool": call.name, "result": result})

    outcome = GuardedResult(verdicts=[verdict], blocked_call=call if verdict.action != "approve_checkout" else None,
                            approved_calls=approved, claims=claims, product_json=public)
    outcomes.record(outcome, rules.current(), source=source, run_id=run_id, bus=bus, listing_text=listing_text)
    return outcome
