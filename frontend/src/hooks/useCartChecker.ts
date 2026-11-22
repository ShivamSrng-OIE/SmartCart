import { useCallback, useEffect, useRef, useState } from "react";
import { runAgent } from "../api";
import type { CatalogProduct } from "../catalog";
import { checkOutcome } from "../lib/cartCheck";
import { applyEvent, initialState, type ArenaState } from "../state";
import type { Cart } from "./useCart";

export type CheckPhase = "checking" | "approved" | "held" | "error";

export interface CheckResult {
  phase: CheckPhase;
  /** the run so far (live) or in full (once finished): verdict, Fraud Card, evidence */
  state: ArenaState;
  message?: string;
}

/**
 * Safe Checkout for the shopper's own cart. Pressing Add on a warehouse listing runs the check right then:
 * the listing's photos, video, audio and description are read as untrusted input and the firewall judges the
 * cart. An approved item goes into the cart; a held one stays out and keeps its explanation for the dialog.
 * Listings from other stores (real Shopify products) need no check and are added directly by the caller.
 */
export function useCartChecker(cart: Cart, onApproved?: (p: CatalogProduct) => void) {
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const stops = useRef(new Map<string, () => void>());
  const approved = useRef(onApproved);
  approved.current = onApproved;

  useEffect(() => () => stops.current.forEach((stop) => stop()), []);

  const check = useCallback(
    (p: CatalogProduct, opts: { quantity?: number; budget?: number | null } = {}) => {
      if (stops.current.has(p.id)) return; // already being checked
      const set = (r: CheckResult) => setResults((all) => ({ ...all, [p.id]: r }));
      let state = initialState(null);
      let heldAlready = false; // a non-approve verdict is final: show it at once while the explanation is still being written
      set({ phase: "checking", state });

      const form = new FormData();
      form.set("product_id", p.id);
      if (p.variantId) form.set("variant_id", p.variantId);
      form.set("quantity", String(opts.quantity ?? 1));
      if (opts.budget != null) form.set("budget", String(opts.budget));

      const finish = (message?: string) => {
        stops.current.delete(p.id);
        const outcome = message ? "held" : checkOutcome(state);
        if (outcome === "approved") {
          cart.add(p, opts.quantity ?? 1);
          approved.current?.(p);
        }
        set({ phase: message ? "error" : outcome, state, message });
      };

      const stop = runAgent("cart", form, {
        onStart: (runId) => {
          state = initialState(null, runId);
        },
        onEvent: (e) => {
          state = applyEvent(state, e);
          if (e.kind === "verdict" && e.pane === "guarded" && e.data.action !== "approve_checkout") heldAlready = true;
          if (e.kind === "done" && (e.pane === "system" || e.pane === "guarded")) finish();
          else set({ phase: heldAlready ? "held" : "checking", state });
        },
        onError: (message) => finish(message),
      });
      stops.current.set(p.id, stop);
    },
    [cart],
  );

  const dismiss = useCallback((id: string) => {
    stops.current.get(id)?.();
    stops.current.delete(id);
    setResults((all) => {
      const { [id]: _gone, ...rest } = all;
      return rest;
    });
  }, []);

  return { results, check, dismiss } as const;
}

export type CartChecker = ReturnType<typeof useCartChecker>;
