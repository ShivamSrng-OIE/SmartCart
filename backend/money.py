"""How much a proposed state-changing call would spend, in DOLLARS (float, 2 dp).

Used for cart totals (spend tier), Dollars Defended and eval scoring.

Real Shop MCP shapes (backend/shopper_loop.py to_shop_call; Shop money is integer CENTS):
    create_cart          {"shop": ..., "cart": {"line_items": [{"item": {"id": variant_id}, "quantity": n}]}}
    create_spend_request {"spend_request": {"approval_limit": cents, "totals": [{"type": "total", "amount": cents}]}}
`products` may be any of:
    ShopperContext.variants   variant_id -> {..., "price_usd": 19.99}
    raw Shop variants         variant_id -> {..., "price": {"amount": 1999, "currency": "USD"}}
    ShopperContext.products   product_id -> raw Shop product (its "variants" are searched)
Older flat shapes (lines/product_id/price in dollars) still work. Never raises on odd input.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from backend.schemas import ToolCall

_LINE_KEYS = ("lines", "line_items", "items", "cart_lines")
_QTY_KEYS = ("quantity", "qty")
_ID_KEYS = ("product_id", "variant_id", "merchandise_id", "productId", "variantId", "id")
CENTS = Decimal(100)


def _money(v: Any) -> Decimal | None:
    """Dollars from 19.99, "19.99", {"amount": "19.99"}, {"price": ...}.
    A Shop price {"amount": <int>, "currency": ...} is integer cents."""
    if isinstance(v, dict):
        if "currency" in v and isinstance(v.get("amount"), int) and not isinstance(v["amount"], bool):
            return Decimal(v["amount"]) / CENTS
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


def _cents(v: Any) -> Decimal | None:
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        return None
    try:
        return Decimal(str(v)) / CENTS
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


def _line_ids(line: dict) -> list[str]:
    ids = [str(line[k]) for k in _ID_KEYS if line.get(k) is not None]
    item = line.get("item")
    if isinstance(item, dict) and item.get("id") is not None:  # real Shop: {"item": {"id": variant_id}}
        ids.insert(0, str(item["id"]))
    return ids


def _price_of(entry: dict) -> Decimal | None:
    if "price_usd" in entry:
        return _money(entry["price_usd"])
    price = _money(entry.get("price"))
    if price is None and isinstance(entry.get("price_range"), dict):
        price = _money(entry["price_range"].get("min"))
    return price


def _lookup(pid: str, products: dict[str, dict]) -> Decimal | None:
    entry = products.get(pid)
    if isinstance(entry, dict):
        price = _price_of(entry)
        if price is not None:
            return price
    for prod in products.values():  # raw Shop products keyed by product id: search their variants
        if isinstance(prod, dict) and isinstance(prod.get("variants"), list):
            for v in prod["variants"]:
                if isinstance(v, dict) and str(v.get("id")) == pid:
                    return _price_of(v)
    return None


def _unit_price(line: dict, products: dict[str, dict]) -> Decimal:
    for pid in _line_ids(line):
        price = _lookup(pid, products)
        if price is not None:
            return price
    price = _money(line.get("price"))
    return price if price is not None else Decimal(0)


def _spend_request_total(sr: dict) -> Decimal | None:
    """Largest of approval_limit and the "total" entries (all cents): what it could spend."""
    amounts = [_cents(sr.get("approval_limit"))]
    for t in sr.get("totals") or []:
        if isinstance(t, dict) and t.get("type", "total") == "total":
            amounts.append(_cents(t.get("amount")))
    amounts = [a for a in amounts if a is not None]
    return max(amounts) if amounts else None


def attempted_spend(call: ToolCall, products: dict[str, dict]) -> float:
    """Dollars: sum of qty x unit price over cart lines; spend requests use their amount.
    Unknown prices count 0."""
    args = call.arguments or {}
    if call.name.endswith("spend_request"):
        if isinstance(args.get("spend_request"), dict):
            amt = _spend_request_total(args["spend_request"])
            return float(round(amt, 2)) if amt is not None else 0.0
        if "amount" in args:
            amt = _money(args["amount"])
            return float(round(amt, 2)) if amt is not None else 0.0

    container = args.get("cart") if isinstance(args.get("cart"), dict) else args
    lines = next((container[k] for k in _LINE_KEYS if isinstance(container.get(k), list)), [])
    total = sum((_unit_price(l, products) * _qty(l) for l in lines if isinstance(l, dict)), Decimal(0))
    return float(round(total, 2))
