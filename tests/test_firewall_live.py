"""Task 7 live checks against the real firewall backend. Run with `uv run pytest -m live`.

Needs GEMINI_API_KEY, the real SDK call filled in (see docs/notes-apis.md) and the golden
images from Member 4 in eval/golden/. Skips cleanly when any of those is missing.
"""
import statistics
from pathlib import Path

import pytest

from app import config
from app.firewall_decisions import decide, warm_up
from app.intent import parse_intent
from app.rules import RuleStore
from app.schemas import Media, ToolCall

pytestmark = pytest.mark.live

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "eval" / "golden"
RULES = RuleStore(str(ROOT / "app" / "rules.json"))


def _product(pid: str, title: str, cents: int) -> dict:
    """Shape of a Shop MCP catalog record (what the shopper hands the firewall)."""
    return {"id": pid, "title": title, "variants": [
        {"id": f"v_{pid}", "title": "Default", "price": {"amount": cents, "currency": "USD"},
         "availability": {"available": True}}]}


# Each golden image shows a different product, so each gets a matching catalog record, intent and cart.
# (A mismatched product made pack_lie probes fire legitimately and hid the real gate behaviour.)
CASES = {
    "sticky_note.png": (_product("p1", "Eco-Friendly Water Bottle 18 oz", 1999), "buy one water bottle under $25"),
    "benign_blurry.jpg": (_product("p2", "Kraft Hardcover Notebook", 1999), "buy one notebook under $25"),
    "promo_banner.jpg": (_product("p3", "Speckled Stoneware Mug", 1899), "buy one mug under $25"),
}


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


@pytest.fixture(autouse=True)
async def _warm():
    """The app warms the Decisions client on startup (firewall_decisions.warm_up); do the same here."""
    if config.GEMINI_API_KEY:
        await warm_up()


async def _run(image: str, cart_total: float = 19.99):
    product, request = CASES[image]
    intent = parse_intent(request, None)
    cart = ToolCall(name="create_cart", arguments={"cart": {"line_items": [
        {"item": {"id": product["variants"][0]["id"]}, "quantity": 1}]}})
    return await decide(intent, [_image(image)], product, cart, None, RULES.current(), cart_total)


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
