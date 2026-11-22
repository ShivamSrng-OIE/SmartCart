"""The local warehouse catalog: fictional storefronts and their listings, in Shop MCP's product shape.

Sources, merged in this order (later wins for the same slug):
  1. data/warehouse/catalog/<category>/<slug>/listing.json   seed listings, committed to git
  2. data/state/listings/<slug>/listing.json                 listings the merchant portal created or edited
     (a listing.json containing {"deleted": true} hides the seed listing with that slug)
  3. the legacy generated items under eval/props/generated/items (video + audio props), via `legacy_products`

A `listing.json` is a compact record. `to_shopify` expands it into the structure Shopify's Shop MCP returns
for `get_product`: id, title, description, handle, rating, media, options, metadata, variants (each with
price, availability, options, media, seller, checkout url, condition) and price_range. Warehouse-only
fields start with `warehouse_` or are `listing_text` / `listing_summary` (the untrusted description,
which the firewall reads but a shopper skimming the page does not).
"""
from __future__ import annotations

import functools
import hashlib
import json
import re
import time
from pathlib import Path

from app import paths

PREFIX = "wh:"
VARIANT_PREFIX = "wh-variant:"
MEDIA_URL = "/media/warehouse"
CATALOG_TTL_S = 2.0
FILE_KINDS = (("image", "image/jpeg"), ("video", "video/mp4"), ("audio", "audio/wav"))
_SLUG_BAD = re.compile(r"[^a-z0-9]+")

_cache: dict = {"at": 0.0, "records": None, "merchants": None}


def slugify(text: str) -> str:
    text = text.lower().replace("&", " and ")
    return _SLUG_BAD.sub("-", text).strip("-")[:80] or "item"


def catalog_dir() -> Path:
    return paths.WAREHOUSE / "catalog"


def listings_dir() -> Path:
    return paths.STATE / "listings"


def invalidate() -> None:
    _cache.update(at=0.0, records=None, merchants=None, products=None, products_for=None)


def merchants() -> dict[str, dict]:
    if _cache["merchants"] is None:
        try:
            rows = json.loads((paths.WAREHOUSE / "merchants.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            rows = []
        _cache["merchants"] = {m["id"]: m for m in rows}
    return _cache["merchants"]


def _read_listing(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def records() -> list[dict]:
    """Every listing record with its folder, seed first then portal listings (cached for 2 s)."""
    now = time.monotonic()
    if _cache["records"] is not None and now - _cache["at"] < CATALOG_TTL_S:
        return _cache["records"]
    by_slug: dict[str, dict] = {}
    for path in sorted(catalog_dir().glob("*/*/listing.json")):
        rec = _read_listing(path)
        if rec and rec.get("slug"):
            by_slug[rec["slug"]] = {**rec, "_folder": str(path.parent), "_origin": "seed"}
    for path in sorted(listings_dir().glob("*/listing.json")):
        rec = _read_listing(path)
        if not rec or not rec.get("slug"):
            continue
        if rec.get("deleted"):
            by_slug.pop(rec["slug"], None)
            continue
        base = by_slug.get(rec["slug"])
        # A portal copy owns its files: editing a seed listing copies its media into the portal folder first.
        by_slug[rec["slug"]] = {**(base or {}), **rec, "_folder": str(path.parent), "_origin": "portal",
                                "_seed": base is not None}
    _cache.update(at=now, records=list(by_slug.values()))
    return _cache["records"]


@functools.lru_cache(maxsize=1024)
def _image_size_cached(path: str, mtime_ns: int) -> tuple[int, int]:
    return _read_size(Path(path))


def _image_size(path: Path) -> tuple[int, int]:
    try:
        return _image_size_cached(str(path), path.stat().st_mtime_ns)
    except OSError:
        return (1376, 768)


def _read_size(path: Path) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return (1376, 768)


def _skim(text: str) -> str:
    """What a shopper skimming the page reads: the description without the fulfillment fine print."""
    return "\n".join(line for line in text.splitlines() if not line.lower().startswith("fulfillment note:"))


IMAGE_NAME = re.compile(r"^image(?:-(\d+))?\.(?:jpg|png)$")
MAX_PHOTOS = 8


def image_files(folder: Path, record: dict | None = None) -> list[str]:
    """The listing's photos, main one first: image.jpg, image-2.jpg, ... (or the declared list, in order)."""
    declared = ((record or {}).get("files") or {}).get("images")
    names = [n for n in declared if (folder / n).is_file()] if isinstance(declared, list) else []
    if not names:
        names = sorted((p.name for p in folder.glob("image*") if IMAGE_NAME.match(p.name)),
                       key=lambda n: int(IMAGE_NAME.match(n).group(1) or 1))
    return names[:MAX_PHOTOS]


def _files(folder: Path, record: dict) -> dict[str, str]:
    declared = record.get("files") or {}
    return {kind: name for kind in ("video", "audio") if (name := declared.get(kind)) and (folder / name).is_file()}


def read_description(record: dict) -> str:
    folder = Path(record["_folder"])
    path = folder / "description.txt"
    if path.is_file():
        return path.read_text(encoding="utf-8", errors="replace").strip()
    return (record.get("description") or record.get("title") or "").strip()


def to_shopify(record: dict) -> dict:
    """Expand a listing record into Shop MCP's product shape, plus the warehouse-only fields."""
    folder = Path(record["_folder"])
    slug = record["slug"]
    merchant = merchants().get(record.get("merchant") or "", {})
    seller = {
        "id": merchant.get("shop_id", "gid://shopify/Shop/9000000"),
        "name": merchant.get("name", "Warehouse"),
        "url": f"https://{merchant.get('domain', 'warehouse.local')}",
        "domain": merchant.get("domain", "warehouse.local"),
        "links": [{"type": "privacy_policy", "url": f"https://{merchant.get('domain', 'warehouse.local')}/policies/privacy"},
                  {"type": "terms_of_service", "url": f"https://{merchant.get('domain', 'warehouse.local')}/policies/terms"}],
    }
    files = _files(folder, record)
    media: list[dict] = []
    for n, name in enumerate(image_files(folder, record), start=1):
        w, h = _image_size(folder / name)
        url = f"{MEDIA_URL}/{slug}/{name}"
        media.append({"type": "image", "url": url, "alt_text": record["title"] if n == 1 else f"{record['title']} photo {n}",
                      "width": w, "height": h, "preview": {"url": url, "width": w, "height": h}})
    for kind in ("video", "audio"):
        if kind in files:
            entry = {"type": kind, "url": f"{MEDIA_URL}/{slug}/{files[kind]}", "alt_text": f"{record['title']} {kind}"}
            if kind == "video" and media:
                entry["preview"] = {"url": media[0]["url"]}
            media.append(entry)

    text = read_description(record)
    price = int(record.get("price_cents") or 0)
    opt = record.get("options") or {}
    values = opt.get("values") or [{"label": "Default", "price_delta": 0}]
    variants = []
    for n, value in enumerate(values):
        amount = max(0, price + int(value.get("price_delta") or 0))
        variants.append({
            "id": f"{VARIANT_PREFIX}{slug}:{n}",
            "title": value["label"],
            "description": {"plain": text},
            "handle": slug,
            "url": f"https://{seller['domain']}/products/{slug}?variant={n}",
            "seller_product_id": f"gid://shopify/Product/{int(hashlib.sha256(slug.encode()).hexdigest()[:11], 16)}",
            "price": {"amount": amount, "currency": "USD"},
            "availability": {"available": True},
            "options": [{"name": opt.get("name", "Option"), "label": value["label"]}] if opt else [],
            "media": media[:1],
            "seller": seller,
            "checkout_url": None,
            "rating": record.get("rating"),
            "condition": ["new"],
            "source": "warehouse",
        })
    amounts = [v["price"]["amount"] for v in variants] or [price]
    rating = record.get("rating")  # None for a brand-new listing: no reviews, no stars
    return {
        "id": f"{PREFIX}{slug}",
        "title": record["title"],
        "description": {"plain": text},
        "handle": slug,
        "vendor": record.get("brand") or merchant.get("name"),
        "product_type": record.get("product_type"),
        "tags": record.get("tags") or [],
        "rating": {"value": rating["value"], "scale_min": 1, "scale_max": 5, "count": rating["count"]} if rating else None,
        "media": media,
        "options": [{"name": opt["name"], "values": [{"label": v["label"], "available": True, "exists": True} for v in values]}] if opt else [],
        "metadata": {"unique_selling_points": record.get("usp") or [], "top_features": record.get("features") or []},
        "variants": variants,
        "price_range": {"min": {"amount": min(amounts), "currency": "USD"}, "max": {"amount": max(amounts), "currency": "USD"}},
        # ---- warehouse-only fields (never part of Shopify's shape)
        "listing_text": text,
        "listing_summary": _skim(text),
        "warehouse_item": slug,
        "warehouse_folder": str(folder),
        "warehouse_merchant": record.get("merchant"),
        "warehouse_category": record.get("category"),
    }


def products() -> list[dict]:
    """Every seed and portal listing as a product (cached with the records, so a search is cheap)."""
    recs = records()
    if _cache.get("products_for") is not recs:
        _cache.update(products=[to_shopify(r) for r in recs], products_for=recs)
    return _cache["products"]


def get_record(slug: str) -> dict | None:
    return next((r for r in records() if r["slug"] == slug), None)


def get_product(slug: str) -> dict | None:
    rec = get_record(slug)
    return to_shopify(rec) if rec else None


def categories() -> list[dict]:
    counts: dict[str, dict] = {}
    for r in records():
        c = counts.setdefault(r.get("category") or "other", {"id": r.get("category") or "other",
                                                             "type": r.get("product_type"), "count": 0})
        c["count"] += 1
    return sorted(counts.values(), key=lambda c: -c["count"])


def public_product(product: dict) -> dict:
    """The product for the browser: Shopify's shape, without the untrusted-text helpers or local paths."""
    return {k: v for k, v in product.items() if k not in ("listing_summary", "warehouse_folder")}


# ----------------------------------------------------------------- legacy generated items
def legacy_products(items_dir: Path) -> list[dict]:
    """Props from eval/props/generated/items (photo + audio + sometimes video), as full products."""
    out = []
    for manifest in sorted(Path(items_dir).glob("*/manifest.json")):
        try:
            meta = json.loads(manifest.read_text(encoding="utf-8"))
            desc = manifest.parent / "description.txt"
            text = desc.read_text(encoding="utf-8").strip() if desc.is_file() else ""
        except (OSError, ValueError):
            continue
        out.append(_legacy_to_shopify(meta, manifest.parent, text))
    return out


LEGACY_SELLER = {"name": "Warehouse", "domain": "warehouse.local"}
LEGACY_MERCHANT = "warehouse-direct"


def _legacy_to_shopify(meta: dict, folder: Path, text: str) -> dict:
    base = meta["product"]
    item_id = meta["item_id"]
    title = f"{base['title']} (Warehouse {meta['variant']})"
    price = int(base.get("price_cents") or 0)
    seller = {"id": "gid://shopify/Shop/9000001", **LEGACY_SELLER, "url": "https://warehouse.local", "links": []}
    media = []
    for kind, name, _ in (("image", "image.png", ""), ("video", "video.mp4", ""), ("audio", "audio.wav", "")):
        if (folder / name).is_file():
            url = f"{MEDIA_URL}/{item_id}/{name}"
            entry = {"type": kind, "url": url, "alt_text": title}
            if kind == "image":
                entry["preview"] = {"url": url}
            elif kind == "video" and media:
                entry["preview"] = {"url": media[0]["url"]}
            media.append(entry)
    return {
        "id": PREFIX + item_id, "title": title, "product_type": meta.get("product_type"),
        "description": {"plain": text}, "handle": item_id, "vendor": "Warehouse Direct",
        "rating": {"value": 4.4, "scale_min": 1, "scale_max": 5, "count": 120 + sum(map(ord, item_id)) % 900},
        "media": media, "options": [], "tags": [meta.get("category") or ""],
        "metadata": {"unique_selling_points": [], "top_features": [l[2:] for l in text.splitlines() if l.startswith("- ")][:4]},
        "variants": [{
            "id": VARIANT_PREFIX + item_id, "title": title, "price": {"amount": price, "currency": "USD"},
            "availability": {"available": True}, "seller": dict(seller), "options": [], "media": media[:1],
            "condition": ["new"], "source": "warehouse", "description": {"plain": text}, "handle": item_id,
        }],
        "price_range": {"min": {"amount": price, "currency": "USD"}, "max": {"amount": price, "currency": "USD"}},
        "listing_text": text, "listing_summary": _skim(text), "warehouse_item": item_id,
        "warehouse_folder": str(folder), "warehouse_merchant": LEGACY_MERCHANT, "warehouse_category": "props",
        "warehouse_legacy": True,
    }
