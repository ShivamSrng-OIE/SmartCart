import type { ArenaState } from "../state";

export type CheckOutcome = "approved" | "held";

/**
 * Did the check let the item in? Only a finished run whose every verdict approved, with no firewall error
 * and no Fraud Card, counts. Anything else (a block, an error, no verdict at all) keeps the item out of the cart.
 */
export function checkOutcome(state: ArenaState): CheckOutcome {
  const g = state.guarded;
  if (!g.finished || g.status !== "approved" || state.fraudCard) return "held";
  if (!state.verdicts.length || state.verdicts.some((v) => v.action !== "approve_checkout" || v.error)) return "held";
  return "approved";
}
