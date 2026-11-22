import { AlertTriangle, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CatalogProduct } from "../catalog";
import { money } from "../lib/format";
import { reasonLabel, statusTone, trustHeadline, trustLevel } from "../lib/trust";
import type { CheckResult } from "../hooks/useCartChecker";
import { FraudCard } from "./FraudCard";
import { Chip, cx } from "./ui";

/** A small red or amber flag for listing cards. Nothing at all for a listing with no history. */
export function TrustChip({ p, className }: { p: Pick<CatalogProduct, "trust">; className?: string }) {
  const level = trustLevel(p);
  const headline = trustHeadline(p);
  if (level === "ok" || !headline) return null;
  return (
    <Chip tone={level === "flagged" ? "danger" : "warn"} mono={false} className={cx("max-w-full", className)}>
      {level === "flagged" ? <ShieldAlert className="size-3 shrink-0" /> : <AlertTriangle className="size-3 shrink-0" />}
      <span className="truncate">{headline}</span>
    </Chip>
  );
}

/** Trust meter for a merchant, 0 to 100. */
export function TrustMeter({ value, status, className }: { value: number; status: "trusted" | "watch" | "flagged"; className?: string }) {
  const tone = statusTone(status);
  return (
    <span className={cx("flex items-center gap-2", className)}>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className={cx("block h-full rounded-full", tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-safe")} style={{ width: `${Math.max(3, value)}%` }} />
      </span>
      <span className={cx("tnum text-xs font-semibold", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-safe")}>{Math.round(value)}</span>
    </span>
  );
}

/** The full notice on a listing's page: who sells it and what the marketplace has seen. */
export function TrustNotice({ p, className }: { p: CatalogProduct; className?: string }) {
  const t = p.trust;
  if (!t) return null;
  const level = trustLevel(p);
  if (level === "ok") {
    return (
      <p className={cx("flex items-center gap-2 text-[13px] text-ink-2", className)}>
        <ShieldCheck className="size-4 shrink-0 text-safe" />
        Sold by <span className="font-medium text-ink">{p.shopName ?? "this store"}</span>
        <TrustMeter value={t.merchantTrust} status={t.merchantStatus} />
      </p>
    );
  }
  const flagged = level === "flagged";
  return (
    <div role="alert" className={cx("w-full rounded-xl border p-3.5", flagged ? "border-danger-line bg-danger-soft text-danger" : "border-warn-line bg-warn-soft text-warn", className)}>
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        {flagged ? <ShieldAlert className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
        {trustHeadline(p)}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed">
        {t.incidents
          ? `Shoppers and assistants have run into this ${t.productStatus === "clear" ? "seller" : "listing"} ${t.incidents} time${t.incidents === 1 ? "" : "s"}`
          : "This seller’s other listings have been flagged"}
        {t.reasons.length ? `: ${t.reasons.map(reasonLabel).join(", ")}.` : "."} Seller trust{" "}
        <span className="tnum font-semibold">{t.merchantTrust}/100</span>.
      </p>
    </div>
  );
}

/** Why a listing was held, in a dialog: the Fraud Card, the evidence and a safer alternative. */
export function HeldDialog({ product, result, onClose }: { product: CatalogProduct; result: CheckResult; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const s = result.state;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`${product.title} was held`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-bg shadow-float outline-none sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="label">Held by Safe Checkout</p>
            <h2 className="truncate text-[17px] font-semibold tracking-tight">{product.title}</h2>
            <p className="tnum text-sm text-ink-3">{money(product.price, false, product.currency)} · nothing was added to your cart</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </header>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {result.message && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{result.message}</p>}
          <FraudCard card={s.fraudCard} verdict={s.verdict} status={s.guarded.status} attempted={s.guarded.attempted} evidence={s.guarded.evidence} finished={s.guarded.finished} />
        </div>
      </div>
    </div>
  );
}
