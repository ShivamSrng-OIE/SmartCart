import { useEffect, useState } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import type { CatalogProduct } from "../catalog";
import { checkStages, currentActivity, type ListingFacts, type Stage } from "../lib/progress";
import type { ArenaState } from "../state";
import { cx } from "./ui";

/** What the check will read, taken from the listing itself. */
export function listingFacts(p: CatalogProduct): ListingFacts {
  return {
    photos: p.media.filter((m) => m.type === "image").length,
    hasVideo: p.media.some((m) => m.type === "video"),
    hasAudio: p.media.some((m) => m.type === "audio"),
  };
}

/** Seconds since `active` became true. */
export function useElapsed(active: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return setS(0);
    const t0 = Date.now();
    const id = window.setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return s;
}

function Icon({ status }: { status: Stage["status"] }) {
  if (status === "done") return <Check className="size-3.5" strokeWidth={3} />;
  if (status === "active") return <Loader2 className="size-3.5 animate-spin" />;
  return <Circle className="size-2.5" />;
}

/**
 * The live checklist for an add-to-cart check. Every row reflects an event that has really arrived from the
 * backend; rows still waiting for their result spin, finished rows tick.
 */
export function CheckProgress({ state, product, running, compact = false, className }: { state: ArenaState; product: CatalogProduct; running: boolean; compact?: boolean; className?: string }) {
  const stages = checkStages(state, listingFacts(product));
  const elapsed = useElapsed(running);
  const doneCount = stages.filter((s) => s.status === "done").length;
  const pct = Math.max(6, Math.round((doneCount / Math.max(stages.length, 4)) * 100));
  return (
    <div className={cx("card overflow-hidden", className)} role="status" aria-live="polite" aria-label="Safe Checkout progress">
      <div className="h-1 w-full bg-surface-2" aria-hidden>
        <div className={cx("h-full bg-ink transition-[width] duration-700 ease-out", running && "animate-pulse")} style={{ width: `${pct}%` }} />
      </div>
      <div className={cx("flex flex-col gap-3", compact ? "p-3.5" : "p-4 sm:p-5")}>
        <div className="flex items-baseline justify-between gap-3">
          <p className={cx("font-semibold tracking-tight", compact ? "text-[14px]" : "text-[15px]")}>{running ? "Safe Checkout is checking this listing" : "Safe Checkout is finishing the review"}</p>
          {running && <span className="tnum text-xs text-ink-3">{elapsed}s</span>}
        </div>
        <ol className="flex flex-col gap-2">
          {stages.map((s) => (
            <li key={s.id} className={cx("flex items-center gap-2.5 text-[14px]", s.status === "todo" ? "text-ink-3" : s.status === "active" ? "text-ink" : "text-ink-2")}>
              <span
                className={cx(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                  s.status === "done" ? "bg-safe-soft text-safe" : s.status === "active" ? "bg-surface-2 text-ink" : "text-ink-3",
                )}
                aria-hidden
              >
                <Icon status={s.status} />
              </span>
              <span className={cx(s.status === "active" && "font-medium")}>{s.label}</span>
              <span className="sr-only">{s.status === "done" ? "done" : s.status === "active" ? "in progress" : "waiting"}</span>
            </li>
          ))}
        </ol>
        {running && elapsed >= 8 && <p className="text-[13px] text-ink-3">Free AI models can take up to a minute. Nothing is added to your cart until this finishes.</p>}
      </div>
    </div>
  );
}

/** One short line for a product card: what is happening right now. */
export function CheckActivityLine({ state, product }: { state: ArenaState; product: CatalogProduct }) {
  const elapsed = useElapsed(true);
  return (
    <p className="flex items-center gap-1.5 px-3 pb-3 text-[12px] text-ink-2 sm:px-3.5" role="status" aria-live="polite">
      <Loader2 className="size-3 shrink-0 animate-spin" />
      <span className="truncate">{currentActivity(state, listingFacts(product))}…</span>
      <span className="tnum ml-auto shrink-0 text-ink-3">{elapsed}s</span>
    </p>
  );
}
