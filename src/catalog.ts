/**
 * Product search + detail for "Shop yourself" and the product picker.
 *
 * Source order for every call:
 *   1. team backend route, if it exists (GET /api/catalog/search, GET /api/catalog/products/{id})
 *   2. Shopify Shop MCP directly, through the /shop-mcp proxy (search_catalog / get_product)
 *   3. the bundled demo catalog, clearly labelled
 */
import sample from "./fixtures/catalog.sample.json";
import { getProductMcp, minorToMajor, searchCatalogMcp, ShopError, type ShopMessage } from "./shop";

export interface CatalogProduct {
  id: string;
  /** featured variant: what cart/checkout line items reference */
  variantId: string | null;
  title: string;
  price: number | null;
  currency: string;
  units: number | null;
  vendor: string | null;
  /** seller.domain, the `shop` value for create_checkout */
  shop: string | null;
  shopName: string | null;
  /** product link exactly as Shopify returned it */
  url: string | null;
  image: string | null;
  description: string | null;
  type: string | null;
  available: boolean | null;
  rating: { value: number; count: number } | null;
  options: { name: string; values: string[] }[];
  raw: Record<string, unknown>;
}

export type CatalogSource = "live" | "shopify" | "demo";

export interface SearchResult {
  items: CatalogProduct[];
  source: CatalogSource;
  note?: string;
  messages?: ShopMessage[];
  cursor?: string;
  total?: number;
}

export interface SearchOptions {
  maxPrice?: number | null;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
  /** false skips network sources (offline rehearsal) */
  network?: boolean;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** Merchant descriptions arrive as HTML; we only ever show them as plain text. */
export function plainText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return text || null;
}

/** Accept Shop MCP products, raw search items, or our demo shape. Never throws on a missing field. */
export function normalizeProduct(raw: unknown): CatalogProduct | null {
  const r = obj(raw);
  const p = r.product && typeof r.product === "object" ? obj(r.product) : r;
  const id = str(p.id) ?? str(p.product_id);
  const title = str(p.title) ?? str(p.name);
  if (!id || !title) return null;

  const variants = Array.isArray(p.variants) ? (p.variants as Obj[]) : [];
  const v = variants[0] ?? {};
  const seller = obj(v.seller ?? p.seller);
  const vPrice = obj(v.price);
  const range = obj(p.price_range);
  const rangeMin = obj(range.min);

  // Shop MCP prices are minor units with a currency; our demo data uses major units.
  let currency = str(vPrice.currency) ?? str(rangeMin.currency) ?? str(obj(p.price).currency) ?? str(p.currency) ?? "USD";
  let price: number | null = null;
  if (vPrice.amount != null) price = minorToMajor(vPrice.amount, currency);
  else if (rangeMin.amount != null) price = minorToMajor(rangeMin.amount, currency);
  else price = num(obj(p.price).amount ?? p.price);
  if (!currency) currency = "USD";

  const media = Array.isArray(p.media) ? (p.media as Obj[]) : Array.isArray(p.images) ? (p.images as Obj[]) : [];
  const firstImage = media.find((m) => !m.type || m.type === "image");
  const desc = obj(p.description);
  const rating = obj(p.rating);

  return {
    id,
    variantId: str(v.id),
    title,
    price,
    currency,
    units: num(p.units ?? p.pack_size),
    vendor: str(p.vendor) ?? str(p.brand),
    shop: str(seller.domain) ?? str(p.shop) ?? str(p.domain),
    shopName: str(seller.name) ?? str(p.shop_name),
    url: str(v.url) ?? str(p.url) ?? str(p.product_url),
    image: str(firstImage?.url) ?? str(obj(firstImage?.preview).url) ?? str(p.image_url) ?? str(obj(p.image).url) ?? str(p.image),
    description: plainText(str(desc.plain) ?? str(desc.html) ?? str(p.description) ?? str(p.body)),
    type: str(p.product_type) ?? str(p.category),
    available: typeof obj(v.availability).available === "boolean" ? (obj(v.availability).available as boolean) : null,
    rating: num(rating.value) != null ? { value: num(rating.value)!, count: num(rating.count) ?? 0 } : null,
    options: Array.isArray(p.options)
      ? (p.options as Obj[]).map((o) => ({ name: String(o.name ?? ""), values: Array.isArray(o.values) ? (o.values as Obj[]).map((x) => String(x.label ?? x)) : [] })).filter((o) => o.name)
      : [],
    raw: p,
  };
}

const DEMO: CatalogProduct[] = (sample.products as unknown[]).map(normalizeProduct).filter(Boolean) as CatalogProduct[];
export const demoCatalog = () => DEMO;
export const findDemo = (id: string) => DEMO.find((p) => p.id === id) ?? null;

export function isUrl(q: string): boolean {
  return /^https?:\/\/\S+$/i.test(q.trim()) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(q.trim());
}

/** "cold brew, mug; granola" → ["cold brew", "mug", "granola"]. Commas, semicolons and new lines separate items. */
export function splitQueries(q: string): string[] {
  const seen = new Set<string>();
  return q
    .split(/\s*[,;\n]\s*/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0 && !seen.has(s.toLowerCase()) && (seen.add(s.toLowerCase()), true))
    .slice(0, 6);
}

function localSearch(q: string, maxPrice?: number | null, limit = 24): CatalogProduct[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return DEMO.map((p) => {
    const hay = `${p.title} ${p.vendor ?? ""} ${p.type ?? ""} ${p.description ?? ""} ${p.shopName ?? ""}`.toLowerCase();
    const score = terms.length ? terms.reduce((s, t) => s + (hay.includes(t) ? (p.title.toLowerCase().includes(t) ? 3 : 1) : -10), 0) : 1;
    return { p, score };
  })
    .filter(({ p, score }) => score > 0 && (maxPrice == null || (p.price ?? Infinity) <= maxPrice))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

let backendSearchMissing = false;
let shopifyUnavailable = false;

export async function searchCatalog(q: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const { maxPrice = null, limit = 12, cursor, signal, network = true } = opts;
  const notes: string[] = [];

  if (network && !backendSearchMissing) {
    try {
      const params = new URLSearchParams({ q, limit: String(limit) });
      if (maxPrice != null) params.set("max_price", String(maxPrice));
      if (cursor) params.set("cursor", cursor);
      const r = await fetch(`/api/catalog/search?${params}`, { signal });
      if (r.ok) {
        const j = (await r.json()) as unknown;
        const list = Array.isArray(j) ? j : Array.isArray(obj(j).products) ? (obj(j).products as unknown[]) : [];
        const items = list.map(normalizeProduct).filter(Boolean) as CatalogProduct[];
        return { items, source: "live", cursor: str(obj(obj(j).pagination).cursor) ?? undefined };
      }
      backendSearchMissing = true;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      backendSearchMissing = true;
    }
  }

  if (network && !shopifyUnavailable) {
    try {
      const doc = await searchCatalogMcp({ query: q, maxPrice, limit, cursor, signal });
      const items = (doc.products ?? []).map(normalizeProduct).filter(Boolean) as CatalogProduct[];
      const filtered = maxPrice != null ? items.filter((p) => p.price == null || p.price <= maxPrice) : items;
      return {
        items: filtered,
        source: "shopify",
        messages: (doc.messages ?? []).filter((m) => m.type === "warning"),
        cursor: doc.pagination?.has_next_page ? doc.pagination.cursor : undefined,
        total: doc.pagination?.total_count,
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      if (err instanceof ShopError && (err.code === "no_proxy" || err.code === "network")) shopifyUnavailable = true;
      notes.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { items: cursor ? [] : localSearch(q, maxPrice, limit * 2), source: "demo", note: notes[0] };
}

export async function getProduct(id: string, network = true): Promise<{ product: CatalogProduct | null; source: CatalogSource }> {
  const demo = findDemo(id);
  if (demo || !network) return { product: demo, source: "demo" };
  if (!backendSearchMissing) {
    try {
      const r = await fetch(`/api/catalog/products/${encodeURIComponent(id)}`);
      if (r.ok) {
        const p = normalizeProduct(await r.json());
        if (p) return { product: p, source: "live" };
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const doc = await getProductMcp(id);
    const p = normalizeProduct(doc.product ?? doc);
    if (p) return { product: p, source: "shopify" };
  } catch {
    /* fall through */
  }
  return { product: null, source: "demo" };
}

/** Product the AI shoppers should buy, carried between pages. */
export interface ProductRef {
  id?: string;
  url?: string;
  title: string;
  price?: number | null;
  shop?: string | null;
  image?: string | null;
}

export const refFromProduct = (p: CatalogProduct): ProductRef => ({ id: p.id, url: p.url ?? undefined, title: p.title, price: p.price, shop: p.shopName ?? p.shop, image: p.image });
