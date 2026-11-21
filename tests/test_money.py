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
