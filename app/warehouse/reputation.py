"""Marketplace reputation learned from what shoppers actually run into.

Every time a check (the autonomous agent's cart, a user's add-to-cart, a merchant publishing a listing) finds
a warehouse listing trying to steer a shopping agent, an incident is recorded against that product and its
merchant. From the incidents:

    trust score   100 minus the weight of the merchant's incidents (repeats on one product count half),
                  plus a little back for listings that passed clean checks
    status        trusted (>= 80) / watch (50-79) / flagged (< 50)
    rating        the listing's star rating, lowered as trust falls: the stars shoppers see
    ranking       flagged listings sink in search results, and show a red warning in the storefront

State lives in data/state/reputation.json (gitignored). Nothing here calls a model.
"""
from __future__ import annotations

import json
import threading
import time
import uuid

from app import paths

WEIGHTS = {"block": 22, "escalate": 10, "scan": 8}
CLEAN_BONUS = 2
CLEAN_BONUS_CAP = 10
TRUSTED_MIN, WATCH_MIN = 80, 50
MAX_INCIDENTS = 2000

_lock = threading.Lock()
_cache: dict | None = None


def _file():
    return paths.STATE / "reputation.json"


def _load() -> dict:
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(_file().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _cache = {"incidents": [], "clean": {}}
        _cache.setdefault("incidents", [])
        _cache.setdefault("clean", {})
    return _cache


def _save() -> None:
    paths.ensure(paths.STATE)
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps(_cache, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_file())


def record_incident(*, product_id: str, merchant: str | None, title: str, source: str, severity: str,
                    reasons: list[str] | None = None, quotes: list[str] | None = None, run_id: str | None = None,
                    query: str | None = None, category: str | None = None, amount: float = 0.0) -> dict:
    """source: agent | cart | portal. severity: block | escalate | scan."""
    if severity not in WEIGHTS:
        raise ValueError(f"severity must be one of {sorted(WEIGHTS)}")
    incident = {"id": uuid.uuid4().hex[:10], "ts": time.time(), "product_id": product_id, "merchant": merchant or "unknown",
                "title": title, "source": source, "severity": severity, "reasons": reasons or [], "quotes": (quotes or [])[:4],
                "run_id": run_id, "query": query, "category": category, "amount": round(float(amount or 0), 2)}
    with _lock:
        state = _load()
        state["incidents"].append(incident)
        del state["incidents"][:-MAX_INCIDENTS]
        _save()
    return incident


def record_clean(product_id: str, merchant: str | None) -> None:
    with _lock:
        state = _load()
        key = f"{merchant or 'unknown'}|{product_id}"
        state["clean"][key] = state["clean"].get(key, 0) + 1
        _save()


def reset() -> None:
    global _cache
    with _lock:
        _cache = {"incidents": [], "clean": {}}
        _save()


def incidents(merchant: str | None = None, product_id: str | None = None) -> list[dict]:
    rows = _load()["incidents"]
    return [i for i in rows if (merchant is None or i["merchant"] == merchant) and (product_id is None or i["product_id"] == product_id)]


def _status(trust: float) -> str:
    return "trusted" if trust >= TRUSTED_MIN else "watch" if trust >= WATCH_MIN else "flagged"


def merchant_stats(merchant: str) -> dict:
    rows = incidents(merchant=merchant)
    seen: dict[str, int] = {}
    penalty = 0.0
    for i in sorted(rows, key=lambda r: r["ts"]):
        n = seen.get(i["product_id"], 0)
        seen[i["product_id"]] = n + 1
        penalty += WEIGHTS[i["severity"]] * (1 if n == 0 else 0.5)
    clean = sum(c for k, c in _load()["clean"].items() if k.startswith(f"{merchant}|"))
    bonus = min(CLEAN_BONUS_CAP, clean * CLEAN_BONUS) if rows else 0
    trust = max(0.0, min(100.0, 100.0 - penalty + bonus))
    return {"merchant": merchant, "trust": round(trust), "status": _status(trust), "incidents": len(rows),
            "flagged_products": len({i["product_id"] for i in rows if i["severity"] == "block"}),
            "products_with_incidents": len(seen), "clean_checks": clean,
            "last_incident": max((i["ts"] for i in rows), default=None)}


def product_stats(product_id: str, merchant: str | None = None) -> dict:
    rows = incidents(product_id=product_id)
    blocked = [i for i in rows if i["severity"] == "block"]
    status = "flagged" if blocked else "watch" if rows else "clear"
    return {"product_id": product_id, "status": status, "incidents": len(rows), "blocks": len(blocked),
            "reasons": sorted({r for i in rows for r in i["reasons"]})[:6],
            "last_incident": max((i["ts"] for i in rows), default=None)}


def adjusted_rating(base: float, merchant_trust: int, product_status: str) -> float:
    lowered = base - (100 - merchant_trust) / 20 - (1.0 if product_status == "flagged" else 0.4 if product_status == "watch" else 0)
    return round(max(1.0, min(5.0, lowered)), 1)


def annotate(product: dict) -> dict:
    """Attach what shoppers see (trust, status, adjusted stars) to a warehouse product."""
    merchant = product.get("warehouse_merchant")
    m = merchant_stats(merchant) if merchant else {"trust": 100, "status": "trusted", "incidents": 0}
    p = product_stats(product["id"], merchant)
    out = dict(product)
    base = (product.get("rating") or {}).get("value")
    if base:  # a listing with no reviews yet has no stars to lower
        out["rating"] = {**product["rating"], "value": adjusted_rating(base, m["trust"], p["status"]), "original_value": base}
    out["warehouse"] = {"merchant": merchant, "merchant_trust": m["trust"], "merchant_status": m["status"],
                        "product_status": p["status"], "incidents": p["incidents"], "reasons": p["reasons"],
                        "penalty": round(rank_penalty(product), 1)}
    return out


def rank_penalty(product: dict) -> float:
    """How far down the results a warehouse listing sinks. 0 for a clean one; large for a flagged one."""
    merchant = product.get("warehouse_merchant")
    m = merchant_stats(merchant) if merchant else {"trust": 100}
    p = product_stats(product["id"])
    return (100 - m["trust"]) / 5 + (12 if p["status"] == "flagged" else 4 if p["status"] == "watch" else 0)


def overview() -> dict:
    from app.warehouse import catalog

    by_merchant = []
    counts: dict[str, int] = {}
    for r in catalog.records():
        counts[r.get("merchant") or "unknown"] = counts.get(r.get("merchant") or "unknown", 0) + 1
    for mid, m in catalog.merchants().items():
        s = merchant_stats(mid)
        by_merchant.append({**s, "id": mid, "name": m["name"], "tagline": m.get("tagline"), "location": m.get("location"),
                            "since": m.get("since"), "listings": counts.get(mid, 0)})
    by_merchant.sort(key=lambda m: (m["trust"], -m["incidents"]))
    rows = _load()["incidents"]
    return {"merchants": by_merchant, "incidents": sorted(rows, key=lambda r: -r["ts"])[:60],
            "totals": {"incidents": len(rows), "blocked": sum(1 for r in rows if r["severity"] == "block"),
                       "by_source": {s: sum(1 for r in rows if r["source"] == s) for s in ("agent", "cart", "portal")},
                       "protected_usd": round(sum(r.get("amount", 0) for r in rows if r["severity"] == "block"), 2),
                       "flagged_merchants": sum(1 for m in by_merchant if m["status"] == "flagged"),
                       "flagged_products": len({r["product_id"] for r in rows if r["severity"] == "block"})}}
