"""How much a proposed state-changing call would spend.

Used for cart totals (spend tier), Dollars Defended and eval scoring.
Shop MCP argument names are not confirmed until Task 2 saves tools_list.json,
so this accepts the common shapes and never raises on odd input.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from backend.schemas import ToolCall

_LINE_KEYS = ("lines", "line_items", "items", "cart_lines")
_QTY_KEYS = ("quantity", "qty")
_ID_KEYS = ("product_id", "variant_id", "merchandise_id", "productId", "variantId", "id")


def _money(v: Any) -> Decimal | None:
    """Accept 19.99, "19.99", {"amount": "19.99"}, {"price": ...}."""
    if isinstance(v, dict):
        for k in ("amount", "price", "value"):
            if k in v:
                return _money(v[k])
        return None
    if isinstance(v, bool) or v is None:
        return None
    try:
        return Decimal(str(v).replace("$", "").replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None


def _qty(line: dict) -> int:
    for k in _QTY_KEYS:
        if k in line:
            try:
                return max(0, int(line[k]))
            except (TypeError, ValueError):
                return 1
    return 1


def _unit_price(line: dict, products: dict[str, dict]) -> Decimal:
    for k in _ID_KEYS:
        pid = line.get(k)
        if pid is not None and str(pid) in products:
            prod = products[str(pid)]
            price = _money(prod.get("price"))
            if price is None and isinstance(prod.get("price_range"), dict):
                price = _money(prod["price_range"].get("min"))
            if price is not None:
                return price
    price = _money(line.get("price"))
    return price if price is not None else Decimal(0)


def attempted_spend(call: ToolCall, products: dict[str, dict]) -> float:
    """Sum of qty x price over cart lines; spend requests use their `amount`. Unknown prices count 0."""
    args = call.arguments or {}
    if call.name.endswith("spend_request") and "amount" in args:
        amt = _money(args["amount"])
        return float(round(amt, 2)) if amt is not None else 0.0

    lines = next((args[k] for k in _LINE_KEYS if isinstance(args.get(k), list)), [])
    total = sum((_unit_price(l, products) * _qty(l) for l in lines if isinstance(l, dict)), Decimal(0))
    return float(round(total, 2))
