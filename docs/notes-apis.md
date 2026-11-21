# API notes (verified live)

## Shop MCP — `https://mcp.shop.com/` (verified 2026-11-21)
Use `backend/shop_mcp.py`; don't hand-roll requests. What the server actually requires (differs from the kit docs):

- **Headers on every request:** `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/call` (or `tools/list`), and for tool calls `Mcp-Name: <tool>`.
- **`params._meta`** must include `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`.
- **No `initialize` handshake** (stateless).
- **Arguments are nested:** `search_catalog({"catalog": {"query": ..., "pagination": {"limit": n}}})`, `get_product({"catalog": {"id": gid}})`, `lookup_catalog({"catalog": {"ids": [gid|url|gtin]}})`, `create_cart({"shop": seller.domain, "meta": {"idempotency-key": uuid}, "cart": {"line_items": [{"item": {"id": variant_gid}, "quantity": n}]}})`.
- **Result:** `result.structuredContent` holds the JSON (also mirrored as text in `result.content[0].text`).
- **Money is integer minor units:** `variant.price.amount = 2100` means $21.00 USD.
- **Product shape:** `product.variants[i]` has `id`, `price{amount,currency}`, `list_price`, `availability.available`, `seller{name,domain,url}`, `url`, `checkout_url`.
- **Anonymous `create_cart` works** → safe-swap carts can be real (still never completed).
- **Extra money tool not in the kit:** `create_spend_permission` → treated like `create_spend_request` (always intercepted).
- 22 tools total; full schemas in `backend/fixtures/shop/tools_list.json`.

## Gemini / Decisions API
TODO (Member 2): record the real call shapes here once the resource sheet is out.
