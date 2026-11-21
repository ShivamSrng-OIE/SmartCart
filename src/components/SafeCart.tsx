import { ArrowUpRight, ShieldCheck } from "lucide-react";
import type { SafeCart as SafeCartT } from "../types";
import { money } from "../lib/format";
import { cx } from "./ui";

/** The honest swap. continue_url is used exactly as returned (ADR m4/0008): no rewriting, no stripping. */
export function SafeCart({ cart, className }: { cart: SafeCartT; className?: string }) {
  const url = cart.continue_url ?? cart.checkout_url ?? null;
  const line = cart.line_items?.[0];
  const title = cart.title ?? line?.title ?? "Verified alternative";
  const qty = cart.line_items?.reduce((n, l) => n + (l.quantity ?? 0), 0) ?? line?.quantity ?? 1;

  return (
    <div className={cx("rounded-xl border border-safe-line bg-safe-soft p-3.5 sm:p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-safe">
            <ShieldCheck className="size-4" /> Safe swap, ready to approve
          </p>
          <p className="mt-1 truncate text-[15px] font-medium text-ink">{title}</p>
          <p className="truncate text-xs text-ink-2">
            {qty} × {line?.price != null ? money(line.price) : "item"}
            {cart.shop && <span className="text-ink-3"> · {cart.shop}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-xl font-semibold tracking-tight">{money(cart.total)}</div>
          <div className="label mt-0.5">total</div>
        </div>
      </div>

      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-brand mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-[14px] font-semibold transition active:scale-[0.99]"
        >
          Buy the safe one <ArrowUpRight className="size-4" />
        </a>
      ) : (
        <p className="mt-3 text-xs text-ink-3">No checkout link was returned for this cart.</p>
      )}
      <p className="mt-2 text-center text-[11px] text-ink-3">
        {cart.intercepted ? "Anonymous checkout was unavailable, so this cart was only staged." : "Opens the merchant’s own checkout. You finish the purchase; CartTrap never does."}
      </p>
    </div>
  );
}
