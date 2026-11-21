import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Loader2, Search, ShieldCheck, Star } from "lucide-react";
import { routeLocally, routeQuery, type Route, type RouteDecision } from "../lib/router";
import { MODES, MORE, type View } from "./Header";
import { BROWSE } from "../config";
import { searchCatalog, type CatalogProduct } from "../catalog";
import { money } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";
import { AutoRail } from "./AutoRail";

const WAYS: Record<string, string> = {
  shop: "Search products from independent Shopify stores and check out on each store’s site.",
  unprotected: "Describe what you need, add a photo if you like, and the assistant finds it and builds your cart.",
  protected: "The same assistant, with every order verified before it’s placed.",
};

const POPULAR = "cold brew";
const GRID = "grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6";

function ProductTile({ p, onOpen }: { p: CatalogProduct; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      data-pop
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="card group flex h-full w-full flex-col overflow-hidden text-left transition-shadow hover:shadow-[0_0_0_1px_var(--line-strong),0_12px_24px_-16px_rgb(0_0_0/0.35)]"
    >
      <div className="aspect-square w-full border-b border-line">
        <ProductThumb product={p} active={hover} className="rounded-none! shadow-none!" sizes="(min-width: 1900px) 16vw, (min-width: 1536px) 19vw, (min-width: 1024px) 24vw, (min-width: 640px) 31vw, 46vw" />
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
  );
}

const ROUTE_LABEL: Record<Route, { label: string; icon: typeof Search }> = {
  shop: { label: "Search Shop", icon: Search },
  assistant: { label: "Ask the assistant", icon: Bot },
  safe: { label: "Assistant with Safe Checkout", icon: ShieldCheck },
};

export function HomePage({
  onView,
  onSearch,
  onOpenProduct,
  onRoute,
}: {
  onView: (v: View) => void;
  onSearch: (q: string) => void;
  onOpenProduct: (p: CatalogProduct) => void;
  onRoute: (d: RouteDecision) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [routing, setRouting] = useState<RouteDecision | "pending" | null>(null);
  const hint = q.trim() ? routeLocally(q) : null;
  const [popular, setPopular] = useState<CatalogProduct[] | null>(null);
  const [categories, setCategories] = useState<{ name: string; items: CatalogProduct[] }[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    searchCatalog(POPULAR, { limit: 12, signal: ctrl.signal })
      .then((r) => setPopular(r.items.slice(0, 12)))
      .catch(() => setPopular([]));
    // Same searches (and limit) as the Shop page's browse rows, so they come from cache there.
    Promise.all(BROWSE.map((name) => searchCatalog(name, { limit: 6, signal: ctrl.signal }).then((r) => ({ name, items: r.items }))))
      .then((xs) => setCategories(xs.filter((x) => x.items.length)))
      .catch(() => setCategories([]));
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
      if (popular?.length) gsap.from("[data-pop], [data-mosaic]", { y: 12, opacity: 0, stagger: 0.03, duration: d(0.45), ease: "power2.out" });
    },
    { scope: root, dependencies: [popular?.length ?? 0] },
  );

  const mosaic = (popular ?? []).filter((p) => p.image).slice(0, 4);

  return (
    <div ref={root} className="flex w-full flex-col gap-8 py-1 sm:gap-10 sm:py-3">
      {/* hero: text + search on the left, live products on the right */}
      <section className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 2xl:gap-16">
        <div data-hero className="flex flex-col items-start gap-4 lg:py-6">
          <h1 className="max-w-3xl text-[32px] leading-[1.08] font-semibold tracking-[-0.025em] sm:text-[44px] 2xl:text-[56px]">Shop independent stores, or let the assistant do it</h1>
          <p className="max-w-xl text-[15px] text-ink-2 sm:text-lg">Thousands of Shopify merchants in one search. Tell the assistant what you need and it builds the cart for you.</p>
          <form
            className="relative w-full max-w-2xl"
            onSubmit={async (e) => {
              e.preventDefault();
              const text = q.trim();
              if (!text || routing === "pending") return;
              setRouting("pending");
              const decision = await routeQuery(text);
              setRouting(decision);
              window.setTimeout(() => onRoute(decision), 450);
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products, or ask: anything nice under $30"
              className="field h-13 rounded-xl! pr-28 pl-12 text-base sm:h-14"
              aria-label="Search products"
              type="search"
              enterKeyHint="search"
            />
            <button type="submit" className="btn-primary absolute top-1/2 right-2 inline-flex h-9 -translate-y-1/2 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold sm:h-10">
              {routing === "pending" ? <Loader2 className="size-4 animate-spin" /> : null}
              Go
            </button>
          </form>
          <p className="flex min-h-5 items-center gap-1.5 text-xs text-ink-3" aria-live="polite">
            {routing && routing !== "pending" ? (
              (() => {
                const R = ROUTE_LABEL[routing.route];
                return (
                  <>
                    <R.icon className="size-3.5 text-ink-2" />
                    Opening <span className="font-medium text-ink-2">{R.label}</span>
                    <span>· {routing.source === "decisions" ? "decided by Gemini Decisions" : "quick match"}</span>
                  </>
                );
              })()
            ) : routing === "pending" ? (
              <>Deciding where this goes…</>
            ) : hint ? (
              (() => {
                const R = ROUTE_LABEL[hint.route];
                return (
                  <>
                    <R.icon className="size-3.5" /> Enter → {R.label}
                  </>
                );
              })()
            ) : (
              <>Type a product to search, or describe what you want bought.</>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {BROWSE.slice(0, 5).map((c) => (
              <button key={c} onClick={() => onSearch(c)} className="h-8 rounded-full border border-line px-3 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden grid-cols-2 gap-3 lg:grid" aria-hidden={!mosaic.length}>
          {(mosaic.length ? mosaic : Array.from({ length: 4 }, () => null)).map((p, i) =>
            p ? (
              <button key={p.id} data-mosaic onClick={() => onOpenProduct(p)} className="card group relative aspect-[4/3] max-h-[300px] w-full overflow-hidden text-left 2xl:max-h-[340px]">
                <ProductThumb product={p} className="rounded-none! shadow-none!" sizes="25vw" priority={i < 2} />
                <span className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-lg bg-surface/90 px-2.5 py-1.5 text-[12px] shadow-card backdrop-blur">
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="tnum shrink-0 font-semibold">{money(p.price, false, p.currency)}</span>
                </span>
              </button>
            ) : (
              <div key={i} className="card aspect-[4/3] max-h-[300px] animate-pulse 2xl:max-h-[340px]" />
            ),
          )}
        </div>
      </section>

      {/* ways to shop */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Ways to shop</h2>
        <div className="grid gap-3 md:grid-cols-3 md:gap-4">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.id} data-way onClick={() => onView(m.id)} className="group card flex items-start gap-4 p-5 text-left transition-shadow hover:shadow-[0_0_0_1px_var(--line-strong),0_16px_32px_-20px_rgb(0_0_0/0.35)]">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                  <Icon className="size-5 text-ink-2" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold tracking-tight">{m.label}</span>
                  <span className="mt-0.5 block text-[14px] leading-relaxed text-ink-2">{WAYS[m.id]}</span>
                  <span className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold">
                    {m.id === "shop" ? "Start browsing" : m.id === "unprotected" ? "Open the assistant" : "Shop with Safe Checkout"}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* categories */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Shop by category</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
          {(categories ?? BROWSE.map((name) => ({ name, items: [] as CatalogProduct[] }))).map((c) => {
            const cover = c.items.find((x) => x.image);
            return (
              <button key={c.name} onClick={() => onSearch(c.name)} className="card group relative aspect-[5/4] overflow-hidden text-left">
                {cover ? <ProductThumb product={cover} fit="cover" className="rounded-none! shadow-none! transition-transform duration-700 group-hover:scale-[1.05]" sizes="(min-width: 1280px) 16vw, 33vw" /> : <div className="size-full animate-pulse bg-surface-2" />}
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 via-black/25 to-transparent p-3 pt-10 text-white">
                  <span className="text-[14px] font-semibold">{c.name}</span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
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
        {popular === null ? (
          <div className={GRID}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card aspect-[4/5] animate-pulse" />
            ))}
          </div>
        ) : (
          <AutoRail label="Popular products" speed={30}>
            {popular.map((p) => (
              <ProductTile key={p.id} p={p} onOpen={() => onOpenProduct(p)} />
            ))}
          </AutoRail>
        )}
      </section>

      {/* more */}
      <section className="grid gap-2 border-t border-line pt-6 sm:grid-cols-3">
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
      </section>
    </div>
  );
}
