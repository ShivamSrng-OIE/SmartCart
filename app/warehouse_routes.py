"""Public warehouse API: the storefront every shopper sees (no sign-in), mixed into search by the frontend.

    GET /api/warehouse/products        search / browse (q, max_price, category, merchant, limit, offset)
    GET /api/warehouse/products/{id}   one listing (a slug or "wh:<slug>")
    GET /api/warehouse/categories      category folders with counts
    GET /api/warehouse/merchants       storefronts with trust scores
    GET /media/warehouse/{id}/{file}   a listing's photos, video and audio
"""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app import app_routes, warehouse_shop
from app.warehouse import catalog, reputation

router = APIRouter()
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
MEDIA_RE = re.compile(r"^(?:image(?:-\d+)?\.(?:jpg|png)|video\.mp4|audio\.wav)$")
MEDIA_TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".wav": "audio/wav"}


def shape(product: dict) -> dict:
    """A product as the browser gets it: Shopify's shape plus a `warehouse` block (merchant, trust, status)."""
    shown = reputation.annotate(product)
    return {k: v for k, v in shown.items() if k not in ("listing_summary", "warehouse_folder", "listing_text")}


def _merchant_names() -> dict[str, str]:
    return {mid: m["name"] for mid, m in catalog.merchants().items()}


@router.get("/api/warehouse/products")
def list_products(q: str = "", max_price: float | None = None, category: str | None = None, merchant: str | None = None,
                  limit: int = Query(48, ge=1, le=200), offset: int = Query(0, ge=0)):
    terms = re.findall(r"[a-z0-9]+", q.lower())
    cap = int(round(max_price * 100)) if max_price is not None else None
    rows = []
    for p in warehouse_shop.all_products():
        if cap is not None and warehouse_shop._price(p) > cap:
            continue
        if category and p.get("warehouse_category") != category:
            continue
        if merchant and p.get("warehouse_merchant") != merchant:
            continue
        if terms and not warehouse_shop.matches(p, terms):
            continue
        rows.append(p)
    rows.sort(key=reputation.rank_penalty)  # distrusted merchants sink; equal trust keeps catalog order
    return {"products": [shape(p) for p in rows[offset:offset + limit]], "total": len(rows)}


@router.get("/api/warehouse/products/{product_id}")
def get_product(product_id: str):
    pid = product_id if product_id.startswith(catalog.PREFIX) else catalog.PREFIX + product_id
    product = warehouse_shop.find(pid)
    if not product:
        raise HTTPException(404, "unknown listing")
    return {"product": shape(product)}


@router.get("/api/warehouse/categories")
def categories():
    return {"categories": catalog.categories()}


@router.get("/api/warehouse/merchants")
def merchants():
    return {"merchants": reputation.overview()["merchants"]}


@router.get("/media/warehouse/{item_id}/{file_name}")
def media(item_id: str, file_name: str):
    if not ID_RE.fullmatch(item_id) or not MEDIA_RE.fullmatch(file_name):
        raise HTTPException(404, "not found")
    record = catalog.get_record(item_id)
    folder = Path(record["_folder"]) if record else Path(app_routes.ITEMS_DIR) / item_id
    path = (folder / file_name).resolve()
    if folder.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(path, media_type=MEDIA_TYPES[path.suffix], headers={"Cache-Control": "public, max-age=300"})
