"""Turns a finished guarded run into marketplace reputation: a blocked warehouse listing becomes an incident
against its merchant, an approved one counts as a clean check."""
from __future__ import annotations

import logging

from app import scanner, warehouse_shop
from app.guarded_shopper import AGENT_INSTRUCTION_PROBE, GuardedResult
from app.rules import RuleSet
from app.trace import TraceBus
from app.warehouse import carbon, catalog, reputation

log = logging.getLogger(__name__)


def merchant_of(product_id: str) -> str | None:
    slug = product_id.removeprefix(catalog.PREFIX)
    rec = catalog.get_record(slug)
    if rec:
        return rec.get("merchant")
    return catalog.LEGACY_MERCHANT if product_id.startswith(catalog.PREFIX) else None


def last_search(bus: TraceBus, run_id: str) -> str | None:
    """The search the shopper ran before it hit the listing (what led it there)."""
    query = None
    for e in bus.events(run_id):
        if e.pane == "guarded" and e.kind == "tool_call" and e.data.get("tool") == "search_catalog":
            query = ((e.data.get("arguments") or {}).get("catalog") or {}).get("query") or query
    return query


def reasons_for(result: GuardedResult, rules: RuleSet) -> list[str]:
    verdict = result.verdicts[-1] if result.verdicts else None
    categories = {p.id: p.category for p in rules.probes}
    out: list[str] = []
    if verdict:
        out += [categories[p.id] for p in verdict.probes if p.fired and p.id in categories]
        if any(p.id == AGENT_INSTRUCTION_PROBE and p.fired for p in verdict.probes):
            out.append("agent_instruction")
        if verdict.error:
            out.append("firewall_error")
    return sorted(set(out))


def record(result: GuardedResult, rules: RuleSet, *, source: str, run_id: str, bus: TraceBus, listing_text: str = "") -> None:
    """Never raises: reputation is bookkeeping and must not break a run."""
    try:
        product = result.product_json or {}
        pid = product.get("id") or ""
        if not pid.startswith(catalog.PREFIX):
            return
        merchant = merchant_of(pid)
        if result.blocked_call is None:
            if result.approved_calls:
                reputation.record_clean(pid, merchant)
            return
        verdict = result.verdicts[-1]
        listing_text = listing_text or (warehouse_shop.find(pid) or {}).get("listing_text", "")
        quotes = [f.quote for f in scanner.scan(listing_text, "listing")][:2]
        if result.claims is not None:
            quotes += [t for t in result.claims.visible_text if scanner.scan(t)][:2]
        reasons = reasons_for(result, rules) or ["agent_instruction"]
        reputation.record_incident(
            product_id=pid, merchant=merchant, title=product.get("title") or pid, source=source,
            severity="block" if verdict.action == "hard_block_quarantine" else "escalate",
            reasons=reasons, quotes=quotes, run_id=run_id, query=last_search(bus, run_id),
            category=carbon.product_category(pid))
    except Exception:  # noqa: BLE001
        log.exception("could not record the outcome of %s", run_id)
