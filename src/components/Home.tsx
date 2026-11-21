import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search, Star } from "lucide-react";
import { MODES, MORE, type View } from "./Header";
import { searchCatalog, type CatalogProduct } from "../catalog";
import { money } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";

const WAYS: Record<string, string> = {
  shop: "Search products from independent Shopify stores and check out on each store’s site.",
  unprotected: "Describe what you need, add a photo if you like, and the assistant finds it and builds your cart.",
  protected: "The same assistant, with every order verified before it’s placed.",
};

const POPULAR = "cold brew";

export function HomePage({ onView, onSearch, onOpenProduct }: { onView: (v: View) => void; onSearch: (q: string) => void; onOpenProduct: (p: CatalogProduct) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [popular, setPopular] = useState<CatalogProduct[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    searchCatalog(POPULAR, { limit: 8, signal: ctrl.signal })
      .then((r) => setPopular(r.items.slice(0, 8)))
      .catch(() => setPopular([]));
    return () => ctrl.abort();
  }, []);

  useGSAP(
    () => {
      gsap.from("[data-hero] > *", { y: 14, opacity: 0, stagger: 0.07, duration: d(0.6), ease: "power3.out" });
      gsap.from("[data-way]", { y: 18, opacity: 0, stagger: 0.08, duration: d(0.6), ease: "power3.out", delay: 0.15 });
    },
    { scope: root },
  );
  useGSAP(
    () => {
      if (popular?.length) gsap.from("[data-pop]", { y: 12, opacity: 0, stagger: 0.04, duration: d(0.45), ease: "power2.out" });
    },
    { scope: root, dependencies: [popular?.length ?? 0] },
  );

  return (
    <div ref={root} className="mx-auto flex w-full max-w-6xl flex-col gap-8 py-2 sm:gap-10 sm:py-6">
      {/* hero */}
      <section data-hero className="flex flex-col items-start gap-4">
        <h1 className="max-w-2xl text-[32px] leading-[1.1] font-semibold tracking-[-0.025em] sm:text-[44px]">Shop independent stores, or let the assistant do it</h1>
        <p className="max-w-xl text-[15px] text-ink-2 sm:text-lg">Thousands of Shopify merchants in one search. Tell the assistant what you need and it builds the cart for you.</p>
        <form
          className="relative w-full max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(q.trim());
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for coffee, mugs, water bottles…"
            className="field h-13 rounded-xl! pr-28 pl-12 text-base sm:h-14"
            aria-label="Search products"
            type="search"
            enterKeyHint="search"
          />
          <button type="submit" className="btn-primary absolute top-1/2 right-2 h-9 -translate-y-1/2 rounded-lg px-4 text-[13px] font-semibold sm:h-10">
            Search
          </button>
        </form>
      </section>

      {/* ways to shop */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Ways to shop</h2>
        <div className="grid gap-3 md:grid-cols-3 md:gap-4">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.id} data-way onClick={() => onView(m.id)} className="group card flex flex-col p-5 text-left transition-shadow hover:shadow-[0_0_0_1px_var(--line-strong),0_16px_32px_-20px_rgb(0_0_0/0.35)]">
                <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                  <Icon className="size-5 text-ink-2" />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{m.label}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{WAYS[m.id]}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold">
                  {m.id === "shop" ? "Start browsing" : m.id === "unprotected" ? "Open the assistant" : "Shop with Safe Checkout"}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* popular */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Popular right now</h2>
          <button onClick={() => onSearch(POPULAR)} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
            See all <ArrowRight className="size-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          {popular === null
            ? Array.from({ length: 8 }, (_, i) => <div key={i} className="card aspect-[4/5] animate-pulse" />)
            : popular.map((p) => (
                <button key={p.id} data-pop onClick={() => onOpenProduct(p)} className="card group flex flex-col overflow-hidden text-left">
                  <div className="aspect-square w-full border-b border-line">
                    <ProductThumb product={p} className="rounded-none! shadow-none!" />
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5 p-3">
                    <p className="line-clamp-2 text-[13px] leading-snug font-medium">{p.title}</p>
                    <p className="truncate text-xs text-ink-3">{p.shopName ?? p.vendor}</p>
                    <div className="mt-auto flex items-center justify-between pt-1.5">
                      <span className="tnum text-[14px] font-semibold">{money(p.price, false, p.currency)}</span>
                      {p.rating && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-3">
                          <Star className="size-3 fill-current text-warn" /> {p.rating.value.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
        </div>
      </section>

      {/* more */}
      <section className="flex flex-col gap-2 border-t border-line pt-6">
        <div className="grid gap-2 sm:grid-cols-3">
          {MORE.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.id} onClick={() => onView(m.id)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface">
                <Icon className="size-4 shrink-0 text-ink-3" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{m.label}</span>
                  <span className="block truncate text-xs text-ink-3">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
