const formatters = new Map<string, Intl.NumberFormat>();
function fmt(currency: string, whole: boolean): Intl.NumberFormat {
  const key = `${currency}:${whole}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency, ...(whole ? { maximumFractionDigits: 0 } : {}) });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...(whole ? { maximumFractionDigits: 0 } : {}) });
    }
    formatters.set(key, f);
  }
  return f;
}

export const money = (n: number | null | undefined, whole = false, currency = "USD"): string =>
  n == null || !Number.isFinite(n) ? "—" : fmt(currency || "USD", whole).format(n);

export const pct = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;

export const prob = (p: number | null | undefined): string => (p == null ? "—" : p.toFixed(2));

export const ms = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? "—" : `${Math.round(n)} ms`);

export const secs = (t_ms: number): string => `${(t_ms / 1000).toFixed(2)}s`;

export function clock(msTotal: number): string {
  const m = Math.floor(msTotal / 60000);
  const s = Math.floor((msTotal % 60000) / 1000);
  const cs = Math.floor((msTotal % 1000) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** "hidden_text_instruction" → "Hidden text instruction" */
export function humanize(id: string): string {
  const s = id.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const TOOL_LABEL: Record<string, string> = {
  search_catalog: "Search catalog",
  lookup_catalog: "Look up URL",
  get_product: "Get product",
  create_cart: "Create cart",
  update_cart: "Update cart",
  create_checkout: "Create checkout",
  update_checkout: "Update checkout",
  create_spend_request: "Spend request",
  update_spend_request: "Update spend request",
  cancel_spend_request: "Cancel spend request",
};

export const toolLabel = (name: string) => TOOL_LABEL[name] ?? humanize(name);

export function shortId(id: unknown): string {
  const s = String(id ?? "");
  const tail = s.split("/").pop() ?? s;
  return tail.length > 10 ? `…${tail.slice(-8)}` : tail;
}
