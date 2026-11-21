import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Bot, Check, ChevronDown, Copy, Info, Loader2, Minus, PackageSearch, Plus, Search, ShoppingBag, Star, Trash2, X } from "lucide-react";
import { demoCatalog, getProduct, isUrl, refFromProduct, searchCatalog, splitQueries, type CatalogProduct, type CatalogSource, type ProductRef } from "../catalog";
import { createCheckoutMcp, type ShopMessage } from "../shop";
import type { Mode } from "../hooks/useBackend";
import type { Cart } from "../hooks/useCart";
import { money } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";
import { Button, Chip, Kbd, Segmented, cx } from "./ui";

const SUGGESTIONS = ["cold brew", "sparkling water", "ceramic mug", "flash drive", "granola", "insulated bottle"];
const PRICE_CAPS: { value: string; label: string; cap: number | null }[] = [
  { value: "any", label: "Any price", cap: null },
  { value: "25", label: "Under $25", cap: 25 },
  { value: "50", label: "Under $50", cap: 50 },
  { value: "100", label: "Under $100", cap: 100 },
];
type Sort = "relevance" | "price_asc" | "price_desc";

const unitsLabel = (u: number | null) => (u && u > 1 ? `${u}-pack` : null);

function sortItems(items: CatalogProduct[], sort: Sort): CatalogProduct[] {
  const xs = [...items];
  if (sort === "price_asc") xs.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  if (sort === "price_desc") xs.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  return xs;
}

/* ------------------------------------------------------------------ cards */

function ProductCard({ p, inCart, onOpen, onAdd }: { p: CatalogProduct; inCart: number; onOpen: () => void; onAdd: () => void }) {
  return (
    <div data-card className="group card flex flex-col overflow-hidden transition-shadow duration-200 hover:shadow-[0_0_0_1px_var(--line-strong),0_12px_24px_-16px_rgb(0_0_0/0.35)]">
      <button onClick={onOpen} className="flex flex-1 flex-col text-left" aria-label={`Open ${p.title}`}>
        <div className="aspect-[4/3] w-full border-b border-line">
          <ProductThumb product={p} className="rounded-none! shadow-none!" />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3 pb-2 sm:p-3.5 sm:pb-2">
          <p className="line-clamp-2 text-[14px] leading-snug font-medium text-ink">{p.title}</p>
          <p className="truncate text-xs text-ink-3">{p.shopName ?? p.shop ?? p.vendor ?? "Shopify store"}</p>
          {(p.rating || p.available === false) && (
            <p className="flex items-center gap-2 text-[11px] text-ink-3">
              {p.rating && (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="size-3 fill-current text-warn" /> {p.rating.value.toFixed(1)} <span className="opacity-70">({p.rating.count})</span>
                </span>
              )}
              {p.available === false && <span className="text-danger">Sold out</span>}
            </p>
          )}
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 px-3 pb-3 sm:px-3.5 sm:pb-3.5">
        <span className="flex items-baseline gap-1.5">
          <span className="tnum text-[15px] font-semibold">{money(p.price, false, p.currency)}</span>
          {unitsLabel(p.units) && <span className="text-[11px] text-ink-3">{unitsLabel(p.units)}</span>}
        </span>
        <button
          onClick={onAdd}
          disabled={p.available === false}
          aria-label={`Add ${p.title} to cart`}
          className={cx(
            "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold transition-colors",
            inCart ? "bg-safe-soft text-safe shadow-[inset_0_0_0_1px_var(--safe-line)]" : "btn-secondary",
          )}
        >
          {inCart ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
          {inCart ? `${inCart} in cart` : "Add"}
        </button>
      </div>
    </div>
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

/* --------------------------------------------------------------- detail */

function DetailSheet({
  seed,
  live,
  inCart,
  onClose,
  onAdd,
  onAskAI,
}: {
  seed: CatalogProduct;
  live: boolean;
  inCart: number;
  onClose: () => void;
  onAdd: (p: CatalogProduct) => void;
  onAskAI: (ref: ProductRef) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [product, setProduct] = useState<CatalogProduct>(seed);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<CatalogSource>("demo");
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let alive = true;
    getProduct(seed.id, live).then(({ product: p, source: s }) => {
      if (!alive) return;
      if (p) setProduct(p);
      setSource(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [seed.id, live]);

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
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={p.title}>
      <div ref={scrim} className="absolute inset-0 bg-black/40" onClick={close} />
      <div
        ref={panel}
        className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-2xl bg-surface shadow-float md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[460px] md:rounded-none md:rounded-l-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" />
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">Product details</span>
            {loading ? <Loader2 className="size-3.5 animate-spin text-ink-3" /> : <Chip className="h-5 text-[10px]">{source === "demo" ? "demo product" : "live from Shopify"}</Chip>}
          </div>
          <button onClick={close} aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        <div className="thin-scroll flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="aspect-[16/10] w-full">
            <ProductThumb product={p} size="lg" />
          </div>
          <h2 className="mt-4 text-xl leading-snug font-semibold tracking-tight">{p.title}</h2>
          <p className="mt-0.5 text-sm text-ink-3">{p.shopName ?? p.shop ?? p.vendor}</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tnum text-[28px] font-semibold tracking-tight">{money(p.price, false, p.currency)}</span>
            {unitsLabel(p.units) && <Chip>{unitsLabel(p.units)}</Chip>}
            {p.rating && (
              <span className="inline-flex items-center gap-1 text-sm text-ink-2">
                <Star className="size-3.5 fill-current text-warn" /> {p.rating.value.toFixed(1)} <span className="text-ink-3">· {p.rating.count} reviews</span>
              </span>
            )}
          </div>
          {p.available === false && <p className="mt-2 text-sm text-danger">This item is sold out right now.</p>}
          {p.options.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {p.options.slice(0, 3).map((o) => (
                <div key={o.name}>
                  <p className="text-xs text-ink-3">{o.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {o.values.slice(0, 8).map((v) => (
                      <span key={v} className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-2">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {p.description && <p className="mt-3 line-clamp-[12] text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{p.description}</p>}

          <dl className="mt-5 divide-y divide-line rounded-xl border border-line">
            {[
              ["Units in one purchase", p.units != null ? String(p.units) : "—"],
              ["Brand", p.vendor ?? "—"],
              ["Store", p.shop ?? "—"],
              ["Category", p.type ?? "—"],
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

          <button onClick={() => setShowRaw((s) => !s)} className="mt-4 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
            <ChevronDown className={cx("size-3.5 transition-transform", showRaw && "rotate-180")} /> Show raw data
          </button>
          {showRaw && (
            <pre className="thin-scroll mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify(p.raw, null, 2)}</pre>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line p-4 sm:px-5">
          <div className="flex gap-2">
            <Button variant="primary" size="lg" className="flex-1" disabled={p.available === false} onClick={() => onAdd(p)} icon={inCart ? <Check className="size-4" /> : <Plus className="size-4" />}>
              {inCart ? `Add another (${inCart} in cart)` : "Add to cart"}
            </Button>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label="Open on the store" className="btn-secondary inline-flex size-11 shrink-0 items-center justify-center rounded-[10px]">
                <ArrowUpRight className="size-4" />
              </a>
            )}
          </div>
          <Button variant="ghost" size="md" onClick={() => onAskAI(refFromProduct(p))} icon={<Bot className="size-4" />}>
            Ask an AI shopper to buy this instead
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ cart */

/** Starts a real Shopify checkout for one store and opens its continue_url exactly as returned. */
function CheckoutButton({ shop, lines }: { shop: string; lines: Cart["lines"] }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const name = lines[0]?.shopName ?? shop;
  const real = lines.every((l) => l.variantId) && !/\.example$/.test(shop);
  const fallbackUrl = lines.find((l) => l.url)?.url ?? null;

  const go = async () => {
    // Open the tab inside the click so popup blockers allow it, then point it at the checkout.
    const tab = window.open("", "_blank");
    setState("busy");
    setMsg(null);
    try {
      const res = await createCheckoutMcp(shop, lines.map((l) => ({ variantId: l.variantId!, quantity: l.qty })));
      if (!res.continue_url) throw new Error("Shopify didn’t return a checkout link.");
      if (tab) tab.location.href = res.continue_url;
      else window.location.href = res.continue_url;
      setState("idle");
    } catch (err) {
      tab?.close();
      setState("error");
      setMsg(err instanceof Error ? err.message : "Checkout failed.");
    }
  };

  if (!real) {
    return fallbackUrl ? (
      <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex h-10 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold">
        Open {name} <ArrowUpRight className="size-4" />
      </a>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1">
      <button onClick={go} disabled={state === "busy"} className="btn-brand inline-flex h-10 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold disabled:opacity-60">
        {state === "busy" ? <Loader2 className="size-4 animate-spin" /> : null}
        Check out at {name} <ArrowUpRight className="size-4" />
      </button>
      {msg && <p className="text-[11px] text-danger">{msg}</p>}
    </div>
  );
}

function CartPanel({ cart, className, onClose }: { cart: Cart; className?: string; onClose?: () => void }) {
  const [budget, setBudget] = useState("");
  const b = Number.parseFloat(budget);
  const over = Number.isFinite(b) && b > 0 && cart.total > b;
  return (
    <section className={cx("card flex min-h-0 flex-col overflow-hidden", className)} aria-label="Your cart">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <ShoppingBag className="size-4" /> Your cart
          {cart.count > 0 && <span className="tnum rounded-full bg-surface-2 px-1.5 text-xs font-medium text-ink-2">{cart.count}</span>}
        </h2>
        <div className="flex items-center gap-1">
          {cart.count > 0 && (
            <button onClick={cart.clear} className="rounded-md px-2 py-1 text-xs text-ink-3 hover:bg-surface-2 hover:text-ink">
              Empty
            </button>
          )}
          {onClose && (
            <button onClick={onClose} aria-label="Close cart" className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
              <X className="size-4" />
            </button>
          )}
        </div>
      </header>

      {cart.count === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
          <ShoppingBag className="size-6 text-ink-3" />
          <p className="text-[14px] font-medium">Nothing here yet</p>
          <p className="text-[13px] text-ink-3">Search for a product and press Add. You decide everything here; no AI is involved.</p>
        </div>
      ) : (
        <>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {cart.byShop.map(([shop, lines]) => (
              <div key={shop} className="py-2">
                <p className="label mb-1.5">{lines[0]?.shopName ?? shop}</p>
                <ul className="flex flex-col gap-2.5">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-center gap-2.5">
                      <ProductThumb product={{ title: l.title, image: l.image, vendor: l.vendor }} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{l.title}</p>
                        <p className="tnum text-xs text-ink-3">
                          {money(l.price, false, l.currency)} each · <span className="text-ink-2">{money((l.price ?? 0) * l.qty, false, l.currency)}</span>
                        </p>
                      </div>
                      <div className="flex items-center rounded-lg border border-line">
                        <button onClick={() => cart.setQty(l.id, l.qty - 1)} aria-label="One fewer" className="inline-flex size-7 items-center justify-center text-ink-2 hover:text-ink">
                          {l.qty === 1 ? <Trash2 className="size-3.5" /> : <Minus className="size-3.5" />}
                        </button>
                        <span className="tnum w-6 text-center text-[13px] font-medium">{l.qty}</span>
                        <button onClick={() => cart.setQty(l.id, l.qty + 1)} aria-label="One more" className="inline-flex size-7 items-center justify-center text-ink-2 hover:text-ink">
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <footer className="flex flex-col gap-3 border-t border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                Budget
                <span className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-ink-3">$</span>
                  <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="none" className="field tnum h-8 w-24 py-0 pl-6 text-[13px]" />
                </span>
              </label>
              <div className="text-right">
                <p className="label">Total</p>
                <p className={cx("tnum text-xl font-semibold tracking-tight", over && "text-danger")}>{money(cart.total)}</p>
              </div>
            </div>
            {over && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">That’s {money(cart.total - b)} over your budget.</p>}
            <div className="flex flex-col gap-1.5">
              {cart.byShop.map(([shop, lines]) => (
                <CheckoutButton key={shop} shop={shop} lines={lines} />
              ))}
              <p className="text-center text-[11px] text-ink-3">Each store has its own checkout. You pay on the store’s site; this page never completes a purchase.</p>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export function ShopYourself({ mode, cart, onAskAI }: { mode: Mode; cart: Cart; onAskAI: (ref: ProductRef) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [cap, setCap] = useState("any");
  const [sort, setSort] = useState<Sort>("relevance");
  const [items, setItems] = useState<CatalogProduct[]>(demoCatalog());
  const [groups, setGroups] = useState<{ term: string; items: CatalogProduct[] }[] | null>(null);
  const [source, setSource] = useState<CatalogSource>("demo");
  const [warnings, setWarnings] = useState<ShopMessage[]>([]);
  const [note, setNote] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | undefined>();
  const [total, setTotal] = useState<number | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<CatalogProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const live = mode === "live";
  const query = q.trim();
  const urlQuery = isUrl(query);
  const terms = useMemo(() => splitQueries(query), [query]);
  const capN = PRICE_CAPS.find((c) => c.value === cap)?.cap ?? null;

  useEffect(() => {
    if (urlQuery) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(
      async () => {
        setLoading(true);
        try {
          if (!terms.length) {
            setItems(demoCatalog().filter((p) => capN == null || (p.price ?? 0) <= capN));
            setGroups(null);
            setSource("demo");
            setWarnings([]);
            setNote(undefined);
            setCursor(undefined);
            setTotal(undefined);
          } else if (terms.length === 1) {
            const res = await searchCatalog(terms[0], { maxPrice: capN, signal: ctrl.signal, limit: 12 });
            setItems(res.items);
            setGroups(null);
            setSource(res.source);
            setWarnings(res.messages ?? []);
            setNote(res.note);
            setCursor(res.cursor);
            setTotal(res.total);
          } else {
            // "cold brew, mug, granola": one search per item, in parallel, shown as sections.
            const results = await Promise.all(terms.map((t) => searchCatalog(t, { maxPrice: capN, signal: ctrl.signal, limit: 8 })));
            setGroups(terms.map((term, i) => ({ term, items: results[i].items })));
            setItems(results.flatMap((r) => r.items));
            setSource(results.some((r) => r.source !== "demo") ? results.find((r) => r.source !== "demo")!.source : "demo");
            setWarnings(results.flatMap((r) => r.messages ?? []));
            setNote(results.find((r) => r.note)?.note);
            setCursor(undefined);
            setTotal(undefined);
          }
        } catch {
          /* superseded by a newer search */
        } finally {
          if (!ctrl.signal.aborted) setLoading(false);
        }
      },
      query ? 300 : 0,
    );
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [terms, capN, urlQuery, query]);

  const loadMore = async () => {
    if (!cursor || terms.length !== 1) return;
    setLoadingMore(true);
    try {
      const res = await searchCatalog(terms[0], { maxPrice: capN, cursor, limit: 12 });
      setItems((xs) => {
        const seen = new Set(xs.map((x) => x.id));
        return [...xs, ...res.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(res.cursor);
    } finally {
      setLoadingMore(false);
    }
  };

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

  const sorted = useMemo(() => sortItems(items, sort), [items, sort]);

  useGSAP(
    () => {
      gsap.fromTo("[data-card]", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.4), stagger: 0.03, ease: "power2.out", clearProps: "transform,opacity" });
    },
    { scope: root, dependencies: [sorted.map((p) => p.id).join("|")] },
  );

  const add = (p: CatalogProduct) => {
    cart.add(p);
    const badge = document.querySelector("[data-cart-badge]");
    if (badge) gsap.fromTo(badge, { scale: 1.35 }, { scale: 1, duration: d(0.4), ease: "back.out(3)" });
  };

  return (
    <div ref={root} className="mx-auto grid w-full max-w-[1400px] gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
      <div className="flex min-w-0 flex-col gap-4">
        {/* search */}
        <section className="card p-4 sm:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Shopify, e.g. cold brew, ceramic mug"
              className="field h-12 rounded-xl! pr-20 pl-11 text-base sm:h-14 sm:text-[17px]"
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
          <p className="mt-2 text-xs text-ink-3">Separate several items with commas to search them all at once.</p>
          <div className="thin-scroll -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
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

        {urlQuery ? (
          <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="min-w-0">
              <p className="text-[15px] font-medium">That looks like a product link</p>
              <p className="truncate font-mono text-xs text-ink-3">{query}</p>
            </div>
            <div className="flex gap-2">
              <a href={query.startsWith("http") ? query : `https://${query}`} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex h-11 items-center gap-2 rounded-[10px] px-4 text-[14px] font-medium">
                Open it <ArrowUpRight className="size-4" />
              </a>
              <Button variant="primary" size="lg" onClick={() => onAskAI({ url: query, title: query })} icon={<Bot className="size-4" />}>
                Let an AI buy it
              </Button>
            </div>
          </section>
        ) : (
          <>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tnum font-medium">{groups ? items.length : total != null && total > sorted.length ? `${sorted.length} of ${total.toLocaleString()}` : sorted.length}</span>
                <span className="text-ink-3">{!query ? "products to start with" : groups ? `results for ${groups.length} items` : `results for “${terms[0] ?? query}”`}</span>
                <Chip tone={source === "demo" ? "neutral" : "safe"} className="h-5 text-[10px]">
                  {source === "demo" ? "demo products" : "live from Shopify"}
                </Chip>
              </p>
              <div className="flex items-center gap-2">
                <Segmented size="sm" value={cap} onChange={setCap} options={PRICE_CAPS.map((c) => ({ value: c.value, label: c.label }))} className="flex-1 overflow-x-auto sm:flex-none" />
                <label>
                  <span className="sr-only">Sort</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field h-8 py-0 pr-8 text-[13px]">
                    <option value="relevance">Best match</option>
                    <option value="price_asc">Cheapest first</option>
                    <option value="price_desc">Priciest first</option>
                  </select>
                </label>
              </div>
            </div>
            {query && source === "demo" && (
              <p className="-mt-2 flex items-start gap-1.5 text-xs text-ink-3">
                <Info className="mt-px size-3.5 shrink-0" /> Shopify search isn’t reachable{note ? ` (${note})` : ""}, so these come from the demo products.
              </p>
            )}
            {warnings.map((w, i) => (
              <p key={i} className="-mt-2 flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
                <Info className="mt-px size-3.5 shrink-0" /> {w.content}
              </p>
            ))}

            {loading && !sorted.length ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : groups ? (
              <div className={cx("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
                {groups.map((g) => (
                  <section key={g.term} aria-label={`Results for ${g.term}`}>
                    <h2 className="mb-2.5 flex items-baseline gap-2 text-[15px] font-semibold">
                      {g.term} <span className="tnum text-xs font-normal text-ink-3">{g.items.length} results</span>
                    </h2>
                    {g.items.length ? (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
                        {sortItems(g.items, sort).map((p) => (
                          <ProductCard key={p.id} p={p} inCart={cart.qtyOf(p.id)} onOpen={() => setOpen(p)} onAdd={() => add(p)} />
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">Nothing found for “{g.term}”.</p>
                    )}
                  </section>
                ))}
              </div>
            ) : sorted.length ? (
              <>
                <div className={cx("grid grid-cols-2 gap-2.5 transition-opacity sm:grid-cols-3 sm:gap-3 xl:grid-cols-4", loading && "opacity-60")}>
                  {sorted.map((p) => (
                    <ProductCard key={p.id} p={p} inCart={cart.qtyOf(p.id)} onOpen={() => setOpen(p)} onAdd={() => add(p)} />
                  ))}
                </div>
                {cursor && (
                  <Button className="mx-auto" onClick={loadMore} disabled={loadingMore} icon={loadingMore ? <Loader2 className="size-4 animate-spin" /> : undefined}>
                    {loadingMore ? "Loading…" : "Show more"}
                  </Button>
                )}
              </>
            ) : (
              <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
                <PackageSearch className="size-7 text-ink-3" />
                <p className="text-[15px] font-medium">Nothing matches “{terms[0] ?? query}”</p>
                <p className="max-w-sm text-sm text-ink-3">Try a broader word or remove the price limit.</p>
                {cap !== "any" && (
                  <Button size="sm" className="mt-2" onClick={() => setCap("any")}>
                    Remove price limit
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* cart: sidebar on desktop */}
      <CartPanel cart={cart} className="sticky top-[76px] hidden max-h-[calc(100dvh-96px)] lg:flex" />

      {/* cart: floating button + sheet on phones/tablets */}
      <button
        onClick={() => setCartOpen(true)}
        className="btn-primary fixed right-4 bottom-[84px] z-30 inline-flex h-12 items-center gap-2 rounded-full px-4 text-[14px] font-semibold shadow-float md:bottom-6 lg:hidden"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        aria-label={`Open cart, ${cart.count} items`}
      >
        <ShoppingBag className="size-4" /> Cart
        <span data-cart-badge className="tnum rounded-full bg-ink-inverse px-1.5 text-xs text-ink">
          {cart.count}
        </span>
        {cart.count > 0 && <span className="tnum opacity-70">{money(cart.total)}</span>}
      </button>
      {cartOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Your cart">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <CartPanel cart={cart} onClose={() => setCartOpen(false)} className="max-h-[85dvh] rounded-b-none" />
          </div>
        </div>
      )}

      {open && <DetailSheet seed={open} live={live} inCart={cart.qtyOf(open.id)} onClose={() => setOpen(null)} onAdd={add} onAskAI={onAskAI} />}
    </div>
  );
}
