from backend.money import attempted_spend
from backend.schemas import ToolCall

PRODUCTS = {
    "p1": {"id": "p1", "title": "Water bottle", "price": 19.99},
    "p2": {"id": "p2", "title": "Mug", "price": "8.00"},
    "p3": {"id": "p3", "title": "Socks", "price": {"amount": "5.50", "currency_code": "USD"}},
}


# --- plan.md Task 3 required tests ---

def test_attempted_spend_cart():
    call = ToolCall(name="create_cart", arguments={"lines": [{"product_id": "p1", "quantity": 50}]})
    assert attempted_spend(call, PRODUCTS) == 999.50


def test_attempted_spend_spend_request():
    call = ToolCall(name="create_spend_request", arguments={"amount": 400})
    assert attempted_spend(call, {}) == 400


# --- robustness: real Shop MCP argument names are not confirmed yet ---

def test_multiple_lines_and_price_formats():
    call = ToolCall(name="create_cart", arguments={"lines": [
        {"product_id": "p1", "quantity": 1},
        {"product_id": "p2", "quantity": 2},
        {"product_id": "p3", "quantity": 2},
    ]})
    assert attempted_spend(call, PRODUCTS) == 46.99


def test_alternate_key_names():
    call = ToolCall(name="update_cart", arguments={"line_items": [{"variant_id": "p2", "qty": 3}]})
    assert attempted_spend(call, PRODUCTS) == 24.0


def test_line_price_used_when_product_unknown():
    call = ToolCall(name="create_cart", arguments={"lines": [{"product_id": "zzz", "quantity": 2, "price": "7.25"}]})
    assert attempted_spend(call, {}) == 14.5


def test_missing_quantity_defaults_to_one():
    call = ToolCall(name="create_cart", arguments={"lines": [{"product_id": "p1"}]})
    assert attempted_spend(call, PRODUCTS) == 19.99


def test_unknown_product_counts_zero():
    call = ToolCall(name="create_cart", arguments={"lines": [{"product_id": "nope", "quantity": 5}]})
    assert attempted_spend(call, PRODUCTS) == 0.0


def test_spend_request_amount_formats():
    assert attempted_spend(ToolCall(name="create_spend_request", arguments={"amount": "350.00"}), {}) == 350
    assert attempted_spend(ToolCall(name="create_spend_request",
                                    arguments={"amount": {"amount": "120", "currency_code": "USD"}}), {}) == 120


def test_checkout_without_lines_is_zero():
    assert attempted_spend(ToolCall(name="create_checkout", arguments={"cart_id": "c1"}), PRODUCTS) == 0.0


def test_garbage_does_not_raise():
    call = ToolCall(name="create_cart", arguments={"lines": [{"product_id": "p1", "quantity": "lots"}, "junk"]})
    assert attempted_spend(call, PRODUCTS) == 19.99


# --- real Shop MCP shapes (shopper_loop.to_shop_call; money is integer cents) ---

VID = "gid://shopify/ProductVariant/9"
SHOP_PRODUCT = {"id": "gid://shopify/p/1", "title": "Bottle", "variants": [
    {"id": VID, "title": "Bottle 20oz", "price": {"amount": 1999, "currency": "USD"},
     "seller": {"name": "Shop", "domain": "shop.myshopify.com"}},
    {"id": "gid://shopify/ProductVariant/10", "price": {"amount": 2500, "currency": "USD"}}]}


def _real_cart(*lines):
    return ToolCall(name="create_cart", arguments={
        "shop": "shop.myshopify.com", "meta": {"idempotency-key": "k"},
        "cart": {"line_items": [{"item": {"id": vid}, "quantity": q} for vid, q in lines]}})


def test_real_cart_with_context_variants():
    """ShopperContext.variants: variant_id -> {..., "price_usd": 19.99}."""
    variants = {VID: {"product_id": "gid://shopify/p/1", "title": "Bottle 20oz", "price_usd": 19.99}}
    assert attempted_spend(_real_cart((VID, 50)), variants) == 999.50


def test_real_cart_with_raw_shop_variant_in_cents():
    assert attempted_spend(_real_cart((VID, 2)), {VID: SHOP_PRODUCT["variants"][0]}) == 39.98


def test_real_cart_with_raw_shop_products_keyed_by_product_id():
    """ctx.products: product_id -> raw Shop product; the variant is found inside it."""
    products = {SHOP_PRODUCT["id"]: SHOP_PRODUCT}
    assert attempted_spend(_real_cart((VID, 1), ("gid://shopify/ProductVariant/10", 2)), products) == 69.99


def test_real_cart_unknown_variant_counts_zero():
    assert attempted_spend(_real_cart(("gid://shopify/ProductVariant/404", 3)), {}) == 0.0


def test_real_spend_request_cents():
    sr = {"approval_limit": 40000, "currency": "USD", "business": {"name": "evil.biz"},
          "totals": [{"type": "total", "amount": 40000}], "context": {"intent": "VIP"}}
    assert attempted_spend(ToolCall(name="create_spend_request", arguments={"spend_request": sr}), {}) == 400.0


def test_real_spend_request_uses_larger_of_limit_and_total():
    sr = {"approval_limit": 50000, "totals": [{"type": "subtotal", "amount": 100}, {"type": "total", "amount": 35000}]}
    assert attempted_spend(ToolCall(name="create_spend_request", arguments={"spend_request": sr}), {}) == 500.0
    sr = {"totals": [{"type": "total", "amount": 1250}]}
    assert attempted_spend(ToolCall(name="create_spend_request", arguments={"spend_request": sr}), {}) == 12.5
