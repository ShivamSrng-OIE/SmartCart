/**
 * Product search + detail for "Shop yourself" and the product picker.
 *
 * Source order for every call:
 *   1. team backend route, if it exists (GET /api/catalog/search, GET /api/catalog/products/{id})
 *   2. Shopify Shop MCP directly, through the /shop-mcp proxy (search_catalog / get_product)
 *   (rehearsal only: the bundled catalog when DEMO_MODE is on and nothing else answers)
 */
import sample from "./fixtures/catalog.sample.json";
import { getProductMcp, minorToMajor, searchCatalogMcp, ShopError, type ShopMessage } from "./shop";
import { getCountry } from "./locale";
import { DEMO_MODE, apiUrl, assetUrl } from "./config";

export interface MediaSource {
  url: string;
  mime: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  /** bytes, when Shopify reports it (3D models) */
  size: number | null;
}

/** Product images, video, 3D models, and warehouse audio. */
export interface MediaItem {
  type: "image" | "video" | "external_video" | "model_3d" | "audio";
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  poster: string | null;
  sources: MediaSource[];
  duration: number | null;
}

/** Best playable file for <video>: MP4 everywhere, HLS (.m3u8) only as a fallback for Safari. */
export function videoSources(m: MediaItem): MediaSource[] {
  const list = m.sources.length ? m.sources : [{ url: m.url, mime: null, format: null, width: null, height: null, size: null }];
  const rank = (x: MediaSource) => (/mp4/i.test(x.mime ?? x.format ?? x.url) ? 0 : /m3u8|mpegurl/i.test(x.mime ?? x.format ?? x.url) ? 2 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.height ?? 0) - (b.height ?? 0));
}

/** GLB for the web viewer, USDZ for iOS Quick Look AR. */
export function modelSources(m: MediaItem): { glb: MediaSource | null; usdz: MediaSource | null } {
  const find = (re: RegExp) => m.sources.find((x) => re.test(`${x.format ?? ""} ${x.mime ?? ""} ${x.url}`)) ?? null;
  const glb = find(/glb|gltf/i) ?? (/\.glb($|\?)/i.test(m.url) ? { url: m.url, mime: "model/gltf-binary", format: "glb", width: null, height: null, size: null } : null);
  return { glb, usdz: find(/usdz/i) };
}

export function mediaSummary(media: MediaItem[]): { images: number; videos: number; models: number } {
  return {
    images: media.filter((m) => m.type === "image").length,
    videos: media.filter((m) => m.type === "video" || m.type === "external_video").length,
    models: media.filter((m) => m.type === "model_3d").length,
  };
}

/** One store's offer for this product (get_product returns the same item from several sellers). */
export interface Offer {
  variantId: string;
  title: string | null;
  price: number | null;
  currency: string;
  available: boolean | null;
  url: string | null;
  checkoutUrl: string | null;
  condition: string[];
  rating: { value: number; count: number } | null;
  image: string | null;
  seller: { id: string | null; name: string | null; url: string | null; domain: string | null; links: { type: string; url: string }[] };
  options: { name: string; label: string }[];
}

/** What the marketplace has learned about a warehouse listing and its merchant (from real checks). */
export interface Trust {
  merchantId: string | null;
  merchantTrust: number;
  merchantStatus: "trusted" | "watch" | "flagged";
  productStatus: "clear" | "watch" | "flagged";
  incidents: number;
  reasons: string[];
  /** how far down the results the listing sinks (0 = not at all) */
  penalty: number;
}

export interface CatalogProduct {
  id: string;
  source: "shopify" | "warehouse";
  /** warehouse listings only */
  trust?: Trust | null;
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
  priceMax: number | null;
  media: MediaItem[];
  offers: Offer[];
  features: string[];
  highlights: string[];
  handle: string | null;
  raw: Record<string, unknown>;
}

export type CatalogSource = "live" | "shopify" | "demo";

export interface SearchResult {
  items: CatalogProduct[];
  source: CatalogSource;
  /** set when no source could answer; the UI shows a retry */
  error?: string;
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
  /** Mix in the local warehouse storefronts (default true). */
  includeWarehouse?: boolean;
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
    .replace(/<(script|style|video|audio|iframe|object|noscript|template)[\s\S]*?<\/\1>/gi, " ")
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
  const rangeMax = obj(range.max);

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

  const wh = obj(p.warehouse);
  const isWarehouse = id.startsWith("wh:");
  const trust: Trust | null = isWarehouse
    ? {
        merchantId: str(wh.merchant),
        merchantTrust: num(wh.merchant_trust) ?? 100,
        merchantStatus: (str(wh.merchant_status) as Trust["merchantStatus"]) ?? "trusted",
        productStatus: (str(wh.product_status) as Trust["productStatus"]) ?? "clear",
        incidents: num(wh.incidents) ?? 0,
        reasons: strList(wh.reasons),
        penalty: num(wh.penalty) ?? 0,
      }
    : null;

  return {
    id,
    source: isWarehouse ? "warehouse" : "shopify",
    trust,
    variantId: str(v.id),
    title,
    price,
    currency,
    units: num(p.units ?? p.pack_size),
    vendor: str(p.vendor) ?? str(p.brand),
    shop: str(seller.domain) ?? str(p.shop) ?? str(p.domain),
    shopName: str(seller.name) ?? str(p.shop_name),
    url: str(v.url) ?? str(p.url) ?? str(p.product_url),
    image: assetUrl(str(firstImage?.url) ?? str(obj(firstImage?.preview).url) ?? str(p.image_url) ?? str(obj(p.image).url) ?? str(p.image)),
    description: plainText(str(desc.plain) ?? str(desc.html) ?? str(p.description) ?? str(p.body)),
    type: str(p.product_type) ?? str(p.category),
    available: typeof obj(v.availability).available === "boolean" ? (obj(v.availability).available as boolean) : null,
    rating: num(rating.value) != null ? { value: num(rating.value)!, count: num(rating.count) ?? 0 } : null,
    priceMax: rangeMax.amount != null ? minorToMajor(rangeMax.amount, str(rangeMax.currency) ?? currency) : null,
    media: media.map(toMedia).filter(Boolean) as MediaItem[],
    offers: variants.map((x) => toOffer(x, currency)).filter(Boolean) as Offer[],
    features: strList(obj(p.metadata).top_features),
    highlights: strList(obj(p.metadata).unique_selling_points),
    handle: str(p.handle),
    options: Array.isArray(p.options)
      ? (p.options as Obj[]).map((o) => ({ name: String(o.name ?? ""), values: Array.isArray(o.values) ? (o.values as Obj[]).map((x) => String(x.label ?? x)) : [] })).filter((o) => o.name)
      : [],
    raw: p,
  };
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function toMedia(m: Obj): MediaItem | null {
  const url = assetUrl(str(m.url) ?? str(obj(m.preview).url));
  if (!url) return null;
  const t = String(m.type ?? "image").toLowerCase();
  const type: MediaItem["type"] = t === "audio" ? "audio" : t.includes("external") ? "external_video" : t.includes("model") || t.includes("3d") ? "model_3d" : t.includes("video") ? "video" : "image";
  const sources = Array.isArray(m.sources)
    ? (m.sources as Obj[])
        .map((x) => ({ url: str(x.url) ?? "", mime: str(x.mime_type) ?? str(x.mime), format: str(x.format), width: num(x.width), height: num(x.height), size: num(x.filesize ?? x.size) }))
        .filter((x) => x.url)
    : [];
  return {
    type,
    url,
    alt: str(m.alt_text) ?? str(m.alt),
    width: num(m.width),
    height: num(m.height),
    poster: type === "image" ? null : assetUrl(str(obj(m.preview).url)),
    sources,
    duration: num(m.duration),
  };
}

function toOffer(v: Obj, fallbackCurrency: string): Offer | null {
  const variantId = str(v.id);
  if (!variantId) return null;
  const price = obj(v.price);
  const currency = str(price.currency) ?? fallbackCurrency;
  const seller = obj(v.seller);
  const rating = obj(v.rating);
  const media = Array.isArray(v.media) ? (v.media as Obj[]) : [];
  return {
    variantId,
    title: str(v.title),
    price: price.amount != null ? minorToMajor(price.amount, currency) : null,
    currency,
    available: typeof obj(v.availability).available === "boolean" ? (obj(v.availability).available as boolean) : null,
    url: str(v.url),
    checkoutUrl: str(v.checkout_url),
    condition: strList(v.condition),
    rating: num(rating.value) != null ? { value: num(rating.value)!, count: num(rating.count) ?? 0 } : null,
    image: assetUrl(str(media[0]?.url) ?? str(obj(media[0]?.preview).url)),
    seller: {
      id: str(seller.id),
      name: str(seller.name),
      url: str(seller.url),
      domain: str(seller.domain),
      links: Array.isArray(seller.links) ? (seller.links as Obj[]).map((l) => ({ type: String(l.type ?? "link"), url: String(l.url ?? "") })).filter((l) => l.url) : [],
    },
    options: Array.isArray(v.options) ? (v.options as Obj[]).map((o) => ({ name: String(o.name ?? ""), label: String(o.label ?? "") })) : [],
  };
}

const DEMO: CatalogProduct[] = (sample.products as unknown[]).map(normalizeProduct).filter(Boolean) as CatalogProduct[];
export const demoCatalog = () => DEMO;
export const findDemo = (id: string) => DEMO.find((p) => p.id === id) ?? null;

const WAREHOUSE_ID = /^wh:([a-z0-9][a-z0-9-]*)$/;

/** "wh:hoodie-x" -> "hoodie-x" (the slug the warehouse API uses), or null for any other id. */
export function parseWarehouseId(id: string): string | null {
  return WAREHOUSE_ID.exec(id)?.[1] ?? null;
}

export const isWarehouseId = (id: string) => id.startsWith("wh:");

interface WarehouseResponse {
  products?: unknown[];
  total?: number;
}

/** Our own storefronts, from the backend. Never throws: a store that is down simply has no results. */
async function searchWarehouse(query: string, maxPrice: number | null, limit: number, signal?: AbortSignal): Promise<{ items: CatalogProduct[]; total: number }> {
  if (!query.trim()) return { items: [], total: 0 };
  try {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (maxPrice != null) params.set("max_price", String(maxPrice));
    const r = await fetch(apiUrl(`/api/warehouse/products?${params}`), { signal });
    if (!r.ok) return { items: [], total: 0 };
    const j = (await r.json()) as WarehouseResponse;
    const items = (j.products ?? []).map(normalizeProduct).filter(Boolean) as CatalogProduct[];
    return { items, total: j.total ?? items.length };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { items: [], total: 0 };
  }
}

/**
 * Warehouse listings and Shopify results in one list, so shoppers (and the assistant) meet them together.
 * Position decides the order: the i-th Shopify result sits at i, the j-th warehouse result at 1.6 j plus
 * the penalty the marketplace gives its merchant. A trusted merchant's listings mix in near the top; a
 * flagged merchant's sink below everything.
 */
export function mixResults(real: CatalogProduct[], warehouse: CatalogProduct[]): CatalogProduct[] {
  if (!warehouse.length) return real;
  const scored = [
    ...real.map((p, i) => ({ p, score: i })),
    ...warehouse.map((p, j) => ({ p, score: j * 1.6 + (p.trust?.penalty ?? 0) + 0.5 })),
  ];
  return scored.sort((a, b) => a.score - b.score).map((x) => x.p);
}

/** Listings sold by a merchant the marketplace has learned to distrust, or flagged themselves. */
export const isFlagged = (p: Pick<CatalogProduct, "trust">) => p.trust?.productStatus === "flagged" || p.trust?.merchantStatus === "flagged";
export const isWatched = (p: Pick<CatalogProduct, "trust">) => !isFlagged(p) && (p.trust?.productStatus === "watch" || p.trust?.merchantStatus === "watch");

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

// Short-lived memory cache + in-flight de-duplication: the same search typed twice, or asked
// for by two components at once, costs one request. Nothing is persisted.
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<SearchResult> }>();

// Only the Shopify half is cached: warehouse trust changes whenever a check blocks something, so its
// results are always fetched fresh and merged in.
function cachedShopify(q: string, opts: SearchOptions): Promise<SearchResult> {
  const { maxPrice = null, limit = 12, cursor, network = true } = opts;
  const key = JSON.stringify([q.trim().toLowerCase(), maxPrice, limit, cursor ?? null, network, getCountry().code]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  // The shared request is never tied to one caller's AbortSignal.
  const value = searchUncached(q, { ...opts, signal: undefined });
  cache.set(key, { at: Date.now(), value });
  value.then((r) => (r.source === "demo" || r.error) && cache.delete(key)).catch(() => cache.delete(key));
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  return value;
}

/** Shopify results with our warehouse listings mixed in (see mixResults). Warehouse listings are on by default. */
export function searchCatalog(q: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const { maxPrice = null, limit = 12, cursor, network = true, includeWarehouse = true } = opts;
  const shopify = cachedShopify(q, opts);
  if (!includeWarehouse || !network || cursor) return withAbort(shopify, opts.signal);
  const merged = Promise.all([shopify, searchWarehouse(q, maxPrice, limit, opts.signal)]).then(([result, warehouse]): SearchResult =>
    warehouse.items.length
      ? {
          ...result,
          items: mixResults(result.items, warehouse.items),
          error: undefined, // our own storefronts answered, so this is not a failed search
          total: result.total == null ? undefined : result.total + warehouse.total,
        }
      : result,
  );
  return withAbort(merged, opts.signal);
}

function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Items Shopify itself considers similar to this product (search_catalog `like`). */
export async function similarProducts(id: string, opts: { limit?: number; signal?: AbortSignal; fallbackQuery?: string } = {}): Promise<CatalogProduct[]> {
  try {
    const doc = await searchCatalogMcp({ like: [id], limit: opts.limit ?? 12, signal: opts.signal });
    const items = (doc.products ?? []).map(normalizeProduct).filter(Boolean) as CatalogProduct[];
    if (items.length) return items.filter((p) => p.id !== id);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
  }
  if (!opts.fallbackQuery) return [];
  const r = await searchCatalog(opts.fallbackQuery, { limit: opts.limit ?? 12, signal: opts.signal });
  return r.items.filter((p) => p.id !== id);
}

/** First live Shopify match for a query, or null. Used to give examples a real product. */
export async function firstLiveProduct(q: string, signal?: AbortSignal): Promise<CatalogProduct | null> {
  try {
    const r = await searchCatalog(q, { limit: 4, signal });
    return r.source !== "demo" ? (r.items.find((p) => p.available !== false) ?? r.items[0] ?? null) : null;
  } catch {
    return null;
  }
}

async function searchUncached(q: string, opts: SearchOptions = {}): Promise<SearchResult> {
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

  if (DEMO_MODE) return { items: cursor ? [] : localSearch(q, maxPrice, limit * 2), source: "demo", note: notes[0] };
  return { items: [], source: "shopify", error: notes[0] ?? "Couldn’t reach Shopify right now." };
}

const productCache = new Map<string, { product: CatalogProduct | null; source: CatalogSource }>();

export async function getProduct(id: string, network = true): Promise<{ product: CatalogProduct | null; source: CatalogSource | "warehouse" }> {
  if (isWarehouseId(id)) {
    if (!network) return { product: null, source: "warehouse" };
    try {
      const r = await fetch(apiUrl(`/api/warehouse/products/${encodeURIComponent(id)}`));
      if (!r.ok) return { product: null, source: "warehouse" };
      return { product: normalizeProduct(((await r.json()) as { product?: unknown }).product), source: "warehouse" }; // never cached: trust changes
    } catch {
      return { product: null, source: "warehouse" };
    }
  }
  const demo = DEMO_MODE ? findDemo(id) : null;
  if (demo || !network) return { product: demo, source: "demo" };
  const hit = productCache.get(`${getCountry().code}:${id}`);
  if (hit) return hit;
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
    if (p) {
      const res = { product: p, source: "shopify" as const };
      productCache.set(`${getCountry().code}:${id}`, res);
      if (productCache.size > 40) productCache.delete(productCache.keys().next().value!);
      return res;
    }
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
