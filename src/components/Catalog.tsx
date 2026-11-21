import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Loader2, PackageSearch, Search, X } from "lucide-react";
import { demoCatalog, getProduct, isUrl, refFromProduct, searchCatalog, type CatalogProduct, type CatalogSource, type ProductRef } from "../catalog";
import type { Mode } from "../hooks/useBackend";
import { money } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";
import { Button, Chip, Kbd, Segmented, cx } from "./ui";

const SUGGESTIONS = ["cold brew", "sparkling water", "ceramic mug", "flash drive", "granola", "insulated bottle"];
const PRICE_CAPS: { value: string; label: string; cap: number | null }[] = [
  { value: "any", label: "Any price", cap: null },
  { value: "25", label: "≤ $25", cap: 25 },
  { value: "50", label: "≤ $50", cap: 50 },
  { value: "100", label: "≤ $100", cap: 100 },
];
type Sort = "relevance" | "price_asc" | "price_desc";

function unitsLabel(u: number | null) {
  return u && u > 1 ? `${u}-pack` : null;
}

function ProductCard({ p, onOpen }: { p: CatalogProduct; onOpen: () => void }) {
  return (
    <button
      data-card
      onClick={onOpen}
      className="group card flex flex-col overflow-hidden text-left transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_var(--line-strong),0_12px_24px_-16px_rgb(0_0_0/0.35)]"
    >
      <div className="aspect-[4/3] w-full border-b border-line p-0">
        <ProductThumb product={p} className="rounded-none! shadow-none!" />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-3.5">
        <p className="line-clamp-2 text-[14px] leading-snug font-medium text-ink">{p.title}</p>
        <p className="truncate text-xs text-ink-3">{p.shopName ?? p.shop ?? p.vendor ?? "Shopify merchant"}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="tnum text-[15px] font-semibold">{money(p.price)}</span>
          <span className="flex items-center gap-1.5">
            {unitsLabel(p.units) && <Chip className="h-5 px-1.5 text-[10px]">{unitsLabel(p.units)}</Chip>}
            <ArrowRight className="size-4 text-ink-3 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
          </span>
        </div>
      </div>
    </button>
  );
}

function CardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="aspect-[4/3] animate-pulse bg-surface-2" />
      <div className="flex flex-col gap-2 p-3.5">
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        <div className="mt-2 h-4 w-1/4 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  );
}

function DetailPanel({ id, seed, live, onClose, onTest }: { id: string; seed: CatalogProduct | null; live: boolean; onClose: () => void; onTest: (ref: ProductRef) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [product, setProduct] = useState<CatalogProduct | null>(seed);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<CatalogSource>("demo");
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getProduct(id, live).then(({ product: p, source: s }) => {
      if (!alive) return;
      if (p) setProduct(p);
      setSource(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id, live]);

  const close = useCallback(() => {
    const mobile = window.innerWidth < 768;
    gsap.to(scrim.current, { opacity: 0, duration: d(0.2) });
    gsap.to(panel.current, { [mobile ? "yPercent" : "xPercent"]: 100, duration: d(0.28), ease: "power2.in", onComplete: onClose });
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  useGSAP(() => {
    const mobile = window.innerWidth < 768;
    gsap.fromTo(scrim.current, { opacity: 0 }, { opacity: 1, duration: d(0.25) });
    gsap.fromTo(panel.current, { [mobile ? "yPercent" : "xPercent"]: 100 }, { [mobile ? "yPercent" : "xPercent"]: 0, duration: d(0.45), ease: "expo.out" });
  });

  const p = product;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={p?.title ?? "Product"}>
      <div ref={scrim} className="absolute inset-0 bg-black/40" onClick={close} />
      <div
        ref={panel}
        className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl bg-surface shadow-float md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[460px] md:rounded-none md:rounded-l-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" />
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="label">Product</span>
            {loading ? <Loader2 className="size-3.5 animate-spin text-ink-3" /> : <Chip className="h-5 text-[10px]">{source === "live" ? "get_product · live" : "demo catalog"}</Chip>}
          </div>
          <button onClick={close} aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        {p ? (
          <div className="thin-scroll flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="aspect-[16/10] w-full">
              <ProductThumb product={p} size="lg" />
            </div>
            <h2 className="mt-4 text-xl leading-snug font-semibold tracking-tight">{p.title}</h2>
            <p className="mt-0.5 text-sm text-ink-3">{p.shopName ?? p.shop ?? p.vendor}</p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="tnum text-[28px] font-semibold tracking-tight">{money(p.price)}</span>
              {unitsLabel(p.units) && <Chip>{unitsLabel(p.units)}</Chip>}
            </div>
            {p.description && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{p.description}</p>}

            <dl className="mt-5 divide-y divide-line rounded-xl border border-line">
              {[
                ["Units in listing", p.units != null ? String(p.units) : "—"],
                ["Vendor", p.vendor ?? "—"],
                ["Merchant", p.shop ?? "—"],
                ["Type", p.type ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5 text-sm">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="min-w-0 truncate text-right text-ink">{v}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <dt className="shrink-0 text-ink-3">Product ID</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono text-[12px] text-ink">{p.id}</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard?.writeText(p.id);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1400);
                    }}
                    aria-label="Copy product ID"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
                  >
                    {copied ? <Check className="size-3.5 text-safe" /> : <Copy className="size-3.5" />}
                  </button>
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-ink-3">This listing is the truth ledger. The firewall checks every photo, label and voice clip against it.</p>

            <button onClick={() => setShowRaw((s) => !s)} className="mt-4 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
              <ChevronDown className={cx("size-3.5 transition-transform", showRaw && "rotate-180")} /> Raw listing JSON
            </button>
            {showRaw && (
              <pre className="thin-scroll mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
                {JSON.stringify(p.raw, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-3">{loading ? "Loading product…" : "This product couldn't be loaded."}</div>
        )}

        {p && (
          <div className="flex flex-col gap-2 border-t border-line p-4 sm:flex-row sm:px-5">
            <Button variant="primary" size="lg" className="w-full sm:w-auto sm:flex-1" onClick={() => onTest(refFromProduct(p))} trailing={<ArrowRight className="size-4" />}>
              Test in the Arena
            </Button>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-[14px] font-medium">
                View on store <ArrowUpRight className="size-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Catalog({ mode, onTest }: { mode: Mode; onTest: (ref: ProductRef) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [cap, setCap] = useState("any");
  const [sort, setSort] = useState<Sort>("relevance");
  const [items, setItems] = useState<CatalogProduct[]>(demoCatalog());
  const [source, setSource] = useState<CatalogSource>("demo");
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<CatalogProduct | null>(null);
  const live = mode === "live";
  const query = q.trim();
  const urlQuery = isUrl(query);

  // Debounced search; every keystroke cancels the request before it.
  useEffect(() => {
    if (urlQuery) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const capN = PRICE_CAPS.find((c) => c.value === cap)?.cap ?? null;
        const res = query ? await searchCatalog(query, { maxPrice: capN, signal: ctrl.signal, preferLive: live }) : { items: demoCatalog().filter((p) => capN == null || (p.price ?? 0) <= capN), source: "demo" as const, note: undefined };
        setItems(res.items);
        setSource(res.source);
        setNote(res.note);
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, query ? 260 : 0);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [query, cap, live, urlQuery]);

  // "/" focuses search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sorted = useMemo(() => {
    const xs = [...items];
    if (sort === "price_asc") xs.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    if (sort === "price_desc") xs.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    return xs;
  }, [items, sort]);

  useGSAP(
    () => {
      gsap.fromTo("[data-card]", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.4), stagger: 0.03, ease: "power2.out", clearProps: "transform,opacity" });
    },
    { scope: root, dependencies: [sorted.map((p) => p.id).join("|")] },
  );

  return (
    <div ref={root} className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-5">
      {/* search hero */}
      <section className="card p-4 sm:p-6">
        <p className="label mb-1">Shopify catalog</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Find a product to put under test</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2 sm:text-[15px]">Search live Shop listings, check exactly what a merchant sells, then send it to the Arena and try to trick the agent into buying it wrong.</p>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, or paste a shop.dev product URL"
            className="field h-12 rounded-xl! pr-24 pl-11 text-base sm:h-14 sm:text-[17px]"
            aria-label="Search products"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
          />
          <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
            {loading && <Loader2 className="size-4 animate-spin text-ink-3" />}
            {q ? (
              <button onClick={() => setQ("")} aria-label="Clear search" className="inline-flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
                <X className="size-4" />
              </button>
            ) : (
              <span className="hidden sm:inline-flex">
                <Kbd>/</Kbd>
              </span>
            )}
          </div>
        </div>

        <div className="thin-scroll -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setQ(s)}
              className={cx(
                "h-8 shrink-0 rounded-full border px-3 text-[13px] transition-colors",
                query.toLowerCase() === s ? "border-ink bg-ink text-ink-inverse" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* pasted URL */}
      {urlQuery ? (
        <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="text-[15px] font-medium">Test this product URL</p>
            <p className="truncate font-mono text-xs text-ink-3">{query}</p>
            <p className="mt-1 text-xs text-ink-3">The backend looks it up with lookup_catalog before the run. If it can't, injection checks still run.</p>
          </div>
          <Button variant="primary" size="lg" onClick={() => onTest({ url: query, title: query })} trailing={<ArrowRight className="size-4" />}>
            Test in the Arena
          </Button>
        </section>
      ) : (
        <>
          {/* toolbar */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span className="tnum font-medium">{sorted.length}</span>
              <span className="text-ink-3">{query ? `results for “${query}”` : "demo products, matched to the team’s props"}</span>
              <Chip tone={source === "live" ? "safe" : "neutral"} className="h-5 text-[10px]">
                {source === "live" ? "live · search_catalog" : "demo catalog"}
              </Chip>
            </div>
            <div className="flex items-center gap-2">
              <Segmented size="sm" value={cap} onChange={setCap} options={PRICE_CAPS.map((c) => ({ value: c.value, label: c.label }))} className="flex-1 sm:flex-none" />
              <label className="relative">
                <span className="sr-only">Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field h-8 py-0 pr-8 text-[13px]">
                  <option value="relevance">Relevance</option>
                  <option value="price_asc">Price, low to high</option>
                  <option value="price_desc">Price, high to low</option>
                </select>
              </label>
            </div>
          </div>

          {query && source === "demo" && live && note && (
            <p className="-mt-2 text-xs text-ink-3">Live search isn’t connected yet ({note}). Showing matches from the demo catalog.</p>
          )}

          {/* results */}
          {loading && !sorted.length ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : sorted.length ? (
            <div className={cx("grid grid-cols-2 gap-2.5 transition-opacity sm:grid-cols-3 sm:gap-3 lg:grid-cols-4", loading && "opacity-60")}>
              {sorted.map((p) => (
                <ProductCard key={p.id} p={p} onOpen={() => setOpen(p)} />
              ))}
            </div>
          ) : (
            <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
              <PackageSearch className="size-7 text-ink-3" />
              <p className="text-[15px] font-medium">No products match “{query}”</p>
              <p className="max-w-sm text-sm text-ink-3">Try a broader word, lift the price cap, or paste a product URL.</p>
              {cap !== "any" && (
                <Button size="sm" className="mt-2" onClick={() => setCap("any")}>
                  Remove price cap
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {open && <DetailPanel id={open.id} seed={open} live={live} onClose={() => setOpen(null)} onTest={onTest} />}
    </div>
  );
}
