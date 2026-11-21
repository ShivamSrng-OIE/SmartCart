import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Loader2, Plus, ShieldCheck, Star, Store } from "lucide-react";
import { getProduct, refFromProduct, similarProducts, type CatalogProduct, type MediaItem, type Offer, type ProductRef } from "../catalog";
import type { Cart } from "../hooks/useCart";
import { money } from "../lib/format";
import { sized, srcSet } from "../lib/img";
import { flyToCart, gsap, useGSAP, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";
import { Button, Chip, cx } from "./ui";

/* ------------------------------------------------------------- helpers */

function Stars({ value, count, size = "sm" }: { value: number; count?: number; size?: "sm" | "md" }) {
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Rated ${value.toFixed(1)} out of 5${count ? ` from ${count} reviews` : ""}`}>
      <span className="inline-flex">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={cx(size === "md" ? "size-4" : "size-3.5", i < full ? "fill-current text-warn" : "text-line-strong")} />
        ))}
      </span>
      <span className={cx("tnum text-ink-2", size === "md" ? "text-sm" : "text-xs")}>
        {value.toFixed(1)}
        {count != null && <span className="text-ink-3"> · {count.toLocaleString()} reviews</span>}
      </span>
    </span>
  );
}

/** Words that describe the item, minus pack/size noise, for a "similar products" search. */
function similarQuery(title: string): string {
  return title
    .replace(/["“”'’()[\]]/g, " ")
    .replace(/\b\d+(\.\d+)?\s?(oz|ml|l|g|kg|lb|pack|ct|count|gb|tb)\b/gi, " ")
    .replace(/\s[-–|]\s.*$/, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join(" ");
}

function offerAsProduct(p: CatalogProduct, o: Offer): CatalogProduct {
  return { ...p, id: o.variantId, variantId: o.variantId, price: o.price, currency: o.currency, shop: o.seller.domain, shopName: o.seller.name, url: o.url, image: o.image ?? p.image, available: o.available };
}

/* --------------------------------------------------------------- gallery */

function Gallery({ media, title, fallback }: { media: MediaItem[]; title: string; fallback: CatalogProduct }) {
  const [i, setI] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const items = media.length ? media : [];
  const cur = items[Math.min(i, items.length - 1)];

  const go = (n: number) => {
    if (!items.length) return;
    setI((n + items.length) % items.length);
    gsap.fromTo(mainRef.current, { opacity: 0.4 }, { opacity: 1, duration: d(0.3), ease: "power2.out" });
  };

  if (!cur) {
    return (
      <div className="card aspect-square">
        <ProductThumb product={fallback} size="lg" priority />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="card relative aspect-square overflow-hidden bg-surface"
        tabIndex={0}
        aria-roledescription="carousel"
        aria-label={`${title}, media ${i + 1} of ${items.length}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(i + 1);
          if (e.key === "ArrowLeft") go(i - 1);
        }}
      >
        <div ref={mainRef} className="absolute inset-0">
          {cur.type === "video" ? (
            <video src={cur.url} poster={cur.poster ?? undefined} controls playsInline preload="metadata" className="size-full bg-black object-contain" />
          ) : cur.type === "image" ? (
            <img
              src={sized(cur.url, 1000)}
              srcSet={srcSet(cur.url, [400, 700, 1000, 1400])}
              sizes="(min-width: 1024px) 50vw, 100vw"
              alt={cur.alt ?? title}
              fetchPriority={i === 0 ? "high" : "auto"}
              decoding="async"
              referrerPolicy="no-referrer"
              className="size-full object-contain"
            />
          ) : (
            <a href={cur.url} target="_blank" rel="noopener noreferrer" className="flex size-full items-center justify-center gap-2 text-sm text-ink-2 hover:text-ink">
              View 3D / external media <ExternalLink className="size-4" />
            </a>
          )}
        </div>
        {items.length > 1 && (
          <>
            <button onClick={() => go(i - 1)} aria-label="Previous" className="btn-secondary absolute top-1/2 left-3 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full">
              <ChevronLeft className="size-4" />
            </button>
            <button onClick={() => go(i + 1)} aria-label="Next" className="btn-secondary absolute top-1/2 right-3 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full">
              <ChevronRight className="size-4" />
            </button>
            <span className="tnum absolute right-3 bottom-3 rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white">
              {i + 1} / {items.length}
            </span>
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="thin-scroll flex gap-2 overflow-x-auto pb-1">
          {items.map((m, k) => (
            <button
              key={m.url + k}
              onClick={() => go(k)}
              aria-label={`Show media ${k + 1}`}
              aria-current={k === i}
              className={cx("relative size-16 shrink-0 overflow-hidden rounded-lg bg-surface shadow-[inset_0_0_0_1px_var(--line)] transition-shadow sm:size-[72px]", k === i && "shadow-[inset_0_0_0_2px_var(--ink)]")}
            >
              {m.type === "image" || m.poster ? (
                <img src={sized(m.type === "image" ? m.url : m.poster, 160)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center text-[10px] text-ink-3 uppercase">{m.type}</span>
              )}
              {m.type === "video" && <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[9px] text-white">video</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- price chart */

interface Dot {
  key: string;
  label: string;
  sub: string;
  price: number;
  self: boolean;
}

/**
 * Where this product's store prices sit among similar listings, right now.
 * Shop MCP has no price history, so this is a snapshot comparison, not a trend.
 */
function PriceChart({ dots, currency }: { dots: Dot[]; currency: string }) {
  const [hover, setHover] = useState<Dot | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const prices = dots.map((x) => x.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = (hi - lo) * 0.08 || Math.max(1, hi * 0.1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const x = (v: number) => ((v - min) / (max - min || 1)) * 100;
  const ticks = useMemo(() => {
    const step = niceStep((max - min) / 4);
    const out: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }, [min, max]);
  const similar = dots.filter((x) => !x.self).map((x) => x.price).sort((a, b) => a - b);
  const median = similar.length ? similar[Math.floor(similar.length / 2)] : null;

  useGSAP(
    () => {
      gsap.from("[data-dot]", { scale: 0, duration: d(0.4), stagger: 0.02, ease: "back.out(2)" });
    },
    { scope: root, dependencies: [dots.length] },
  );

  const lane = (self: boolean) => (
    <div className="relative h-9">
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      {dots
        .filter((x) => x.self === self)
        .map((dot) => (
          <button
            key={dot.key}
            data-dot
            onMouseEnter={() => setHover(dot)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(dot)}
            onBlur={() => setHover(null)}
            aria-label={`${dot.label}: ${money(dot.price, false, currency)}`}
            className="group absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${x(dot.price)}%` }}
          >
            <span
              className={cx(
                "block size-2.5 rounded-full ring-2 ring-surface transition-transform group-hover:scale-150 group-focus-visible:scale-150",
                self ? "bg-ink" : "border-[1.5px] border-ink-3 bg-surface",
              )}
            />
          </button>
        ))}
    </div>
  );

  return (
    <div ref={root} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-ink" /> This item, by store
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-[1.5px] border-ink-3" /> Similar items
        </span>
        {median != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-px bg-ink-3" /> Typical similar price
          </span>
        )}
      </div>

      <div className="relative">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[110px_minmax(0,1fr)]">
          <span className="text-xs text-ink-2">This item</span>
          {lane(true)}
          <span className="text-xs text-ink-2">Similar</span>
          <div className="relative">
            {median != null && <div className="absolute -top-9 bottom-0 w-px bg-ink-3/60" style={{ left: `${x(median)}%` }} />}
            {lane(false)}
          </div>
          <span />
          <div className="relative mt-1 h-4">
            {ticks.map((t) => (
              <span key={t} className="tnum absolute -translate-x-1/2 text-[11px] text-ink-3" style={{ left: `${x(t)}%` }}>
                {money(t, t >= 100, currency)}
              </span>
            ))}
          </div>
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-ink-inverse shadow-float"
            style={{ left: `calc(${(window.innerWidth < 640 ? 88 : 110) + 12}px + (100% - ${(window.innerWidth < 640 ? 88 : 110) + 12}px) * ${x(hover.price) / 100})` }}
          >
            <span className="font-semibold">{money(hover.price, false, currency)}</span> · {hover.label}
            <span className="block opacity-70">{hover.sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

function SimilarTile({ s, onOpen }: { s: CatalogProduct; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="card group flex flex-col overflow-hidden text-left">
      <div className="aspect-square w-full border-b border-line">
        <ProductThumb product={s} active={hover} className="rounded-none! shadow-none!" />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <p className="line-clamp-2 text-[13px] leading-snug font-medium">{s.title}</p>
        <p className="truncate text-xs text-ink-3">{s.shopName ?? s.vendor}</p>
        <p className="tnum mt-auto pt-1.5 text-[14px] font-semibold">{money(s.price, false, s.currency)}</p>
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------- page */

export function ProductPage({
  id,
  seed,
  cart,
  onBack,
  onOpen,
  onAskAssistant,
}: {
  id: string;
  seed?: CatalogProduct | null;
  cart: Cart;
  onBack: () => void;
  onOpen: (p: CatalogProduct) => void;
  onAskAssistant: (ref: ProductRef) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [product, setProduct] = useState<CatalogProduct | null>(seed ?? null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("");
  const [similar, setSimilar] = useState<CatalogProduct[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSimilar(null);
    getProduct(id).then(({ product: p, source: s }) => {
      if (!alive) return;
      if (p) setProduct(p);
      setSource(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!product) return;
    const ctrl = new AbortController();
    const fallbackQuery = [product.type, similarQuery(product.title)].filter(Boolean).join(" ") || product.title;
    similarProducts(product.id, { limit: 16, signal: ctrl.signal, fallbackQuery })
      .then((items) => setSimilar(items.slice(0, 12)))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [product?.id, product?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useGSAP(
    () => {
      gsap.from("[data-sec]", { y: 14, opacity: 0, stagger: 0.06, duration: d(0.5), ease: "power3.out" });
    },
    { scope: root, dependencies: [product?.id] },
  );

  if (!product) {
    return (
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="card flex min-h-[320px] items-center justify-center text-sm text-ink-3">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading product…
            </span>
          ) : (
            "This product couldn’t be loaded."
          )}
        </div>
      </div>
    );
  }

  const p = product;
  const offers = [...p.offers].sort((a, b) => (a.available === false ? 1 : 0) - (b.available === false ? 1 : 0) || (a.price ?? Infinity) - (b.price ?? Infinity));
  const best = offers.find((o) => o.available !== false) ?? offers[0] ?? null;
  const prices = offers.map((o) => o.price).filter((x): x is number => x != null);
  const lo = prices.length ? Math.min(...prices) : p.price;
  const hi = prices.length ? Math.max(...prices) : (p.priceMax ?? p.price);
  const stores = new Set(offers.map((o) => o.seller.domain ?? o.seller.name)).size;
  const currency = best?.currency ?? p.currency;

  const dots: Dot[] = [
    ...offers.filter((o) => o.price != null).map((o) => ({ key: o.variantId, label: o.seller.name ?? "Store", sub: o.available === false ? "sold out" : (o.condition[0] ?? "available"), price: o.price!, self: true })),
    ...(similar ?? []).filter((s) => s.price != null && s.currency === currency).map((s) => ({ key: s.id, label: s.title.length > 40 ? `${s.title.slice(0, 40)}…` : s.title, sub: s.shopName ?? "", price: s.price!, self: false })),
  ];
  if (!offers.length && p.price != null) dots.push({ key: p.id, label: p.shopName ?? "Store", sub: "", price: p.price, self: true });

  const simPrices = (similar ?? []).map((s) => s.price).filter((x): x is number => x != null).sort((a, b) => a - b);
  const typical = simPrices.length ? simPrices[Math.floor(simPrices.length / 2)] : null;

  const addOffer = (o: Offer | null, from?: Element | null) => {
    cart.add(o ? offerAsProduct(p, o) : p);
    flyToCart(from ?? galleryRef.current);
    setAdded(o?.variantId ?? p.id);
    window.setTimeout(() => setAdded(null), 1400);
  };

  return (
    <div ref={root} className="mx-auto flex w-full max-w-[1800px] flex-col gap-6 sm:gap-8">
      {/* breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-ink-3" aria-label="Breadcrumb">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Back
        </button>
        <span>/</span>
        <span className="truncate">{p.title}</span>
        {loading && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      </nav>

      {/* hero */}
      <section data-sec className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10 2xl:gap-14">
        <div ref={galleryRef}>
          <Gallery media={p.media} title={p.title} fallback={p} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <p className="text-sm text-ink-3">{p.vendor ?? best?.seller.name ?? p.shopName}</p>
            <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight sm:text-[32px]">{p.title}</h1>
            {p.rating && (
              <div className="mt-2">
                <Stars value={p.rating.value} count={p.rating.count} size="md" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tnum text-[28px] font-semibold tracking-tight">
              {lo != null && hi != null && hi - lo > 0.009 ? `${money(lo, false, currency)} – ${money(hi, false, currency)}` : money(lo, false, currency)}
            </span>
            {stores > 1 && <span className="text-sm text-ink-2">from {stores} stores</span>}
            {best?.available === false && <Chip tone="danger">Sold out</Chip>}
          </div>

          {p.highlights.length > 0 && <p className="text-[15px] leading-relaxed text-ink-2">{p.highlights[0]}</p>}

          {p.options.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {p.options.map((o) => (
                <div key={o.name}>
                  <p className="text-[13px] font-medium">{o.name}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {o.values.map((v) => (
                      <span key={v} className="rounded-lg border border-line-strong px-2.5 py-1 text-[13px] text-ink-2">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* best offer */}
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label">{offers.length > 1 ? "Best price" : "Sold by"}</p>
                <p className="mt-1 truncate text-[15px] font-medium">{best?.seller.name ?? p.shopName ?? "Shopify store"}</p>
                <p className="text-xs text-ink-3">
                  {best?.condition.length ? best.condition.join(", ") : "new"}
                  {best?.available === false ? " · sold out" : " · in stock"}
                </p>
              </div>
              <span className="tnum text-xl font-semibold">{money(best?.price ?? p.price, false, currency)}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" size="lg" className="flex-1" disabled={best?.available === false} onClick={() => addOffer(best)} icon={added === (best?.variantId ?? p.id) ? <Check className="size-4" /> : <Plus className="size-4" />}>
                {added === (best?.variantId ?? p.id) ? "Added" : "Add to cart"}
              </Button>
              {(best?.checkoutUrl ?? best?.url ?? p.url) && (
                <a
                  href={(best?.checkoutUrl ?? best?.url ?? p.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-[14px] font-medium"
                >
                  Buy at store <ArrowUpRight className="size-4" />
                </a>
              )}
            </div>
            <Button variant="ghost" onClick={() => onAskAssistant(refFromProduct(best ? offerAsProduct(p, best) : p))} icon={<Bot className="size-4" />}>
              Have the assistant buy this
            </Button>
          </div>
        </div>
      </section>

      {/* about */}
      {(p.description || p.features.length > 0) && (
        <section data-sec className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {p.description && (
            <div className="card p-5 sm:p-6">
              <h2 className="text-[17px] font-semibold tracking-tight">About this item</h2>
              <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{p.description}</p>
            </div>
          )}
          {p.features.length > 0 && (
            <div className="card p-5 sm:p-6">
              <h2 className="text-[17px] font-semibold tracking-tight">Features</h2>
              <ul className="mt-3 flex flex-col gap-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                    <Check className="mt-1 size-3.5 shrink-0 text-safe" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* prices */}
      <section data-sec className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold tracking-tight">Compare prices</h2>
          <span className="text-xs text-ink-3">Live prices right now · Shopify doesn’t share price history</span>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {best?.price != null && typical != null ? (
            best.price <= typical ? (
              <>
                The best price here is <span className="font-medium text-ink">{money(typical - best.price, false, currency)} below</span> a typical similar item ({money(typical, false, currency)}).
              </>
            ) : (
              <>
                The best price here is <span className="font-medium text-ink">{money(best.price - typical, false, currency)} above</span> a typical similar item ({money(typical, false, currency)}).
              </>
            )
          ) : similar === null ? (
            "Looking up similar items…"
          ) : (
            "Prices from each store selling this item."
          )}
        </p>
        {dots.length > 0 && (
          <div className="mt-6">
            <PriceChart dots={dots} currency={currency} />
          </div>
        )}

        {offers.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Stores selling {p.title}</caption>
              <thead>
                <tr className="border-b border-line">
                  {["Store", "Price", "Availability", "Rating", ""].map((h) => (
                    <th key={h} className="label py-2.5 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const policies = o.seller.links.filter((l) => /polic|terms|refund|shipping/i.test(l.type));
                  return (
                    <tr key={o.variantId} className="border-b border-line last:border-0">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2.5">
                          {o.image ? (
                            <img src={sized(o.image, 96)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-9 rounded-md object-cover shadow-[inset_0_0_0_1px_var(--line)]" />
                          ) : (
                            <Store className="size-4 text-ink-3" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{o.seller.name ?? o.seller.domain}</p>
                            {policies.length > 0 && (
                              <p className="flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                                {policies.slice(0, 3).map((l) => (
                                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="capitalize hover:text-ink hover:underline">
                                    {l.type.replace(/_/g, " ")}
                                  </a>
                                ))}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="tnum py-3 pr-3 font-semibold">{money(o.price, false, o.currency)}</td>
                      <td className="py-3 pr-3">
                        {o.available === false ? <span className="text-danger">Sold out</span> : <span className="text-ink-2">In stock</span>}
                        {o.condition.length > 0 && <span className="text-ink-3"> · {o.condition.join(", ")}</span>}
                      </td>
                      <td className="py-3 pr-3">{o.rating ? <Stars value={o.rating.value} count={o.rating.count} /> : <span className="text-ink-3">—</span>}</td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => addOffer(o)}
                            disabled={o.available === false}
                            className="btn-secondary inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold disabled:opacity-40"
                          >
                            {added === o.variantId ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                            {added === o.variantId ? "Added" : "Add"}
                          </button>
                          {(o.checkoutUrl ?? o.url) && (
                            <a href={(o.checkoutUrl ?? o.url)!} target="_blank" rel="noopener noreferrer" aria-label={`Buy at ${o.seller.name}`} className="btn-secondary inline-flex size-8 items-center justify-center rounded-lg">
                              <ArrowUpRight className="size-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* similar */}
      <section data-sec className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Similar products</h2>
        {similar === null ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="card aspect-[4/5] animate-pulse" />
            ))}
          </div>
        ) : similar.length ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6">
            {similar.slice(0, 12).map((s) => (
              <SimilarTile key={s.id} s={s} onOpen={() => onOpen(s)} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3">No similar products found.</p>
        )}
      </section>

      {/* everything the API returned */}
      <section data-sec className="card p-5 sm:p-6">
        <button onClick={() => setShowRaw((s) => !s)} className="flex w-full items-center justify-between gap-3 text-left">
          <span>
            <span className="block text-[15px] font-semibold">All product data</span>
            <span className="block text-xs text-ink-3">
              Everything Shopify returned for this item{source === "demo" ? " (sample product)" : ""}
            </span>
          </span>
          <ChevronDown className={cx("size-4 shrink-0 transition-transform", showRaw && "rotate-180")} />
        </button>
        {showRaw && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <span className="truncate font-mono">{p.id}</span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(p.id);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }}
                aria-label="Copy product ID"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink"
              >
                {copied ? <Check className="size-3.5 text-safe" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <pre className="thin-scroll max-h-[480px] overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify(p.raw, null, 2)}</pre>
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-xs text-ink-3">
        <ShieldCheck className="size-3.5" /> Prices and stock come straight from each store and can change.
      </p>
    </div>
  );
}
