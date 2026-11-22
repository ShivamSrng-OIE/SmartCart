"""What the merchant portal does to listings: create, edit, delete, add photos, safety review.

Listings made here live in data/state/listings/<slug>/ (gitignored) and override or extend the committed
seed catalog (see catalog.records). Editing a seed listing first copies it into that folder, so the seed
files in git are never modified. Everything a merchant uploads is untrusted media: photos are decoded and
re-encoded as JPEG (so nothing but pixels is stored), audio is converted to WAV, and the safety review reads
the description with the rule scanner (a deeper model read of the photos is available on request).
"""
from __future__ import annotations

import io
import json
import re
import shutil
from pathlib import Path

from app import scanner
from app.warehouse import catalog, reputation

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_VIDEO_BYTES = 60 * 1024 * 1024
MAX_AUDIO_BYTES = 15 * 1024 * 1024
MAX_DESCRIPTION = 8000
MAX_PRICE_CENTS = 1_000_000
VIDEO_EXT = {".mp4", ".m4v", ".mov"}
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".aac"}


class PortalError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def folder(slug: str) -> Path:
    return catalog.listings_dir() / slug


def _slug_ok(slug: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", slug or ""):
        raise PortalError("unknown listing", 404)
    return slug


def can_edit(claims: dict, record: dict) -> bool:
    return claims["role"] == "admin" or record.get("merchant") == claims["sub"]


def own_record(slug: str, claims: dict) -> dict:
    record = catalog.get_record(_slug_ok(slug))
    if not record:
        raise PortalError("unknown listing", 404)
    if not can_edit(claims, record):
        raise PortalError("that listing belongs to another merchant", 403)
    return record


def parse_options(text: str) -> list[dict]:
    """'S, M, L' or 'Small, Large:+3.50' -> [{'label','price_delta'(cents)}]. Empty text -> one default value."""
    values = []
    for part in (text or "").split(","):
        label, _, delta = part.strip().partition(":")
        label = label.strip()[:40]
        if not label:
            continue
        try:
            cents = int(round(float(delta.replace("+", "").replace("$", "")) * 100)) if delta.strip() else 0
        except ValueError:
            raise PortalError(f"bad price difference for option '{label}'")
        values.append({"label": label, "price_delta": cents})
    return values[:12] or [{"label": "Default", "price_delta": 0}]


def to_cents(price: float) -> int:
    cents = int(round(float(price) * 100))
    if not 50 <= cents <= MAX_PRICE_CENTS:
        raise PortalError("price must be between $0.50 and $10,000")
    return cents


# ---------------------------------------------------------------- uploads
def save_image(data: bytes, dest: Path) -> None:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise PortalError("a photo must be an image under 12 MB")
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((2000, 2000))
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "JPEG", quality=90)
    except (UnidentifiedImageError, OSError, ValueError):
        raise PortalError("that file is not a readable image")


def _next_image_name(target: Path) -> str:
    taken = {int(m.group(1) or 1) for p in target.glob("image*") if (m := catalog.IMAGE_NAME.match(p.name))}
    n = max(taken, default=0) + 1
    return "image.jpg" if n == 1 else f"image-{n}.jpg"


async def _save_audio(data: bytes, filename: str, dest: Path) -> None:
    if not data or len(data) > MAX_AUDIO_BYTES or Path(filename or "").suffix.lower() not in AUDIO_EXT:
        raise PortalError("audio must be a wav, mp3, m4a, ogg or webm file under 15 MB")
    from app.media_prep import to_wav

    raw = dest.with_suffix(Path(filename).suffix.lower())
    raw.write_bytes(data)
    try:
        wav = await to_wav(raw)
        if wav != dest:
            shutil.move(str(wav), dest)
    finally:
        if raw.exists() and raw != dest:
            raw.unlink(missing_ok=True)


def _save_video(data: bytes, filename: str, dest: Path) -> None:
    if not data or len(data) > MAX_VIDEO_BYTES or Path(filename or "").suffix.lower() not in VIDEO_EXT:
        raise PortalError("video must be an mp4 or mov file under 60 MB")
    dest.write_bytes(data)


# ---------------------------------------------------------------- listings
def _ensure_copy(slug: str) -> Path:
    """The portal folder for a listing; a seed listing is copied there first (seed files never change)."""
    target = folder(slug)
    seed = catalog.get_record(slug)
    if not (target / "listing.json").exists():
        if not seed:
            raise PortalError("unknown listing", 404)
        target.mkdir(parents=True, exist_ok=True)
        src = Path(seed["_folder"])
        for item in src.iterdir():
            if item.is_file():
                shutil.copyfile(item, target / item.name)
    return target


def _write(target: Path, record: dict, description: str) -> None:
    clean = {k: v for k, v in record.items() if not k.startswith("_")}
    (target / "listing.json").write_text(json.dumps(clean, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (target / "description.txt").write_text(description.strip() + "\n", encoding="utf-8")
    catalog.invalidate()


def unique_slug(title: str, merchant: str) -> str:
    base = catalog.slugify(title) or "item"
    existing = {r["slug"] for r in catalog.records()}
    if base in existing:
        base = f"{merchant}-{base}"[:80]
    slug, n = base, 2
    while slug in existing:
        slug = f"{base}-{n}"
        n += 1
    return slug


def clean_text(value: str | None, limit: int, field: str, required: bool = False) -> str:
    text = re.sub(r"[ \t]+", " ", (value or "").replace("\r", "")).strip()
    if required and not text:
        raise PortalError(f"{field} is required")
    return text[:limit]


async def create(merchant_id: str, *, title: str, price: float, description: str, product_type: str, category: str,
                 option_name: str, options: str, photos: list[bytes], video: tuple[bytes, str] | None,
                 audio: tuple[bytes, str] | None) -> dict:
    if merchant_id not in catalog.merchants():
        raise PortalError("unknown merchant")
    title = clean_text(title, 120, "title", required=True)
    description = clean_text(description, MAX_DESCRIPTION, "description", required=True)
    if not photos:
        raise PortalError("add at least one photo")
    slug = unique_slug(title, merchant_id)
    target = folder(slug)
    try:
        target.mkdir(parents=True, exist_ok=True)
        add_names: list[str] = []
        for data in photos[:catalog.MAX_PHOTOS]:
            name = _next_image_name(target)
            save_image(data, target / name)
            add_names.append(name)
        files: dict = {"images": add_names}
        if video:
            _save_video(video[0], video[1], target / "video.mp4")
            files["video"] = "video.mp4"
        if audio:
            await _save_audio(audio[0], audio[1], target / "audio.wav")
            files["audio"] = "audio.wav"
        merchant = catalog.merchants()[merchant_id]
        category = catalog.slugify(category or "everyday-goods")
        record = {
            "slug": slug, "category": category, "merchant": merchant_id, "title": title, "brand": merchant["name"],
            "product_type": clean_text(product_type, 60, "type") or "Everyday Goods", "price_cents": to_cents(price),
            "tags": sorted({w for w in re.findall(r"[a-z]{3,}", f"{title} {product_type}".lower())})[:8],
            "options": {"name": clean_text(option_name, 30, "option") or "Option", "values": parse_options(options)},
            "features": [l[2:].strip() for l in description.splitlines() if l.startswith("- ")][:6],
            "usp": [description.splitlines()[0][:160]], "rating": None, "files": files,
            "truth": {"label": "unknown", "mode": "unknown", "kind": "unknown", "image_text": None, "description_text": None,
                      "promo": False, "source_photo": None},
        }
        _write(target, record, description)
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise
    return catalog.get_record(slug)


async def update(slug: str, claims: dict, *, title: str | None = None, price: float | None = None, description: str | None = None,
                 product_type: str | None = None, option_name: str | None = None, options: str | None = None,
                 category: str | None = None, new_photos: list[bytes] | None = None, video: tuple[bytes, str] | None = None,
                 audio: tuple[bytes, str] | None = None) -> dict:
    record = own_record(slug, claims)
    target = _ensure_copy(slug)
    stored = json.loads((target / "listing.json").read_text(encoding="utf-8"))
    if title is not None:
        stored["title"] = clean_text(title, 120, "title", required=True)
    if price is not None:
        stored["price_cents"] = to_cents(price)
    if product_type is not None:
        stored["product_type"] = clean_text(product_type, 60, "type") or stored.get("product_type")
    if category:
        stored["category"] = catalog.slugify(category)
    if options is not None or option_name is not None:
        old = stored.get("options") or {}
        stored["options"] = {"name": clean_text(option_name, 30, "option") if option_name else old.get("name", "Option"),
                             "values": parse_options(options) if options is not None else old.get("values", [])}
    files = dict(stored.get("files") or {})
    if new_photos:
        files["images"] = add_photos_to(target, stored, new_photos)
    if video:
        _save_video(video[0], video[1], target / "video.mp4")
        files["video"] = "video.mp4"
    if audio:
        await _save_audio(audio[0], audio[1], target / "audio.wav")
        files["audio"] = "audio.wav"
    stored["files"] = files
    text = clean_text(description, MAX_DESCRIPTION, "description", required=True) if description is not None else catalog.read_description(record)
    _write(target, stored, text)
    return catalog.get_record(slug)


def add_photos_to(target: Path, stored: dict, photos: list[bytes]) -> list[str]:
    names = catalog.image_files(target, stored)
    if len(names) + len(photos) > catalog.MAX_PHOTOS:
        raise PortalError(f"a listing can have at most {catalog.MAX_PHOTOS} photos")
    for data in photos:
        name = _next_image_name(target)
        save_image(data, target / name)
        names.append(name)
    return names


def remove_photo(slug: str, claims: dict, name: str) -> dict:
    record = own_record(slug, claims)
    target = _ensure_copy(slug)
    stored = json.loads((target / "listing.json").read_text(encoding="utf-8"))
    names = catalog.image_files(target, stored)
    if name not in names:
        raise PortalError("unknown photo", 404)
    if len(names) == 1:
        raise PortalError("a listing needs at least one photo")
    (target / name).unlink(missing_ok=True)
    stored.setdefault("files", {})["images"] = [n for n in names if n != name]
    _write(target, stored, catalog.read_description({**record, "_folder": str(target)}))
    return catalog.get_record(slug)


def delete(slug: str, claims: dict) -> None:
    record = own_record(slug, claims)
    target = folder(slug)
    shutil.rmtree(target, ignore_errors=True)
    if record.get("_seed") or record.get("_origin") == "seed":
        target.mkdir(parents=True, exist_ok=True)  # a tombstone hides the committed listing
        (target / "listing.json").write_text(json.dumps({"slug": slug, "deleted": True}), encoding="utf-8")
    catalog.invalidate()


# ---------------------------------------------------------------- review
def review(record: dict) -> dict:
    """Instant safety scan of the description with the rule scanner."""
    findings = scanner.scan(catalog.read_description(record), "description")
    out = scanner.summarize(findings)
    out["advice"] = ("Remove the highlighted text. Instructions aimed at AI shopping agents get a listing flagged and pushed down in search."
                     if out["flagged"] else "No instructions aimed at shopping agents found in the description.")
    return out


def record_scan_incident(record: dict, summary: dict) -> None:
    if summary["flagged"]:
        reputation.record_incident(product_id=f"{catalog.PREFIX}{record['slug']}", merchant=record.get("merchant"),
                                   title=record["title"], source="portal", severity="scan",
                                   reasons=["agent_instruction", *summary["categories"]],
                                   quotes=[q["quote"] for q in summary["quotes"]], category=record.get("category"))
