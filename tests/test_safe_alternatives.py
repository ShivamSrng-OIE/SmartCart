"""The safe swap offers several real Shopify choices, each with a photo and its own store's checkout link, and
never another listing from the local marketplace (where the held product came from)."""
from app.defender_neon import safe_swap
from app.schemas import Intent
from tests.test_defender import FakeShop, variant


def offer(pid, title, cents, domain, image=None, checkout=None):
    v = variant(f"gid://shopify/ProductVariant/{pid}", cents, domain)
    if checkout:
        v["checkout_url"] = checkout
    p = {"id": pid, "title": title, "variants": [v]}
    if image:
        p["media"] = [{"type": "image", "url": image}]
    return p


async def test_several_choices_cheapest_first_with_photos_and_checkout_links():
    results = [
        offer("p1", "Cheap Hoodie", 2000, "a.myshopify.com", "https://cdn.shopify.com/a.jpg", "https://a.myshopify.com/cart/1:1"),
        offer("p2", "Mid Hoodie", 3500, "b.myshopify.com", "https://cdn.shopify.com/b.jpg", "https://b.myshopify.com/cart/2:1"),
        offer("p3", "Pricey Hoodie", 4500, "c.myshopify.com", "https://cdn.shopify.com/c.jpg"),
        offer("wh:local-hoodie", "Local Hoodie", 1000, "streetform.warehouse.local", "/media/warehouse/x.jpg"),
        offer("p4", "Too Dear Hoodie", 9000, "d.myshopify.com"),
    ]
    held = {"id": "wh:held", "title": "Held Hoodie"}
    swap = await safe_swap(Intent(text="hoodie", budget=50.0, quantity=1), held, FakeShop(results))
    assert swap["title"] == "Cheap Hoodie" and swap["image"] == "https://cdn.shopify.com/a.jpg"
    alts = swap["alternatives"]
    assert [a["title"] for a in alts] == ["Mid Hoodie", "Pricey Hoodie"]  # over budget and local listings left out
    assert alts[0]["image"] == "https://cdn.shopify.com/b.jpg" and alts[0]["checkout_url"] == "https://b.myshopify.com/cart/2:1"
    assert all(not a["product_id"].startswith("wh:") for a in alts) and alts[0]["total"] == 35.0


async def test_the_held_local_listing_is_never_the_safe_cart():
    results = [offer("wh:held", "Held Hoodie", 500, "streetform.warehouse.local"), offer("p1", "Real Hoodie", 3000, "a.myshopify.com")]
    shop = FakeShop(results)
    swap = await safe_swap(Intent(text="hoodie", budget=None, quantity=1), results[0], shop)
    assert swap["title"] == "Real Hoodie" and swap["alternatives"] == []
    assert shop.calls[-1][1] == "a.myshopify.com"
