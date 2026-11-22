import type { CatalogProduct } from "../catalog";

/** Plain-language names for the reasons the marketplace records against a listing. */
export const REASON_LABEL: Record<string, string> = {
  agent_instruction: "hidden instructions aimed at AI shoppers",
  injection: "hidden instructions to the assistant",
  spend_hijack: "tries to raise the quantity or budget",
  coercion: "pushes upsells or skips confirmation",
  pack_lie: "pack size doesn’t match the listing",
  split_payload: "instruction split across photo and text",
  privacy: "asks for private details",
  firewall_error: "the check couldn’t finish, so it was held",
};

export const reasonLabel = (r: string) => REASON_LABEL[r] ?? r.replace(/_/g, " ");

export type TrustLevel = "ok" | "watch" | "flagged";

export function trustLevel(p: Pick<CatalogProduct, "trust">): TrustLevel {
  const t = p.trust;
  if (!t) return "ok";
  if (t.productStatus === "flagged" || t.merchantStatus === "flagged") return "flagged";
  if (t.productStatus === "watch" || t.merchantStatus === "watch") return "watch";
  return "ok";
}

export const statusTone = (s: "trusted" | "watch" | "flagged" | "clear") => (s === "flagged" ? "danger" : s === "watch" ? "warn" : "safe") as "danger" | "warn" | "safe";

/** The headline the storefront shows on a flagged or watched listing. */
export function trustHeadline(p: Pick<CatalogProduct, "trust">): string | null {
  const level = trustLevel(p);
  const t = p.trust;
  if (!t || level === "ok") return null;
  if (t.productStatus === "flagged") return "Blocked by Safe Checkout";
  if (level === "flagged") return "Flagged seller";
  return "Under review";
}
