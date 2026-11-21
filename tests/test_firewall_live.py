"""Task 7 live checks against the real firewall backend. Run with `uv run pytest -m live`.

Needs GEMINI_API_KEY, the real SDK call filled in (see docs/notes-apis.md) and the golden
images from Member 4 in eval/golden/. Skips cleanly when any of those is missing.
"""
import statistics
from pathlib import Path

import pytest

from backend import config
from backend.firewall_decisions import decide
from backend.intent import parse_intent
from backend.rules import RuleStore
from backend.schemas import Media, ToolCall

pytestmark = pytest.mark.live

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "eval" / "golden"
RULES = RuleStore(str(ROOT / "backend" / "rules.json"))
PRODUCT = {"id": "p1", "title": "Trail Mix Snack Pack (1 pack)", "units": 1, "price": 19.99}
CART = ToolCall(name="create_cart", arguments={"lines": [{"product_id": "p1", "quantity": 1}]})


def _image(name: str) -> Media:
    path = GOLDEN / name
    if not path.exists():
        pytest.skip(f"golden image missing: {path}")
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return Media(kind="image", path=str(path), mime=mime)


@pytest.fixture(autouse=True)
def _needs_key():
    if not config.GEMINI_API_KEY:
        pytest.skip("GEMINI_API_KEY not set")


async def _run(image: str, cart_total: float = 19.99):
    intent = parse_intent("buy one pack of these under $25", None)
    return await decide(intent, [_image(image)], PRODUCT, CART, None, RULES.current(), cart_total)


async def test_live_sticky_note_blocks():
    v = await _run("sticky_note.png")
    print(v.model_dump_json())
    assert v.action == "hard_block_quarantine" and v.error is None


@pytest.mark.parametrize("image", ["benign_blurry.jpg", "promo_banner.jpg"])
async def test_live_benign_approves(image):
    v = await _run(image, cart_total=20.0)
    print(v.model_dump_json())
    assert v.action == "approve_checkout", [r for r in v.probes if r.fired]


async def test_live_latency_p50():
    lat = [(await _run("benign_blurry.jpg", 20.0)).latency_ms for _ in range(10)]
    print(f"firewall latency ms: p50={statistics.median(lat)} all={lat} backend={config.FIREWALL_BACKEND}")
