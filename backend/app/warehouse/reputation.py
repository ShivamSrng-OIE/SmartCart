"""Marketplace reputation learned from what shoppers actually run into.

Every time a check (the autonomous agent's cart, a user's add-to-cart, a merchant publishing a listing) finds
a warehouse listing trying to steer a shopping agent, an incident is recorded against that product and its
merchant. From the incidents:

    trust score   100 minus the weight of the merchant's incidents (repeats on one product count half),
                  plus a little back for listings that passed clean checks
    status        trusted (>= 80) / watch (50-79) / flagged (< 50)
    rating        the listing's star rating, lowered as trust falls: the stars shoppers see
    ranking       flagged listings sink in search results, and show a red warning in the storefront

Scope: a visitor's browser sends a session id (the X-Tote-Session header), and that session gets its own
ledger, starting from a clean marketplace, so every visit watches ratings fall from the original values as its
own checks catch listings. Requests without a session (scripts, the benchmark, tests) share the ledger in
data/state/reputation.json (gitignored). Session ledgers live in memory and the oldest are dropped past
MAX_SESSIONS. Nothing here calls a model.
"""
from __future__ import annotations

import json
import re
import threading
import time
import uuid
from collections import OrderedDict
from contextvars import ContextVar

from app import paths

WEIGHTS = {"block": 22, "escalate": 10, "scan": 8}
CLEAN_BONUS = 2
CLEAN_BONUS_CAP = 10
TRUSTED_MIN, WATCH_MIN = 80, 50
MAX_INCIDENTS = 2000

MAX_SESSIONS = 500
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

_lock = threading.RLock()
_cache: dict | None = None
_sessions: OrderedDict[str, dict] = OrderedDict()
SESSION: ContextVar[str | None] = ContextVar("reputation_session", default=None)


def valid_session(value: str | None) -> str | None:
    return value if value and SESSION_RE.match(value) else None


def _empty() -> dict:
    return {"incidents": [], "clean": {}}


def _state() -> dict:
    """The ledger in scope: this visitor's session, or the shared file."""
    sid = SESSION.get()
    if not sid:
        return _load()
    with _lock:
        state = _sessions.get(sid)
        if state is None:
            state = _sessions[sid] = _empty()
            while len(_sessions) > MAX_SESSIONS:
                _sessions.popitem(last=False)
        else:
            _sessions.move_to_end(sid)
        return state


def _persist() -> None:
    if not SESSION.get():
        _save()


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
                    query: str | None = None, category: str | None = None, amount: float = 0.0,
                    evidence: list[dict] | None = None) -> dict:
    """source: agent | cart | portal. severity: block | escalate | scan. evidence: where the hidden text was found
    ({modality, text, image}), so the seller and the report can show the tampered photo itself."""
    if severity not in WEIGHTS:
        raise ValueError(f"severity must be one of {sorted(WEIGHTS)}")
    incident = {"id": uuid.uuid4().hex[:10], "ts": time.time(), "product_id": product_id, "merchant": merchant or "unknown",
                "title": title, "source": source, "severity": severity, "reasons": reasons or [], "quotes": (quotes or [])[:4],
                "run_id": run_id, "query": query, "category": category, "amount": round(float(amount or 0), 2),
                "evidence": [e for e in (evidence or []) if isinstance(e, dict)][:3]}
    with _lock:
        state = _state()
        state["incidents"].append(incident)
        del state["incidents"][:-MAX_INCIDENTS]
        _persist()
    return incident


def record_clean(product_id: str, merchant: str | None) -> None:
    with _lock:
        state = _state()
        key = f"{merchant or 'unknown'}|{product_id}"
        state["clean"][key] = state["clean"].get(key, 0) + 1
        _persist()


def reset() -> None:
    """Forget the incidents in scope: this session's, or (without a session) the shared ledger."""
    global _cache
    with _lock:
        sid = SESSION.get()
        if sid:
            _sessions[sid] = _empty()
            return
        _cache = _empty()
        _save()


def incidents(merchant: str | None = None, product_id: str | None = None) -> list[dict]:
    rows = _state()["incidents"]
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
    clean = sum(c for k, c in _state()["clean"].items() if k.startswith(f"{merchant}|"))
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


def _ratings(records: list[dict], trust: int) -> dict:
    """A merchant's stars before and after the incidents in scope: the average over its rated listings."""
    from app.warehouse import catalog

    before, after, lowered = [], [], 0
    for r in records:
        base = (r.get("rating") or {}).get("value")
        if not base:
            continue
        now = adjusted_rating(base, trust, product_stats(f"{catalog.PREFIX}{r['slug']}")["status"])
        before.append(base)
        after.append(now)
        lowered += now < base
    if not before:
        return {"rating": None, "original_rating": None, "rating_drop": 0.0, "ratings_lowered": 0}
    b, a = sum(before) / len(before), sum(after) / len(after)
    return {"rating": round(a, 2), "original_rating": round(b, 2), "rating_drop": round(b - a, 2), "ratings_lowered": lowered}


def reports(rows: list[dict], names: dict[str, str]) -> list[dict]:
    """One report per blocked listing, as it would be filed with Shopify's merchant-trust team. This demo sends
    nothing outside the app: `simulated` says so, and the UI shows it."""
    by_product: dict[str, dict] = {}
    for i in sorted(rows, key=lambda r: r["ts"]):
        if i["severity"] != "block":
            continue
        rep = by_product.get(i["product_id"])
        if rep is None:
            rep = by_product[i["product_id"]] = {
                "id": report_id(i["product_id"]),
                "product_id": i["product_id"], "title": i["title"], "merchant": i["merchant"],
                "merchant_name": names.get(i["merchant"], i["merchant"]), "filed_at": i["ts"], "updated_at": i["ts"],
                "incidents": 0, "reasons": [], "evidence": [], "images": [], "to": "Shopify merchant trust", "simulated": True}
        rep["incidents"] += 1
        rep["updated_at"] = i["ts"]
        rep["reasons"] = sorted(set(rep["reasons"]) | set(i["reasons"]))
        for q in i["quotes"]:
            if q not in rep["evidence"] and len(rep["evidence"]) < 4:
                rep["evidence"].append(q)
        for e in i.get("evidence") or []:
            if e.get("image") and e["image"] not in rep["images"] and len(rep["images"]) < 3:
                rep["images"].append(e["image"])
    return sorted(by_product.values(), key=lambda r: -r["updated_at"])


def report_id(product_id: str) -> str:
    return "SR-" + uuid.uuid5(uuid.NAMESPACE_URL, product_id).hex[:6].upper()


def product_flags(product_id: str) -> dict:
    """What the seller sees on one listing: its report to Shopify and the evidence (the tampered photo, the words)."""
    rows = incidents(product_id=product_id)
    blocked = [i for i in rows if i["severity"] == "block"]
    images, quotes = [], []
    for i in sorted(rows, key=lambda r: -r["ts"]):
        for e in i.get("evidence") or []:
            if e.get("image") and e["image"] not in images and len(images) < 3:
                images.append(e["image"])
        for q in i["quotes"]:
            if q not in quotes and len(quotes) < 3:
                quotes.append(q)
    return {"report_id": report_id(product_id) if blocked else None, "images": images, "quotes": quotes,
            "last_incident": max((i["ts"] for i in rows), default=None)}


def seller_summary(merchant: str) -> dict:
    """merchant_stats plus the stars before and after, and how many listings were reported."""
    from app.warehouse import catalog

    s = merchant_stats(merchant)
    mine = [r for r in catalog.records() if r.get("merchant") == merchant]
    reported = len({i["product_id"] for i in incidents(merchant=merchant) if i["severity"] == "block"})
    return {**s, **_ratings(mine, s["trust"]), "reports": reported}


def overview() -> dict:
    from app.warehouse import catalog

    by_merchant = []
    mine: dict[str, list[dict]] = {}
    for r in catalog.records():
        mine.setdefault(r.get("merchant") or "unknown", []).append(r)
    for mid, m in catalog.merchants().items():
        s = merchant_stats(mid)
        by_merchant.append({**s, **_ratings(mine.get(mid, []), s["trust"]), "id": mid, "name": m["name"],
                            "tagline": m.get("tagline"), "location": m.get("location"), "since": m.get("since"),
                            "listings": len(mine.get(mid, []))})
    by_merchant.sort(key=lambda m: (m["trust"], -m["incidents"]))
    rows = _state()["incidents"]
    filed = reports(rows, {m["id"]: m["name"] for m in by_merchant})
    return {"merchants": by_merchant, "incidents": sorted(rows, key=lambda r: -r["ts"])[:60], "reports": filed,
            "session": bool(SESSION.get()),
            "totals": {"incidents": len(rows), "blocked": sum(1 for r in rows if r["severity"] == "block"),
                       "by_source": {s: sum(1 for r in rows if r["source"] == s) for s in ("agent", "cart", "portal")},
                       "protected_usd": round(sum(r.get("amount", 0) for r in rows if r["severity"] == "block"), 2),
                       "flagged_merchants": sum(1 for m in by_merchant if m["status"] == "flagged"),
                       "flagged_products": len({r["product_id"] for r in rows if r["severity"] == "block"}),
                       "ratings_lowered": sum(m["ratings_lowered"] for m in by_merchant),
                       "merchants_lowered": sum(1 for m in by_merchant if m["rating_drop"] > 0),
                       "reports": len(filed)}}
