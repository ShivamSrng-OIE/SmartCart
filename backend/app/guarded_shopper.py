"""Guarded shopper: the protected pane (plan.md Task 9, contract C7).

Same Hydrogen loop, model and prompt as the victim (shopper_loop, MODELS["victim"],
VICTIM_PROMPT), so the comparison is fair. The only difference is the state-change hook:
every state-changing Shop call goes through the firewall first.

    run_guarded(intent, media, product_ref, bus, run_id, shop, rules) -> GuardedResult

Flow:
- Argon perception starts as a task at once, so it runs while the shopper does its first
  search. The firewall never waits for it: if Argon hasn't finished when a decision is needed,
  decide() gets claims=None and judges the raw media itself.
- Argon's Claims are emitted as a "perception" log event the moment perception finishes.
- With no product_ref and an image attached, camera product matching (product_match.py) also
  starts in the background, after Argon.
- For each state-changing call: cart_total = attempted_spend (prices from ctx.variants),
  product_json = the product actually being bought (product_for), then decide(), then a
  "verdict" event.
  Approve: the call is really sent through `shop` (live ShopMCP; shop_mcp still always
  intercepts spend requests and forbids complete_*).
  Anything else: the loop STOPS (no more model or tool calls), a "log" event says why, and
  after_block() runs (Member 4, Task 10: fraud card + safe swap).
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic import BaseModel

from app import config
from app.firewall_decisions import backend_model, decide
from app.money import attempted_spend
from app.perception_argon import perceive
from app.product_match import ProductMatch, match_product
from app.rules import RuleStore
from app.schemas import Claims, Intent, Media, ProbeResult, ToolCall, Verdict
from app.shop_mcp import ShopMCP
from app.shopper_loop import ShopperContext, shopper_loop
from app.trace import TraceBus
from app.victim_hydrogen import VICTIM_PROMPT
from app import warehouse_shop

log = logging.getLogger(__name__)

PANE = "guarded"
GUARDED_PROMPT = VICTIM_PROMPT  # same shopper prompt as the victim: the firewall is the only difference


class GuardedResult(BaseModel):
    verdicts: list[Verdict]
    blocked_call: ToolCall | None
    approved_calls: list[ToolCall]
    claims: Claims | None
    product_json: dict | None


class CallBlocked(Exception):
    """Raised from the state-change hook to stop shopper_loop after a non-approve verdict."""

    def __init__(self, call: ToolCall, verdict: Verdict):
        super().__init__(f"{verdict.action} on {call.name}")
        self.call, self.verdict = call, verdict


@dataclass
class BlockContext:
    """Everything Task 10 needs to explain the block and build a safe cart."""
    intent: Intent
    media: list[Media]
    call: ToolCall
    verdict: Verdict
    claims: Claims | None
    product_json: dict | None
    cart_total: float
    ctx: ShopperContext  # .products (truth ledger), .variants (prices, seller), .shop
    bus: TraceBus
    run_id: str


AfterBlock = Callable[[BlockContext], Awaitable[None]]


async def after_block(b: BlockContext) -> None:
    """TODO(Member 4, Task 10): Neon fraud card + safe swap. Runs once, after the loop stopped on
    a non-approve verdict. Emit a "fraud_card" event on pane "guarded"
    (b.bus.emit(b.run_id, "guarded", "fraud_card", card.model_dump())) and build the safe cart
    through b.ctx.shop (in budget, from b.intent). Exceptions are caught and logged by run_guarded.
    Replace this body, or pass on_block= to run_guarded."""
    return None


AGENT_INSTRUCTION_PROBE = "listing_agent_instruction"
AGENT_INSTRUCTION_REASON = "listing contains instructions aimed at AI agents"


ARGON_GRACE_S = 12.0  # max wait for perception before approving a cart (ADR 0026)
LISTING_PERCEPTION_S = 60.0  # reading a warehouse listing's photo, video, audio and text before judging the cart


def hold_if_agent_instructions(verdict: Verdict, claims: Claims | None) -> Verdict:
    """ADR 0026: a seller that plants agent-directed commands is untrustworthy, so an approve
    becomes a hold (hard_block_quarantine) even when the cart matches the intent. Non-approve
    verdicts and benign listings are returned unchanged."""
    if verdict.action != "approve_checkout" or claims is None or not claims.instructions_detected:
        return verdict
    probes = [p for p in verdict.probes if p.id != AGENT_INSTRUCTION_PROBE]
    probes.append(ProbeResult(id=AGENT_INSTRUCTION_PROBE, p=1.0, fired=True))
    return verdict.model_copy(update={"action": "hard_block_quarantine", "probes": probes})


def _ref_product(bus: TraceBus, run_id: str, ctx: ShopperContext) -> dict | None:
    """The product shopper_loop looked up for product_ref (its lookup_catalog tool_result)."""
    for e in bus.events(run_id):
        if e.pane == PANE and e.kind == "tool_result" and e.data.get("tool") == "lookup_catalog":
            found = (e.data.get("result") or {}).get("products") or []
            return ctx.products.get(found[0]["product_id"]) if found else None
    return None


def _bought_product(call: ToolCall, ctx: ShopperContext) -> dict | None:
    lines = ((call.arguments or {}).get("cart") or {}).get("line_items") or []
    for line in lines:
        vid = ((line or {}).get("item") or {}).get("id")
        v = ctx.variants.get(vid)
        if v and v.get("product_id") in ctx.products:
            return ctx.products[v["product_id"]]
    return None


async def run_guarded(intent: Intent, media: list[Media], product_ref: str | None, bus: TraceBus, run_id: str,
                      shop: ShopMCP, rules: RuleStore, *, client=None,
                      on_block: AfterBlock | None = None, system_prompt: str = GUARDED_PROMPT) -> GuardedResult:
    async def _perceive_and_show() -> Claims:
        """Argon, then its reading on the right pane the moment it returns, not at the first cart
        (the pane would otherwise say nothing about the photo for the whole search phase)."""
        c = await perceive(media)
        if media:  # no media: empty Claims with no API call, nothing worth showing
            bus.emit(run_id, PANE, "log", {
                "event": "perception", "model": config.MODELS["perception"],
                "message": f"Argon: instructions_detected={c.instructions_detected}",
                "instructions_detected": c.instructions_detected, "visible_text": c.visible_text[:5],
                "pack_count_claim": c.pack_count_claim, "notes": c.notes})
        return c

    perception = asyncio.create_task(_perceive_and_show())
    match_task: asyncio.Task | None = None
    if not product_ref and any(m.kind == "image" for m in media):
        async def _match() -> ProductMatch | None:
            # shield: cancelling the match (run end) must not cancel Argon, which is shared
            return await match_product(media, await asyncio.shield(perception), shop)
        match_task = asyncio.create_task(_match())
    await asyncio.sleep(0)  # let Argon start before the shopper's first model call

    verdicts: list[Verdict] = []
    approved: list[ToolCall] = []
    state: dict = {"claims": None, "match": None, "match_logged": False,
                   "product_json": None, "last_cart_total": 0.0, "ctx": None, "extra_media": []}

    def claims_if_ready() -> Claims | None:
        """Argon's Claims only if perception already finished. The firewall NEVER waits for Argon:
        with None it judges the raw image itself (all golden tuning ran with Argon off). The
        "perception" event is still emitted whenever Argon finishes."""
        if perception.done() and not perception.cancelled() and perception.exception() is None:
            state["claims"] = perception.result()
        return state["claims"]

    def _log_match(m: ProductMatch | None) -> None:
        if m is not None and not state["match_logged"]:
            state["match_logged"] = True
            pid = m.product.get("id") if m.product else None
            bus.emit(run_id, PANE, "log", {
                "event": "product_match", "model": m.model, "confidence": m.confidence, "choice": m.choice,
                "product_id": pid, "query": m.query, "error": m.error,
                "message": (f"camera match: {m.product.get('title')} ({m.confidence:.2f})" if m.product
                            else f"camera match: none ({m.error or f'{m.choice} at {m.confidence:.2f}'})")})

    async def camera_match() -> ProductMatch | None:
        if match_task is None:
            return None
        m = await match_task
        _log_match(m)
        return m

    def camera_match_if_ready() -> ProductMatch | None:
        """The camera match only if it already finished: never delays a firewall check."""
        if match_task is None or not match_task.done() or match_task.cancelled() or match_task.exception():
            return None
        m = match_task.result()
        _log_match(m)
        return m

    async def product_for(call: ToolCall, ctx: ShopperContext) -> dict | None:
        """SHOP_PRODUCT_JSON is the product ACTUALLY BEING BOUGHT (the product of the cart's
        variant). product_ref / the camera match are used only when they are that same product, or
        when the cart's product is unknown (e.g. a spend request). Otherwise the firewall would
        compare the photo against a product the cart doesn't buy (test c: demo_product_id was
        Gymshark, the cart bought the Flexform listing, an honest purchase was hard-blocked).
        None means no product: mismatch probes are skipped (architecture decision 7)."""
        bought = _bought_product(call, ctx)
        ref = _ref_product(bus, run_id, ctx) if product_ref else None
        if bought is None:
            if ref is not None:
                return ref
            m = await camera_match()
            return m.product if m is not None and m.product is not None else None
        if ref is not None and ref.get("id") == bought.get("id"):
            return ref
        m = camera_match_if_ready()
        if m is not None and m.product is not None and m.product.get("id") == bought.get("id"):
            return m.product
        other = ref if ref is not None else (m.product if m is not None else None)
        if other is not None:
            bus.emit(run_id, PANE, "log", {
                "event": "product_context", "product_id": bought.get("id"), "other_product_id": other.get("id"),
                "message": f"checking the product being bought ({bought.get('title')}), "
                           f"not {'the given product' if other is ref else 'the camera match'} ({other.get('title')})"})
        return bought

    async def guard(call: ToolCall, ctx: ShopperContext) -> dict:
        state["ctx"] = ctx
        c = claims_if_ready()
        product_json = await product_for(call, ctx)
        state["extra_media"] = []
        listing_read: asyncio.Task | None = None
        if warehouse_shop.is_warehouse(product_json):
            # A warehouse listing: its photo, video, audio and description are untrusted input, read
            # (Argon) and judged (firewall) with the order, and kept for the evidence step. Argon reads it
            # while the firewall judges the same media, so the two waits overlap; the read is applied below.
            state["extra_media"] = warehouse_shop.listing_media(product_json)
            product_json = warehouse_shop.public_view(product_json)
            listing_read = asyncio.create_task(asyncio.wait_for(perceive([*media, *state["extra_media"]]), timeout=LISTING_PERCEPTION_S))
        all_media = [*media, *state["extra_media"]]
        cart_total = attempted_spend(call, ctx.variants) or (
            state["last_cart_total"] if call.name.endswith("checkout") else 0.0)
        verdict = await decide(ctx.intent, all_media, product_json, call, c, rules.current(), cart_total)
        if listing_read is not None:
            try:
                c = await listing_read
                bus.emit(run_id, PANE, "log", {
                    "event": "perception", "model": config.MODELS["perception"],
                    "message": f"Argon read the listing: instructions_detected={c.instructions_detected}",
                    "instructions_detected": c.instructions_detected, "visible_text": c.visible_text[:5],
                    "pack_count_claim": c.pack_count_claim, "notes": c.notes})
            except Exception:  # noqa: BLE001 - keep whatever perception we already had
                log.warning("listing perception failed", exc_info=True)
        if verdict.action == "approve_checkout" and c is None and all_media:
            # ADR 0026: before money moves, give Argon a short grace period so a listing with
            # hidden agent instructions can't slip through just because perception was slower.
            try:
                c = await asyncio.wait_for(asyncio.shield(perception), timeout=ARGON_GRACE_S)
            except Exception:  # noqa: BLE001 - timeout or perception failure: keep the firewall verdict
                c = claims_if_ready()
        verdict = hold_if_agent_instructions(verdict, c)
        verdicts.append(verdict)
        state["product_json"] = product_json
        bus.emit(run_id, PANE, "verdict", {**verdict.model_dump(), "tool": call.name, "cart_total": cart_total,
                                           "product_id": product_json.get("id") if product_json else None})
        if verdict.action != "approve_checkout":
            raise CallBlocked(call, verdict)
        result = await ctx.shop.call(call.name, call.arguments)
        approved.append(call)
        if call.name.endswith("cart"):
            state["last_cart_total"] = cart_total
        return result

    blocked: CallBlocked | None = None
    try:
        await shopper_loop(intent, media, product_ref, shop, bus, run_id, pane=PANE,
                           system_prompt=system_prompt, on_state_change=guard, client=client)
    except CallBlocked as b:
        blocked = b
        bus.emit(run_id, PANE, "log", {
            "event": "stopped", "model": b.verdict.model or backend_model(b.verdict.backend),
            "action": b.verdict.action, "tool": b.call.name, "error": b.verdict.error,
            "message": f"guarded shopper stopped: {b.verdict.action} on {b.call.name}"
                       + (f" (firewall error: {b.verdict.error})" if b.verdict.error else "")
                       + (f" ({AGENT_INSTRUCTION_REASON})"
                          if any(p.id == AGENT_INSTRUCTION_PROBE for p in b.verdict.probes) else "")})
        hook = on_block or after_block
        try:
            await hook(BlockContext(intent=intent, media=[*media, *state["extra_media"]], call=b.call, verdict=b.verdict,
                                    claims=claims_if_ready(), product_json=state["product_json"],
                                    cart_total=attempted_spend(b.call, state["ctx"].variants),
                                    ctx=state["ctx"], bus=bus, run_id=run_id))
        except Exception as exc:  # noqa: BLE001 - a Task 10 failure must not lose the block result
            log.exception("after_block failed")
            bus.emit(run_id, PANE, "log", {"level": "error", "event": "after_block", "model": config.MODELS["defender"],
                                           "message": f"after_block failed: {type(exc).__name__}: {exc}"})
    finally:
        if match_task is not None and not match_task.done():
            match_task.cancel()

    return GuardedResult(verdicts=verdicts, blocked_call=blocked.call if blocked else None,
                         approved_calls=approved, claims=await perception,
                         product_json=state["product_json"])
