"""POST /api/checkout: starts a cart at a Shopify store and returns the store's own checkout link. It never
completes anything, and it refuses local-marketplace stores and anything that isn't a Shopify variant."""
from fastapi.testclient import TestClient

from app.main import app
from app.shop_mcp import ShopMCP

client = TestClient(app)
LINE = {"variant_id": "gid://shopify/ProductVariant/40439010394202", "quantity": 1}


def test_returns_the_stores_checkout_link(monkeypatch):
    seen = []

    async def create_cart(self, shop, lines):
        seen.append((shop, lines))
        return {"id": "c1", "continue_url": "https://comfrt.myshopify.com/cart/c/abc?key=k"}

    monkeypatch.setattr(ShopMCP, "create_cart", create_cart)
    r = client.post("/api/checkout", json={"shop": "Comfrt.myshopify.com", "lines": [LINE]})
    assert r.status_code == 200 and r.json() == {"continue_url": "https://comfrt.myshopify.com/cart/c/abc?key=k", "id": "c1"}
    assert seen == [("comfrt.myshopify.com", [{"variant_id": LINE["variant_id"], "quantity": 1}])]


def test_refuses_local_stores_and_foreign_ids(monkeypatch):
    async def create_cart(self, shop, lines):
        raise AssertionError("must not reach Shopify")

    monkeypatch.setattr(ShopMCP, "create_cart", create_cart)
    assert client.post("/api/checkout", json={"shop": "streetform.warehouse.local", "lines": [LINE]}).status_code == 400
    assert client.post("/api/checkout", json={"shop": "a.myshopify.com", "lines": [{"variant_id": "wh-variant:x:1", "quantity": 1}]}).status_code == 400
    assert client.post("/api/checkout", json={"shop": "a.myshopify.com", "lines": [{**LINE, "quantity": 500}]}).status_code == 422
    assert client.post("/api/checkout", json={"shop": "not a domain", "lines": [LINE]}).status_code == 400


def test_a_store_error_is_reported_without_details(monkeypatch):
    async def create_cart(self, shop, lines):
        raise RuntimeError("https://secret.example/cart?key=abc")

    monkeypatch.setattr(ShopMCP, "create_cart", create_cart)
    r = client.post("/api/checkout", json={"shop": "a.myshopify.com", "lines": [LINE]})
    assert r.status_code == 502 and "secret" not in r.text
