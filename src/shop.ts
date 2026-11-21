/**
 * Minimal Shop MCP client (https://shop.dev/docs/tools.md), called through the dev server's
 * `/shop-mcp` proxy so the browser never talks cross-origin. Read tools are anonymous.
 *
 * Rules we follow from the docs:
 *  - JSON-RPC 2.0 `tools/call`, protocol 2026-07-28, Mcp-Method / Mcp-Name headers matching the body
 *  - prices are integers in minor units of the currency
 *  - product and checkout links are used exactly as returned (never rebuilt, trimmed or logged)
 *  - writes carry a fresh idempotency key; we never call complete_checkout
 *  - `rate_limited` errors carry retry_after seconds
 */

export const SHOP_MCP_PATH = "/shop-mcp";
const PROTOCOL = "2026-07-28";
const CLIENT = { name: "carttrap-arena", version: "0.1.0" };

export class ShopError extends Error {
  code: string;
  retryAfter?: number;
  constructor(message: string, code = "error", retryAfter?: number) {
    super(message);
    this.name = "ShopError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface ShopMessage {
  type?: string;
  code?: string;
  content?: string;
}

let rpcId = 0;

/** Low-level tools/call. Returns `result.structuredContent` (falls back to parsing content[0].text). */
export async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (name === "complete_checkout" || name === "complete_spend_request") throw new ShopError(`${name} is never called from CartTrap`, "forbidden");
  const body = {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL,
        "io.modelcontextprotocol/clientInfo": CLIENT,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
  let r: Response;
  try {
    r = await fetch(SHOP_MCP_PATH, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ShopError("Couldn’t reach Shopify. Check the network connection.", "network");
  }
  if (r.status === 401) throw new ShopError("Shopify asked for sign-in for this tool.", "unauthorized");
  if (r.status === 404 || r.status === 502 || r.status === 504) throw new ShopError("The Shopify proxy isn’t available here.", "no_proxy");
  const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) throw new ShopError(`Shopify returned an unreadable response (${r.status}).`, "bad_response");
  if (json.error) {
    const e = json.error as Record<string, unknown>;
    throw new ShopError(String(e.message ?? "Shopify rejected the request."), String(e.code ?? "protocol"));
  }
  const result = (json.result ?? {}) as Record<string, unknown>;
  if (result.isError) {
    const meta = ((result._meta as Record<string, unknown> | undefined)?.["com.shopify/error"] ?? {}) as Record<string, unknown>;
    const text = Array.isArray(result.content) ? String((result.content[0] as Record<string, unknown>)?.text ?? "") : "";
    const code = String(meta.code ?? "tool_error");
    const retry = typeof meta.retry_after === "number" ? meta.retry_after : undefined;
    throw new ShopError(code === "rate_limited" ? `Shopify is rate-limiting us. Try again in ${retry ?? "a few"} seconds.` : text || "Shopify couldn’t complete that.", code, retry);
  }
  let doc = result.structuredContent as T | undefined;
  if (!doc && Array.isArray(result.content)) {
    try {
      doc = JSON.parse(String((result.content[0] as Record<string, unknown>)?.text ?? "null")) as T;
    } catch {
      /* not JSON */
    }
  }
  if (!doc) throw new ShopError("Shopify returned no data.", "empty");
  const ucp = (doc as Record<string, unknown>).ucp as Record<string, unknown> | undefined;
  if (ucp?.status === "error") {
    const msgs = ((doc as Record<string, unknown>).messages ?? []) as ShopMessage[];
    throw new ShopError(msgs[0]?.content ?? "Shopify reported an error.", msgs[0]?.code ?? "service_error");
  }
  return doc;
}

/** Fraction digits for a currency so minor units convert correctly (USD 2, JPY 0, ...). */
export function minorToMajor(amount: unknown, currency = "USD"): number | null {
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number.parseFloat(amount) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    /* unknown currency code */
  }
  return n / 10 ** digits;
}

export interface SearchParams {
  query: string;
  maxPrice?: number | null;
  currency?: string;
  country?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface SearchDoc {
  products: Record<string, unknown>[];
  messages: ShopMessage[];
  pagination?: { has_next_page?: boolean; total_count?: number; cursor?: string };
}

export function searchCatalogMcp(p: SearchParams): Promise<SearchDoc> {
  const currency = p.currency ?? "USD";
  const catalog: Record<string, unknown> = {
    query: p.query,
    context: { address_country: p.country ?? "US", currency },
    pagination: { limit: Math.min(50, Math.max(1, p.limit ?? 12)), ...(p.cursor ? { cursor: p.cursor } : {}) },
  };
  if (p.maxPrice != null) {
    // filters.price is in minor units of context.currency
    const major = minorToMajor(1, currency) ?? 0.01;
    catalog.filters = { price: { max: Math.round(p.maxPrice / major) } };
  }
  return callTool<SearchDoc>("search_catalog", { catalog }, p.signal);
}

export function getProductMcp(id: string, signal?: AbortSignal, currency = "USD", country = "US") {
  return callTool<{ product?: Record<string, unknown> }>("get_product", { catalog: { id, context: { address_country: country, currency } } }, signal);
}

/** Starts (never completes) a checkout on the merchant; the shopper finishes it at continue_url. */
export function createCheckoutMcp(shop: string, lines: { variantId: string; quantity: number }[]) {
  const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return callTool<{ id?: string; continue_url?: string; status?: string; messages?: ShopMessage[] }>("create_checkout", {
    shop,
    checkout: { line_items: lines.map((l) => ({ item: { id: l.variantId }, quantity: l.quantity })) },
    meta: { "idempotency-key": key },
  });
}
