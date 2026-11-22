"""Merchant portal API. Shoppers never sign in; sellers do.

    POST   /api/merchant/login                      {username, password} -> token
    GET    /api/merchant/me                         the signed-in store and its trust
    GET    /api/merchant/listings                   this store's listings (admin: all, or ?merchant=)
    POST   /api/merchant/listings                   create (multipart; one or more `photos`)
    PUT    /api/merchant/listings/{slug}            edit fields and/or add photos
    DELETE /api/merchant/listings/{slug}
    DELETE /api/merchant/listings/{slug}/photos/{name}
    POST   /api/merchant/listings/{slug}/review     safety scan (deep=1 also has the model read the photos)
"""
from __future__ import annotations

from fastapi import APIRouter, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app import config
from app.warehouse import auth, catalog, portal, reputation

router = APIRouter()


def current(authorization: str | None) -> dict:
    claims = auth.verify(auth.bearer(authorization))
    if not claims:
        raise HTTPException(401, "sign in as a merchant")
    return claims


def _guard(fn):
    try:
        return fn()
    except portal.PortalError as e:
        raise HTTPException(e.status, str(e))


class Login(BaseModel):
    username: str
    password: str


@router.post("/api/merchant/login")
def login(body: Login):
    result = auth.login(body.username, body.password)
    if not result:
        raise HTTPException(401, "wrong username or password")
    return {**result, "merchant": catalog.merchants().get(result["username"])}


def _row(record: dict) -> dict:
    product = catalog.to_shopify(record)
    status = reputation.product_stats(product["id"])
    return {
        "slug": record["slug"], "id": product["id"], "title": record["title"], "category": record.get("category"),
        "merchant": record.get("merchant"), "price_cents": record.get("price_cents"), "product_type": record.get("product_type"),
        "origin": record.get("_origin"), "photos": [m["url"] for m in product["media"] if m["type"] == "image"],
        "has_video": any(m["type"] == "video" for m in product["media"]), "has_audio": any(m["type"] == "audio" for m in product["media"]),
        "options": (record.get("options") or {}), "description": catalog.read_description(record),
        "status": status["status"], "incidents": status["incidents"], "review": portal.review(record),
    }


@router.get("/api/merchant/me")
def me(authorization: str | None = Header(None)):
    claims = current(authorization)
    mid = claims["sub"]
    merchant = catalog.merchants().get(mid)
    mine = [r for r in catalog.records() if claims["role"] == "admin" or r.get("merchant") == mid]
    return {"username": mid, "role": claims["role"], "merchant": merchant,
            "stats": reputation.merchant_stats(mid) if merchant else None, "listings": len(mine),
            "stores": [{"id": k, "name": v["name"]} for k, v in catalog.merchants().items()] if claims["role"] == "admin" else None,
            "demo_login_hint": config.MERCHANT_USERNAME}


@router.get("/api/merchant/listings")
def listings(merchant: str | None = None, authorization: str | None = Header(None)):
    claims = current(authorization)
    target = merchant if claims["role"] == "admin" else claims["sub"]
    rows = [r for r in catalog.records() if target is None or r.get("merchant") == target]
    return {"listings": [_row(r) for r in rows], "total": len(rows)}


async def _uploads(files: list[UploadFile] | None) -> list[bytes]:
    return [await f.read() for f in files or [] if f and f.filename]


async def _one(f: UploadFile | None) -> tuple[bytes, str] | None:
    return (await f.read(), f.filename or "") if f and f.filename else None


@router.post("/api/merchant/listings")
async def create_listing(
    title: str = Form(...), price: float = Form(...), description: str = Form(...), product_type: str = Form("Everyday Goods"),
    category: str = Form("everyday-goods"), option_name: str = Form("Option"), options: str = Form(""), merchant: str | None = Form(None),
    photos: list[UploadFile] | None = None, video: UploadFile | None = None, audio: UploadFile | None = None,
    authorization: str | None = Header(None),
):
    claims = current(authorization)
    owner = merchant if claims["role"] == "admin" and merchant else claims["sub"]
    try:
        record = await portal.create(owner, title=title, price=price, description=description, product_type=product_type,
                                     category=category, option_name=option_name, options=options, photos=await _uploads(photos),
                                     video=await _one(video), audio=await _one(audio))
    except portal.PortalError as e:
        raise HTTPException(e.status, str(e))
    row = _row(record)
    portal.record_scan_incident(record, row["review"])
    return {"listing": row}


@router.put("/api/merchant/listings/{slug}")
async def edit_listing(
    slug: str, title: str | None = Form(None), price: float | None = Form(None), description: str | None = Form(None),
    product_type: str | None = Form(None), category: str | None = Form(None), option_name: str | None = Form(None),
    options: str | None = Form(None), photos: list[UploadFile] | None = None, video: UploadFile | None = None,
    audio: UploadFile | None = None, authorization: str | None = Header(None),
):
    claims = current(authorization)
    try:
        record = await portal.update(slug, claims, title=title, price=price, description=description, product_type=product_type,
                                     category=category, option_name=option_name, options=options, new_photos=await _uploads(photos),
                                     video=await _one(video), audio=await _one(audio))
    except portal.PortalError as e:
        raise HTTPException(e.status, str(e))
    row = _row(record)
    if description is not None:
        portal.record_scan_incident(record, row["review"])
    return {"listing": row}


@router.delete("/api/merchant/listings/{slug}")
def delete_listing(slug: str, authorization: str | None = Header(None)):
    claims = current(authorization)
    _guard(lambda: portal.delete(slug, claims))
    return {"deleted": slug}


@router.delete("/api/merchant/listings/{slug}/photos/{name}")
def delete_photo(slug: str, name: str, authorization: str | None = Header(None)):
    claims = current(authorization)
    return {"listing": _row(_guard(lambda: portal.remove_photo(slug, claims, name)))}


@router.post("/api/merchant/listings/{slug}/review")
async def review_listing(slug: str, deep: bool = Query(False), authorization: str | None = Header(None)):
    claims = current(authorization)
    record = _guard(lambda: portal.own_record(slug, claims))
    result = portal.review(record)
    if deep:
        from app import warehouse_shop
        from app.perception_argon import perceive

        product = warehouse_shop.find(catalog.PREFIX + slug)
        claims_out = await perceive(warehouse_shop.listing_media(product)) if product else None
        result["deep"] = claims_out.model_dump() if claims_out else None
        if claims_out and claims_out.instructions_detected:
            result["flagged"] = True
            result["advice"] = "The photos or video contain instructions aimed at AI shopping agents. Replace them."
    return result
