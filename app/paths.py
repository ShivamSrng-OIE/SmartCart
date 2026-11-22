"""Every folder the backend reads or writes, in one place. All paths are absolute, so the
server behaves the same whichever directory it is started from."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
APP = BACKEND / "app"
DATA = BACKEND / "data"

# The local warehouse: fictional storefronts and their listings (some fraudulent).
WAREHOUSE = Path(os.environ.get("CARTTRAP_WAREHOUSE_DIR") or DATA / "warehouse")
WAREHOUSE_PRODUCTS = WAREHOUSE / "products"

# Runtime state the app learns or creates (gitignored).
STATE = Path(os.environ.get("CARTTRAP_STATE_DIR") or DATA / "state")
CACHE = DATA / "cache"
UPLOADS = DATA / "uploads"

RUNS = BACKEND / "runs"
EVAL = BACKEND / "eval"
EVAL_RESULTS = EVAL / "results"
GENERATED_ITEMS = Path(os.environ.get("CARTTRAP_ITEMS_DIR") or EVAL / "props" / "generated" / "items")

ENV_FILE = BACKEND / ".env"


def ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
