import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Bot, Check, Info, Loader2, Minus, PackageSearch, Plus, Search, ShieldAlert, ShoppingBag, Star, Trash2, X } from "lucide-react";
import { isFlagged, isUrl, searchCatalog, splitQueries, type CatalogProduct, type ProductRef } from "../catalog";
import { createCheckoutMcp, type ShopMessage } from "../shop";
import { useCountry } from "../locale";
import type { Mode } from "../hooks/useBackend";
import type { Cart } from "../hooks/useCart";
import { money } from "../lib/format";
import { flyToCart, gsap, useGSAP, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";
import { AutoRail } from "./AutoRail";
import { Button, Kbd, Segmented, cx } from "./ui";
import { CheckActivityLine } from "./CheckProgress";
import { HeldDialog, TrustChip } from "./TrustBadge";
import { useCartChecker, type CheckResult } from "../hooks/useCartChecker";

const SUGGESTIONS = ["cold brew", "sparkling water", "ceramic mug", "flash drive", "granola", "insulated bottle"];
import { BROWSE } from "../config";
const PRICE_CAPS: { value: string; label: string; cap: number | null }[] = [
  { value: "any", label: "Any", cap: null },
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

function ProductCard({ p, inCart, check, onOpen, onAdd, onHeld }: { p: CatalogProduct; inCart: number; check?: CheckResult; onOpen: () => void; onAdd: (from: Element | null) => void; onHeld: () => void }) {
  const [hover, setHover] = useState(false);
  const thumbRef = useRef<HTMLDivElement>(null);
  const flagged = isFlagged(p);
  const checking = check?.phase === "checking";
  const held = check?.phase === "held" || check?.phase === "error";
  const lowered = !!p.rating && !!p.trust && (p.trust.merchantStatus !== "trusted" || p.trust.productStatus !== "clear");
  return (
    <div
      data-card
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={cx(
        "group card flex h-full flex-col overflow-hidden transition-shadow duration-200",
        flagged ? "shadow-[0_0_0_1px_var(--danger-line)] hover:shadow-[0_0_0_1px_var(--danger),0_12px_24px_-16px_rgb(199_10_36/0.35)]" : "hover:shadow-[0_0_0_1px_var(--line-strong),0_12px_24px_-16px_rgb(0_0_0/0.35)]",
      )}
    >
      <button onClick={onOpen} className="flex flex-1 flex-col text-left" aria-label={`Open ${p.title}`}>
        <div ref={thumbRef} className={cx("relative aspect-[4/3] w-full border-b border-line", flagged && "border-danger-line")}>
          <ProductThumb product={p} active={hover} className={cx("rounded-none! shadow-none!", flagged && "opacity-70 saturate-50")} />
          {flagged && (
            <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-white shadow">
              <ShieldAlert className="size-3" /> Flagged
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3 pb-2 sm:p-3.5 sm:pb-2">
          <p className="line-clamp-2 text-[14px] leading-snug font-medium text-ink">{p.title}</p>
          <p className="truncate text-xs text-ink-3">{p.shopName ?? p.shop ?? p.vendor ?? "Shopify store"}</p>
          {(p.rating || p.available === false || p.trust) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
              {p.rating && (
                <span className={cx("inline-flex items-center gap-0.5", lowered && "text-danger")}>
                  <Star className={cx("size-3 fill-current", lowered ? "text-danger" : "text-warn")} /> {p.rating.value.toFixed(1)} <span className="opacity-70">({p.rating.count})</span>
                </span>
              )}
              {p.available === false && <span className="text-danger">Sold out</span>}
              <TrustChip p={p} />
            </p>
          )}
        </div>
      </button>
      {checking && check && <CheckActivityLine state={check.state} product={p} />}
      <div className="flex items-center justify-between gap-2 px-3 pb-3 sm:px-3.5 sm:pb-3.5">
        <span className="flex items-baseline gap-1.5">
          <span className="tnum text-[15px] font-semibold">{money(p.price, false, p.currency)}</span>
          {unitsLabel(p.units) && <span className="text-[11px] text-ink-3">{unitsLabel(p.units)}</span>}
        </span>
        {held ? (
          <button onClick={onHeld} className="inline-flex h-8 items-center gap-1 rounded-lg bg-danger-soft px-2.5 text-[12px] font-semibold text-danger shadow-[inset_0_0_0_1px_var(--danger-line)]" aria-label={`Why ${p.title} was held`}>
            <ShieldAlert className="size-3.5" /> Held · why?
          </button>
        ) : (
          <button
            onClick={(e) => {
              const btn = e.currentTarget;
              gsap.fromTo(btn, { scale: 0.92 }, { scale: 1, duration: d(0.35), ease: "back.out(3)" });
              onAdd(thumbRef.current);
            }}
            disabled={p.available === false || checking}
            aria-label={checking ? `Checking ${p.title}` : `Add ${p.title} to cart`}
            className={cx(
              "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold transition-colors",
              inCart ? "bg-safe-soft text-safe shadow-[inset_0_0_0_1px_var(--safe-line)]" : "btn-secondary",
            )}
          >
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : inCart ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            {checking ? "Checking…" : inCart ? `${inCart} in cart` : "Add"}
          </button>
        )}
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

/* ------------------------------------------------------------------ cart */

/** Starts a real Shopify checkout for one store and opens its continue_url exactly as returned. */
function CheckoutButton({ shop, lines }: { shop: string; lines: Cart["lines"] }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const name = lines[0]?.shopName ?? shop;
  const demoStore = /(^|\.)warehouse\.local$/.test(shop);
  const real = lines.every((l) => l.variantId) && !/\.example$/.test(shop) && !demoStore;
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

  if (demoStore) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span><span className="font-medium text-ink">{name}</span> takes no payment online, so there is no payment step. Safe Checkout already approved these items.</span>
      </p>
    );
  }
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
          <p className="text-[13px] text-ink-3">Search for a product and press Add.</p>
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
              <p className="text-center text-[11px] text-ink-3">Each store has its own secure checkout. You complete payment on the store’s site.</p>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export function ShopYourself({
  cart,
  onAskAI,
  onOpenProduct,
  initialQuery = "",
  openCartTick = 0,
}: {
  openCartTick?: number;
  mode?: Mode;
  cart: Cart;
  onAskAI: (ref: ProductRef) => void;
  onOpenProduct: (p: CatalogProduct) => void;
  initialQuery?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(initialQuery);
  const [cap, setCap] = useState("any");
  const [sort, setSort] = useState<Sort>("relevance");
  const [items, setItems] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [groups, setGroups] = useState<{ term: string; items: CatalogProduct[] }[] | null>(null);
  const [warnings, setWarnings] = useState<ShopMessage[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [total, setTotal] = useState<number | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const query = q.trim();
  const urlQuery = isUrl(query);
  const terms = useMemo(() => splitQueries(query), [query]);
  const country = useCountry();
  const capN = PRICE_CAPS.find((c) => c.value === cap)?.cap ?? null;

  useEffect(() => {
    if (urlQuery) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(
      async () => {
        setLoading(true);
        try {
          if (!terms.length) {
            const results = await Promise.all(BROWSE.map((t) => searchCatalog(t, { maxPrice: capN, signal: ctrl.signal, limit: 6 })));
            setGroups(BROWSE.map((term, i) => ({ term, items: results[i].items.slice(0, 6) })).filter((g) => g.items.length));
            setItems(results.flatMap((r) => r.items));
            setError(results.every((r) => r.error) ? (results[0].error ?? "Couldn’t reach Shopify right now.") : null);
            setWarnings([]);
            setCursor(undefined);
            setTotal(undefined);
          } else if (terms.length === 1) {
            const res = await searchCatalog(terms[0], { maxPrice: capN, signal: ctrl.signal, limit: 12, includeWarehouse: true });
            setItems(res.items);
            setGroups(null);
            setError(res.error ?? null);
            setWarnings(res.messages ?? []);
            setCursor(res.cursor);
            setTotal(res.total);
          } else {
            // "cold brew, mug, granola": one search per item, in parallel, shown as sections.
            const results = await Promise.all(terms.map((t) => searchCatalog(t, { maxPrice: capN, signal: ctrl.signal, limit: 8, includeWarehouse: true })));
            setGroups(terms.map((term, i) => ({ term, items: results[i].items })));
            setItems(results.flatMap((r) => r.items));
            setError(results.every((r) => r.error) ? (results[0].error ?? "Couldn’t reach Shopify right now.") : null);
            setWarnings(results.flatMap((r) => r.messages ?? []));
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
  }, [terms, capN, urlQuery, query, country.code, retry]);

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

  // Warehouse listings are checked the moment they are added; Shopify products go straight in.
  const flyFrom = useRef(new Map<string, Element | null>());
  const checker = useCartChecker(cart, (p) => flyToCart(flyFrom.current.get(p.id) ?? null));
  const [held, setHeld] = useState<CatalogProduct | null>(null);
  const add = (p: CatalogProduct, from?: Element | null) => {
    if (p.source === "warehouse") {
      flyFrom.current.set(p.id, from ?? null);
      checker.check(p);
      return;
    }
    cart.add(p);
    flyToCart(from);
  };

  // The header cart button opens the cart sheet on screens without the sidebar.
  useEffect(() => {
    if (openCartTick && window.innerWidth < 1024) setCartOpen(true);
  }, [openCartTick]);

  return (
    <div ref={root} className="grid grid-cols-1 w-full gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        {/* search */}
        <section className="card p-4 sm:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products"
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
          <p className="mt-2 text-xs text-ink-3">Tip: separate items with commas to search several at once.</p>
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
              <p className="truncate text-xs text-ink-3">{query}</p>
            </div>
            <div className="flex gap-2">
              <a href={query.startsWith("http") ? query : `https://${query}`} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex h-11 items-center gap-2 rounded-[10px] px-4 text-[14px] font-medium">
                Open it <ArrowUpRight className="size-4" />
              </a>
              <Button variant="primary" size="lg" onClick={() => onAskAI({ url: query, title: query })} icon={<Bot className="size-4" />}>
                Have the assistant buy it
              </Button>
            </div>
          </section>
        ) : (
          <>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tnum font-medium">{groups ? items.length : total != null && total > sorted.length ? `${sorted.length} of ${total.toLocaleString()}` : sorted.length}</span>
                <span className="text-ink-3">{!query ? (groups ? `products across ${groups.length} categories` : "products to start with") : groups ? `results for ${groups.length} items` : `results for “${terms[0] ?? query}”`}</span>
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
                  <Segmented size="sm" value={cap} onChange={setCap} options={PRICE_CAPS.map((c) => ({ value: c.value, label: c.label }))} className="min-w-full sm:min-w-0" />
                </div>
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
            {error && (
              <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
                <PackageSearch className="size-7 text-ink-3" />
                <p className="text-[15px] font-medium">Couldn’t reach Shopify right now</p>
                <p className="max-w-sm text-sm text-ink-3">Check your connection and try again.</p>
                <Button size="sm" className="mt-2" onClick={() => setRetry((n) => n + 1)}>
                  Try again
                </Button>
              </div>
            )}
            {warnings.map((w, i) => (
              <p key={i} className="-mt-2 flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
                <Info className="mt-px size-3.5 shrink-0" /> {w.content}
              </p>
            ))}

            {loading && !sorted.length ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6">
                {Array.from({ length: 8 }, (_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : groups ? (
              <div className={cx("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
                {groups.map((g) => (
                  <section key={g.term} aria-label={`Results for ${g.term}`}>
                    <div className="mb-2.5 flex items-baseline justify-between gap-2">
                      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
                        {g.term} {query && <span className="tnum text-xs font-normal text-ink-3">{g.items.length} results</span>}
                      </h2>
                      {!query && (
                        <button onClick={() => setQ(g.term)} className="text-[13px] font-medium text-ink-2 hover:text-ink">
                          See all
                        </button>
                      )}
                    </div>
                    {g.items.length ? (
                      query ? (
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6">
                          {sortItems(g.items, sort).map((p) => (
                            <ProductCard key={p.id} p={p} inCart={cart.qtyOf(p.id)} check={checker.results[p.id]} onOpen={() => onOpenProduct(p)} onAdd={(from) => add(p, from)} onHeld={() => setHeld(p)} />
                          ))}
                        </div>
                      ) : (
                        // Browse rows: a gently auto-scrolling rail that pauses on hover.
                        <AutoRail label={`${g.term} products`} speed={24 + (g.term.length % 3) * 4}>
                          {sortItems(g.items, sort).map((p) => (
                            <ProductCard key={p.id} p={p} inCart={cart.qtyOf(p.id)} check={checker.results[p.id]} onOpen={() => onOpenProduct(p)} onAdd={(from) => add(p, from)} onHeld={() => setHeld(p)} />
                          ))}
                        </AutoRail>
                      )
                    ) : (
                      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">Nothing found for “{g.term}”.</p>
                    )}
                  </section>
                ))}
              </div>
            ) : error ? null : sorted.length ? (
              <>
                <div className={cx("grid transition-opacity grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6", loading && "opacity-60")}>
                  {sorted.map((p) => (
                    <ProductCard key={p.id} p={p} inCart={cart.qtyOf(p.id)} check={checker.results[p.id]} onOpen={() => onOpenProduct(p)} onAdd={(from) => add(p, from)} onHeld={() => setHeld(p)} />
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

      {held && checker.results[held.id] && <HeldDialog product={held} result={checker.results[held.id]} onClose={() => setHeld(null)} />}

      {/* cart sheet on phones/tablets (opened from the header cart button) */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Your cart">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <CartPanel cart={cart} onClose={() => setCartOpen(false)} className="max-h-[85dvh] rounded-b-none" />
          </div>
        </div>
      )}

    </div>
  );
}
