/** Client for the warehouse marketplace API: merchant sign-in and portal, trust, and model settings. */
import { apiUrl, assetUrl } from "../config";

const TOKEN_KEY = "tote.merchant.token";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const token = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(v: string) {
    try {
      localStorage.setItem(TOKEN_KEY, v);
    } catch {
      /* private mode: the session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  const t = token.get();
  if (auth && t) headers.set("Authorization", `Bearer ${t}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let r: Response;
  try {
    r = await fetch(apiUrl(path), { ...init, headers });
  } catch {
    throw new ApiError("Couldn’t reach the server. Check that the backend is running.", 0);
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : Array.isArray(body?.detail) ? "Please check the highlighted fields." : `Request failed (${r.status})`;
    if (r.status === 401 && auth && t) token.clear(); // an expired or invalid sign-in
    throw new ApiError(detail, r.status);
  }
  return (await r.json()) as T;
}

/* --------------------------------------------------------------- merchants */

export interface Store {
  id: string;
  name: string;
  tagline?: string | null;
  location?: string | null;
  since?: number | null;
}

export interface MerchantStats {
  merchant: string;
  trust: number;
  status: "trusted" | "watch" | "flagged";
  incidents: number;
  flagged_products: number;
  products_with_incidents: number;
  clean_checks: number;
  last_incident: number | null;
  /** with the seller's own session view (portal): stars before and after, and listings reported to Shopify */
  rating?: number | null;
  original_rating?: number | null;
  rating_drop?: number;
  ratings_lowered?: number;
  reports?: number;
}

export interface Session {
  username: string;
  role: "admin" | "merchant";
  merchant: Store | null;
  stats: MerchantStats | null;
  listings: number;
  stores: { id: string; name: string }[] | null;
}

export interface ScanQuote {
  quote: string;
  source: string;
  rule: string;
  category: string;
}

export interface Review {
  flagged: boolean;
  severity: number;
  categories: string[];
  quotes: ScanQuote[];
  advice: string;
  deep?: { instructions_detected?: boolean; visible_text?: string[]; notes?: string } | null;
}

export interface Listing {
  slug: string;
  id: string;
  title: string;
  category: string | null;
  merchant: string | null;
  price_cents: number;
  product_type: string | null;
  origin: "seed" | "portal";
  photos: string[];
  has_video: boolean;
  has_audio: boolean;
  options: { name?: string; values?: { label: string; price_delta: number }[] };
  description: string;
  status: "clear" | "watch" | "flagged";
  incidents: number;
  review: Review;
  /** the stars shoppers see now, and before this session's incidents */
  rating?: { original: number; now: number; count: number } | null;
  /** what shoppers' checks found: the report to Shopify and the evidence (boxed photo crops, the words) */
  flags?: { report_id: string | null; images: string[]; quotes: string[]; last_incident: number | null };
  reasons?: string[];
}

export const login = (username: string, password: string) =>
  request<{ token: string; role: "admin" | "merchant"; username: string; merchant: Store | null }>("/api/merchant/login", { method: "POST", body: JSON.stringify({ username, password }) }, false);

export const getSession = () => request<Session>("/api/merchant/me");
export const getListings = (merchant?: string) => request<{ listings: Listing[]; total: number }>(`/api/merchant/listings${merchant ? `?merchant=${encodeURIComponent(merchant)}` : ""}`);
export const createListing = (form: FormData) => request<{ listing: Listing }>("/api/merchant/listings", { method: "POST", body: form });
export const updateListing = (slug: string, form: FormData) => request<{ listing: Listing }>(`/api/merchant/listings/${encodeURIComponent(slug)}`, { method: "PUT", body: form });
export const deleteListing = (slug: string) => request<{ deleted: string }>(`/api/merchant/listings/${encodeURIComponent(slug)}`, { method: "DELETE" });
export const deletePhoto = (slug: string, name: string) => request<{ listing: Listing }>(`/api/merchant/listings/${encodeURIComponent(slug)}/photos/${encodeURIComponent(name)}`, { method: "DELETE" });
export const reviewListing = (slug: string, deep = false) => request<Review>(`/api/merchant/listings/${encodeURIComponent(slug)}/review?deep=${deep ? 1 : 0}`, { method: "POST" });
export const getStores = async () => (await request<{ merchants: (Store & { listings: number; trust: number; status: MerchantStats["status"] })[] }>("/api/warehouse/merchants", {}, false)).merchants;
export const getCategories = async () => (await request<{ categories: { id: string; type: string | null; count: number }[] }>("/api/warehouse/categories", {}, false)).categories;

/** A photo path from the API as a loadable URL. */
export const photoUrl = (u: string) => assetUrl(u) ?? u;

/* ------------------------------------------------------------------- trust */

export interface Incident {
  id: string;
  ts: number;
  product_id: string;
  merchant: string;
  title: string;
  source: "agent" | "cart" | "portal";
  severity: "block" | "escalate" | "scan";
  reasons: string[];
  quotes: string[];
  query: string | null;
  category: string | null;
  amount: number;
}

export interface Insight {
  kind: string;
  severity: "high" | "medium";
  title: string;
  detail: string;
}

/** A blocked listing as it is reported to Shopify's merchant-trust team (simulated: the demo sends nothing). */
export interface ShopifyReport {
  id: string;
  product_id: string;
  title: string;
  merchant: string;
  merchant_name: string;
  filed_at: number;
  updated_at: number;
  incidents: number;
  reasons: string[];
  evidence: string[];
  to: string;
  simulated: boolean;
}

export interface MerchantRatings {
  /** average stars over the seller's rated listings, now and before this session's incidents */
  rating: number | null;
  original_rating: number | null;
  rating_drop: number;
  /** listings whose stars were lowered */
  ratings_lowered: number;
}

export interface TrustOverview {
  merchants: (MerchantStats & MerchantRatings & { id: string; name: string; tagline?: string; location?: string; since?: number; listings: number })[];
  incidents: Incident[];
  reports: ShopifyReport[];
  /** the numbers are this browser session's own (each visit starts from the original ratings) */
  session: boolean;
  totals: {
    incidents: number;
    blocked: number;
    protected_usd: number;
    by_source: Record<string, number>;
    flagged_merchants: number;
    flagged_products: number;
    ratings_lowered: number;
    merchants_lowered: number;
    reports: number;
  };
  analysis: {
    insights: Insight[];
    actions: { action: "demote" | "warn"; merchant?: string; product?: string; reason: string }[];
    tricks: { tag: string; label: string; count: number }[];
  };
}

export const getTrust = () => request<TrustOverview>("/api/trust", {}, false);
export const getBriefing = () => request<{ summary: string; model: string | null; source: "model" | "rules" }>("/api/trust/briefing", { method: "POST" }, false);
export const resetTrust = () => request<{ reset: boolean }>("/api/trust/reset", { method: "POST" });

/* ---------------------------------------------------------------- settings */

export interface LlmRole {
  id: string;
  name: string;
  label: string;
  needs: string[];
  /** the models for this job on each provider, best first (OpenRouter: free ones only, the rest are backups) */
  models: Record<string, string[]>;
}

export interface LlmSettings {
  provider: "gemini" | "openrouter";
  /** the provider running the jobs right now: Gemini while every free OpenRouter model is rate limited */
  active?: "gemini" | "openrouter";
  providers: string[];
  roles: LlmRole[];
  keys: Record<string, boolean>;
}

export const getLlmSettings = () => request<LlmSettings>("/api/settings/llm", {}, false);
export const putLlmSettings = (provider: string) => request<LlmSettings>("/api/settings/llm", { method: "PUT", body: JSON.stringify({ provider }) });
export const putLlmKey = (provider: string, key: string, persist: boolean) => request<LlmSettings>("/api/settings/llm/key", { method: "POST", body: JSON.stringify({ provider, key, persist }) });
export const testRole = (role: string) => request<{ ok: boolean; model: string; provider: string; ms: number; reply?: string; error?: string }>("/api/settings/llm/test", { method: "POST", body: JSON.stringify({ role }) });
