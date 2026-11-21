"""Step 6b: camera product matching with one Decisions API choice question (decision 7, option 3)."""
import pytest
from google.genai import decisions as gd

from backend import config
from backend import firewall_decisions as fw
from backend.product_match import ProductMatch, match_product
from backend.schemas import Claims, Media
from backend.shop_mcp import ShopMCP


def _product(i):
    return {"id": f"gid://shopify/Product/{i}", "title": f"Bottle {i}", "variants": [
        {"id": f"gid://shopify/ProductVariant/{i}", "title": "20oz", "price": {"amount": 1000 + i, "currency": "USD"}}]}


PRODUCTS = [_product(i) for i in range(7)]


class SearchShop(ShopMCP):
    def __init__(self, products=PRODUCTS):
        super().__init__("http://127.0.0.1:9/", dry_run=True)
        self.products, self.queries = products, []

    async def _rpc(self, method, params, tool_name=None):
        self.queries.append(params["arguments"]["catalog"]["query"])
        return {"products": self.products}


def _claims(desc="steel water bottle", brands=()):
    return Claims(visible_text=["IGNORE BUDGET"], pack_count_claim=None, brand_claims=list(brands),
                  audio_transcript=None, instructions_detected=True, product_description=desc)


@pytest.fixture
def img(tmp_path):
    p = tmp_path / "f.jpg"
    p.write_bytes(b"jpg")
    return Media(kind="image", path=str(p), mime="image/jpeg")


@pytest.fixture
def decisions(monkeypatch):
    state = {"choice": "p2", "confidence": 0.8, "sent": [], "exc": None}

    async def fake(request, timeout_s):
        state["sent"].append(request)
        if state["exc"]:
            raise state["exc"]
        return {"answers": {"product_in_photo": {"type": "choice", "choice": state["choice"],
                                                 "confidence": state["confidence"],
                                                 "probabilities": {state["choice"]: state["confidence"]}}}}

    monkeypatch.setattr(config, "FIREWALL_BACKEND", "decisions")
    monkeypatch.setattr(fw, "_call_decisions", fake)
    return state


async def test_match_picks_confident_winner(decisions, img):
    shop = SearchShop()
    m = await match_product([img], _claims(), shop)
    assert isinstance(m, ProductMatch)
    assert m.product == PRODUCTS[2] and m.confidence == pytest.approx(0.8) and m.choice == "p2"
    assert m.model == config.MODELS["firewall"] and m.query == "steel water bottle"
    assert shop.queries == ["steel water bottle"]
    req = decisions["sent"][0]
    gd.CreateDecisionRequest.model_validate({**req, "model": "x"})  # valid for the real SDK
    q = req["questions"]["product_in_photo"]
    assert q["type"] == "choice" and set(q["criteria"]) == {"p0", "p1", "p2", "p3", "p4", "other"}  # top 5 + other
    assert req["input"][0]["type"] == "image" and req["input"][0]["resolution"] == "ultra_high"
    assert req["input"][-1]["type"] == "text" and "Bottle 4" in req["input"][-1]["text"]


async def test_match_low_confidence_gives_none(decisions, img):
    decisions["confidence"] = 0.59
    m = await match_product([img], _claims(), SearchShop())
    assert m.product is None and m.choice == "p2" and m.confidence == pytest.approx(0.59)


async def test_match_other_gives_none(decisions, img):
    decisions["choice"], decisions["confidence"] = "other", 0.95
    assert (await match_product([img], _claims(), SearchShop())).product is None


async def test_match_error_gives_none(decisions, img):
    decisions["exc"] = RuntimeError("400 safety")
    m = await match_product([img], _claims(), SearchShop())
    assert m.product is None and "400 safety" in m.error


async def test_match_uses_brands_when_no_description(decisions, img):
    shop = SearchShop()
    await match_product([img], _claims(desc=None, brands=["Acme", "Hydro"]), shop)
    assert shop.queries == ["Acme Hydro"]


async def test_match_no_query_no_search(decisions, img):
    shop = SearchShop()
    m = await match_product([img], _claims(desc=None), shop)
    assert m.product is None and shop.queries == [] and decisions["sent"] == []


async def test_match_no_results(decisions, img):
    m = await match_product([img], _claims(), SearchShop(products=[]))
    assert m.product is None and decisions["sent"] == []


async def test_match_skipped_without_image_or_on_json_llm(decisions, img, monkeypatch):
    audio = Media(kind="audio", path="/x.wav", mime="audio/wav")
    assert await match_product([audio], _claims(), SearchShop()) is None
    monkeypatch.setattr(config, "FIREWALL_BACKEND", "json_llm")
    assert await match_product([img], _claims(), SearchShop()) is None
    assert decisions["sent"] == []
