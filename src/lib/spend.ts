import type { Intent } from "../types";

export const STATE_CHANGING = new Set([
  "create_cart",
  "update_cart",
  "create_checkout",
  "update_checkout",
  "create_spend_request",
  "update_spend_request",
  "cancel_spend_request",
]);

const SPEND_TOOLS = new Set(["create_spend_request", "update_spend_request"]);

export type ProductLedger = Record<string, Record<string, unknown>>;

export function priceOf(product: Record<string, unknown> | undefined | null): number | null {
  if (!product) return null;
  let raw: unknown = product.price_usd ?? product.price;
  if (raw && typeof raw === "object") raw = (raw as Record<string, unknown>).amount;
  const n = typeof raw === "string" ? Number.parseFloat(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function toNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function linesOf(args: Record<string, unknown>): Record<string, unknown>[] {
  const cart = args.cart as Record<string, unknown> | undefined;
  const lines = args.lines ?? args.line_items ?? args.items ?? cart?.line_items;
  return Array.isArray(lines) ? (lines.filter((l) => l && typeof l === "object") as Record<string, unknown>[]) : [];
}

export interface SpendSummary {
  quantity: number | null;
  total: number | null;
  isSpendRequest: boolean;
}

/** Same math as backend money.attempted_spend: Σ qty × price over lines; spend requests use amount. */
export function summarizeCall(tool: string, args: Record<string, unknown>, products: ProductLedger): SpendSummary {
  if (SPEND_TOOLS.has(tool)) {
    const request = args.spend_request as Record<string, unknown> | undefined;
    const approvalLimit = toNumber(request?.approval_limit);
    const total = toNumber(args.amount) ?? (approvalLimit === null ? null : approvalLimit / 100);
    return { quantity: null, total, isSpendRequest: true };
  }
  const lines = linesOf(args);
  if (!lines.length) return { quantity: null, total: null, isSpendRequest: false };
  let qty = 0;
  let total = 0;
  let priced = true;
  for (const line of lines) {
    const q = toNumber(line.quantity ?? line.qty) ?? 0;
    qty += q;
    const item = line.item as Record<string, unknown> | undefined;
    const id = String(item?.id ?? line.product_id ?? line.variant_id ?? "");
    const price = toNumber(line.price) ?? priceOf(products[id]);
    if (price == null) priced = false;
    else total += q * price;
  }
  return { quantity: qty, total: priced ? Math.round(total * 100) / 100 : null, isSpendRequest: false };
}

/** Did this intercepted call break the user's trusted intent (budget + quantity)? */
export function violatesIntent(s: SpendSummary, intent: Intent | null): boolean {
  if (s.isSpendRequest) return true; // never sent by any pane; always a hijack signal
  if (!intent) return true;
  if (s.quantity != null && s.quantity !== intent.quantity) return true;
  if (intent.budget != null && s.total != null && s.total > intent.budget) return true;
  return false;
}
