import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, ImageOff, ShieldCheck, Star } from "lucide-react";
import type { SafeCart as SafeCartT, SafeOffer } from "../types";
import { money } from "../lib/format";
import { cx } from "./ui";

interface Choice {
  key: string;
  title: string;
  shop: string | null;
  image: string | null;
  qty: number;
  unit: number | null;
  total: number;
  url: string | null;
  rating: { value: number; count?: number | null } | null;
  best: boolean;
}

/** The prepared cart first (its continue_url is used exactly as returned), then the other offers. */
function choices(cart: SafeCartT): Choice[] {
  const line = cart.line_items?.[0];
  const qty = cart.line_items?.reduce((n, l) => n + (l.quantity ?? 0), 0) ?? line?.quantity ?? 1;
  const first: Choice = {
    key: "prepared",
    title: cart.title ?? line?.title ?? "Verified alternative",
    shop: cart.shop ?? null,
    image: cart.image ?? null,
    qty,
    unit: line?.price ?? null,
    total: cart.total,
    url: cart.continue_url ?? cart.checkout_url ?? null,
    rating: null,
    best: true,
  };
  const rest = (cart.alternatives ?? []).map((o: SafeOffer): Choice => ({
    key: `${o.product_id}:${o.variant_id}`,
    title: o.title ?? "Alternative",
    shop: o.shop_name ?? o.shop ?? null,
    image: o.image ?? null,
    qty,
    unit: o.price ?? null,
    total: o.total,
    url: o.checkout_url ?? (o.shop ? `https://${o.shop}` : null),
    rating: o.rating?.value ? { value: o.rating.value, count: o.rating.count } : null,
    best: false,
  }));
  return [first, ...rest];
}

function ChoiceCard({ c, intercepted }: { c: Choice; intercepted?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <li className="flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-line bg-surface min-[480px]:w-[58%] sm:w-[260px] lg:w-[240px] 2xl:w-[260px]">
      <div className="relative aspect-[4/3] w-full bg-white">
        {c.image && !broken ? (
          <img src={c.image} alt={c.title} className="size-full object-contain p-2" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <div className="flex size-full items-center justify-center text-ink-3"><ImageOff className="size-6" /></div>
        )}
        {c.best && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-safe px-1.5 py-0.5 text-[11px] font-semibold text-white shadow">
            <ShieldCheck className="size-3" /> Best match
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 min-h-[2.6em] text-[14px] leading-snug font-medium text-ink" title={c.title}>{c.title}</p>
        <p className="truncate text-xs text-ink-3">{c.shop ?? "Shopify store"}</p>
        {c.rating && (
          <p className="flex items-center gap-1 text-xs text-ink-2">
            <Star className="size-3 fill-current text-warn" /> {c.rating.value.toFixed(1)}
            {c.rating.count ? <span className="text-ink-3">({c.rating.count})</span> : null}
          </p>
        )}
        <div className="mt-auto flex items-baseline justify-between gap-2 pt-1.5">
          <span className="tnum text-[16px] font-semibold">{money(c.total)}</span>
          {c.qty > 1 && c.unit != null && <span className="tnum text-xs text-ink-3">{c.qty} × {money(c.unit)}</span>}
        </div>
        {c.url && !(c.best && intercepted) ? (
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cx(
              "mt-1.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold transition active:scale-[0.99]",
              c.best ? "btn-brand" : "btn-secondary",
            )}
          >
            Check out <ArrowUpRight className="size-4" />
          </a>
        ) : (
          <p className="mt-1.5 text-center text-xs text-ink-3">Checkout link unavailable right now.</p>
        )}
      </div>
    </li>
  );
}

/** Safe alternatives: a carousel of real Shopify offers within the shopper's budget. Each opens its own store's
 *  secure checkout, where the shopper signs in and pays with their own account. */
export function SafeCart({ cart, className }: { cart: SafeCartT; className?: string }) {
  const list = choices(cart);
  const track = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: list.length <= 1 });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [list.length]);

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className={cx("rounded-xl border border-safe-line bg-safe-soft p-3.5 sm:p-4", className)} aria-label="Safe alternatives">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-safe">
            <ShieldCheck className="size-4" /> {list.length > 1 ? `${list.length} safe alternatives` : "Suggested alternative"}
          </p>
          <p className="text-xs text-ink-2">From Shopify stores, within your budget. Checkout opens on the store’s own secure page, where you pay with your own account.</p>
        </div>
        {list.length > 1 && (
          <div className="hidden items-center gap-1.5 sm:flex">
            <button type="button" onClick={() => page(-1)} disabled={edge.start} aria-label="Previous alternatives" className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition hover:text-ink disabled:opacity-40">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" onClick={() => page(1)} disabled={edge.end} aria-label="More alternatives" className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition hover:text-ink disabled:opacity-40">
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
      <ul ref={track} className="thin-scroll -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-2">
        {list.map((c) => <ChoiceCard key={c.key} c={c} intercepted={cart.intercepted} />)}
      </ul>
    </section>
  );
}
