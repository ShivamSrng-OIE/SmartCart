"""Application routes for shared rules and the generated product dataset."""

from __future__ import annotations

import json
import logging
import math
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse


log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent.parent
ITEMS_DIR = ROOT / "eval" / "props" / "generated" / "items"
CASES_DIR = ROOT / "eval" / "cases"
ITEM_ID_RE = re.compile(r"^type-\d+-v\d+$")
DATASET_FILES = frozenset({"image.png", "audio.wav", "video.mp4", "spec.pdf", "description.txt"})

app_router = APIRouter()


@app_router.get("/api/rules")
def current_rules(request: Request):
    return request.app.state.rules.current().model_dump()


def _case_data(item_id: str, price_cents: int) -> tuple[str, int]:
    case_path = CASES_DIR / f"gen-{item_id}.json"
    if case_path.is_file():
        try:
            case = json.loads(case_path.read_text(encoding="utf-8"))
            request = case.get("user_request", case.get("request"))
            budget = case.get("budget")
            if isinstance(request, str) and budget is not None:
                return request, budget
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Could not read generated case %s: %s", case_path, exc)
    budget = math.ceil(price_cents * 1.5 / 100)
    return f"Buy one of these under ${budget}", budget


@app_router.get("/api/dataset")
def list_dataset():
    rows = []
    for manifest_path in sorted(ITEMS_DIR.glob("*/manifest.json")):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Skipping unreadable generated item manifest %s: %s", manifest_path, exc)
            continue
        item_id = manifest.get("item_id", manifest_path.parent.name)
        product = manifest.get("product") or {}
        price_cents = product.get("price_cents", 0)
        request_text, budget = _case_data(item_id, price_cents)
        rows.append({
            "item_id": item_id,
            "poisoned_modality": manifest.get("poisoned_modality"),
            "hijack": manifest.get("hijack"),
            "case_label": manifest.get("case_label"),
            "product": {
                "product_id": product.get("product_id"),
                "title": product.get("title"),
                "price_cents": price_cents,
            },
            "flaw": manifest.get("flaw"),
            "gate_passed": (manifest.get("gate") or {}).get("passed"),
            "files": sorted(name for name in DATASET_FILES if (manifest_path.parent / name).is_file()),
            "request": request_text,
            "budget": budget,
        })
    return rows


@app_router.get("/api/dataset/{item_id}/{file_name}")
def dataset_file(item_id: str, file_name: str):
    if not ITEM_ID_RE.fullmatch(item_id) or file_name not in DATASET_FILES:
        raise HTTPException(status_code=404, detail="Dataset file not found")
    items_root = ITEMS_DIR.resolve()
    item_dir = (items_root / item_id).resolve()
    path = (item_dir / file_name).resolve()
    if item_dir.parent != items_root or item_dir not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Dataset file not found")
    return FileResponse(path)
