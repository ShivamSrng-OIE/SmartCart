/**
 * Product search + detail for the Catalog page and the Arena's product picker.
 *
 * Live routes (proposed to Member 1; thin wrappers over Shop MCP `search_catalog` / `get_product`):
 *   GET /api/catalog/search?q=<text>&max_price=<n>&limit=<n>  → { products: [...] } (raw search_catalog items are fine)
 *   GET /api/catalog/products/<url-encoded id>                 → get_product JSON
 * Until they exist, everything falls back to a bundled demo catalog and says so in the UI.
 */
import sample from "./fixtures/catalog.sample.json";

export interface CatalogProduct {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  units: number | null;
  vendor: string | null;
  shop: string | null;
  shopName: string | null;
  url: string | null;
  image: string | null;
  description: string | null;
  type: string | null;
  raw: Record<string, unknown>;
}

export type CatalogSource = "live" | "demo";

export interface SearchResult {
  items: CatalogProduct[];
  source: CatalogSource;
  /** why we fell back, when we did */
  note?: string;
}

export interface SearchOptions {
  maxPrice?: number | null;
  limit?: number;
  signal?: AbortSignal;
  preferLive?: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  if (v && typeof v === "object") v = (v as Record<string, unknown>).amount;
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** Accept raw Shop MCP shapes as well as our own; never throw on a missing field. */
export function normalizeProduct(raw: unknown): CatalogProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p = (r.product && typeof r.product === "object" ? r.product : r) as Record<string, unknown>;
  const id = str(p.id) ?? str(p.product_id) ?? str(p.gid);
  const title = str(p.title) ?? str(p.name);
  if (!id || !title) return null;
  const seller = (p.seller && typeof p.seller === "object" ? p.seller : {}) as Record<string, unknown>;
  const priceObj = p.price && typeof p.price === "object" ? (p.price as Record<string, unknown>) : null;
  const images = Array.isArray(p.images) ? (p.images as unknown[]) : [];
  const firstImage = images[0] && typeof images[0] === "object" ? str((images[0] as Record<string, unknown>).url) : str(images[0]);
  return {
    id,
    title,
    price: num(p.price ?? p.min_price ?? (p.price_range as Record<string, unknown> | undefined)?.min),
    currency: str(priceObj?.currency) ?? str(p.currency) ?? "USD",
    units: num(p.units ?? p.pack_size ?? p.quantity),
    vendor: str(p.vendor) ?? str(p.brand),
    shop: str(seller.domain) ?? str(p.shop) ?? str(p.domain),
    shopName: str(seller.name) ?? str(p.shop_name),
    url: str(p.url) ?? str(p.product_url) ?? str(p.online_store_url),
    image: str(p.image_url) ?? str((p.image as Record<string, unknown> | undefined)?.url) ?? str(p.image) ?? firstImage,
    description: str(p.description) ?? str(p.body),
    type: str(p.product_type) ?? str(p.category),
    raw: p,
  };
}

const DEMO: CatalogProduct[] = (sample.products as unknown[]).map(normalizeProduct).filter(Boolean) as CatalogProduct[];

export const demoCatalog = () => DEMO;
export const findDemo = (id: string) => DEMO.find((p) => p.id === id) ?? null;

export function isUrl(q: string): boolean {
  return /^https?:\/\/\S+$/i.test(q.trim()) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(q.trim());
}

function localSearch(q: string, maxPrice?: number | null, limit = 24): CatalogProduct[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = DEMO.map((p) => {
    const hay = `${p.title} ${p.vendor ?? ""} ${p.type ?? ""} ${p.description ?? ""} ${p.shopName ?? ""}`.toLowerCase();
    const score = terms.length ? terms.reduce((s, t) => s + (hay.includes(t) ? (p.title.toLowerCase().includes(t) ? 3 : 1) : -10), 0) : 1;
    return { p, score };
  })
    .filter(({ p, score }) => score > 0 && (maxPrice == null || (p.price ?? Infinity) <= maxPrice))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.p);
}

let liveSearchMissing = false;

export async function searchCatalog(q: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const { maxPrice = null, limit = 24, signal, preferLive = true } = opts;
  if (preferLive && !liveSearchMissing) {
    try {
      const params = new URLSearchParams({ q, limit: String(limit) });
      if (maxPrice != null) params.set("max_price", String(maxPrice));
      const r = await fetch(`/api/catalog/search?${params}`, { signal });
      if (r.status === 404 || r.status === 405) {
        liveSearchMissing = true;
        throw new Error("search route not available yet");
      }
      if (!r.ok) throw new Error(`search failed (${r.status})`);
      const j = (await r.json()) as unknown;
      const list = Array.isArray(j) ? j : Array.isArray((j as Record<string, unknown>)?.products) ? ((j as Record<string, unknown>).products as unknown[]) : [];
      const items = list.map(normalizeProduct).filter(Boolean) as CatalogProduct[];
      return { items: maxPrice != null ? items.filter((p) => p.price == null || p.price <= maxPrice) : items, source: "live" };
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      return { items: localSearch(q, maxPrice, limit), source: "demo", note: (err as Error).message };
    }
  }
  return { items: localSearch(q, maxPrice, limit), source: "demo", note: preferLive ? "search route not available yet" : "replay mode" };
}

export async function getProduct(id: string, preferLive = true): Promise<{ product: CatalogProduct | null; source: CatalogSource }> {
  if (preferLive) {
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
  return { product: findDemo(id), source: "demo" };
}

/** Product the arena should test, carried between pages. */
export interface ProductRef {
  id?: string;
  url?: string;
  title: string;
  price?: number | null;
  shop?: string | null;
}

export const refFromProduct = (p: CatalogProduct): ProductRef => ({ id: p.id, title: p.title, price: p.price, shop: p.shopName ?? p.shop });
