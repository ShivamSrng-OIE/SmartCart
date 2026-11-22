import { useEffect, useId, useRef, useState } from "react";
import { ChevronsUpDown, Link2, Loader2, Search, Sparkle, X } from "lucide-react";
import { isUrl, refFromProduct, searchCatalog, type CatalogProduct, type ProductRef } from "../catalog";
import { money } from "../lib/format";
import { gsap, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";
import { cx } from "./ui";

const POPULAR = "coffee";

type Option = { kind: "none" } | { kind: "url"; url: string } | { kind: "product"; p: CatalogProduct };

export function ProductPicker({ value, onChange }: { value: ProductRef | null; onChange: (v: ProductRef | null) => void; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const query = q.trim();

  useEffect(() => {
    if (!open) return;
    if (isUrl(query)) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchCatalog(query || POPULAR, { limit: query ? 8 : 6, signal: ctrl.signal });
        setItems(res.items);
        setActive(0);
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    gsap.fromTo(pop.current, { y: -4, opacity: 0, scale: 0.98 }, { y: 0, opacity: 1, scale: 1, duration: d(0.18), ease: "power2.out", transformOrigin: "top center" });
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const options: Option[] = isUrl(query) ? [{ kind: "url", url: query }] : [{ kind: "none" }, ...items.map((p) => ({ kind: "product" as const, p }))];

  const choose = (o: Option) => {
    if (o.kind === "none") onChange(null);
    else if (o.kind === "url") onChange({ url: o.url, title: o.url });
    else onChange(refFromProduct(o.p));
    setOpen(false);
    setQ("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[active];
      if (o) choose(o);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        data-fill
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="field flex h-[42px] items-center gap-2.5 py-0 pr-2 text-left"
      >
        {value ? (
          <>
            {value.url && !value.id ? (
              <Link2 className="size-4 shrink-0 text-ink-3" />
            ) : (
              <ProductThumb product={{ title: value.title, image: value.image ?? null, vendor: value.shop ?? null }} size="sm" className="size-7!" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] leading-tight">{value.title}</span>
              {(value.price != null || value.shop) && (
                <span className="block truncate text-[11px] leading-tight text-ink-3">
                  {value.price != null && money(value.price)}
                  {value.shop && ` · ${value.shop}`}
                </span>
              )}
            </span>
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear product"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3.5" />
            </span>
          </>
        ) : (
          <>
            <Sparkle className="size-4 shrink-0 text-ink-3" />
            <span className="flex-1 truncate text-[14px] text-ink-2">Let the agent find it</span>
            <ChevronsUpDown className="size-4 shrink-0 text-ink-3" />
          </>
        )}
      </button>

      {open && (
        <div ref={pop} className="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl bg-surface shadow-[0_0_0_1px_var(--line),var(--shadow-lg)] sm:min-w-[340px] xl:right-0 xl:left-auto">
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search products or paste a URL"
              className="h-11 w-full bg-transparent pr-9 pl-9 text-[14px] outline-none placeholder:text-ink-3"
              role="combobox"
              aria-controls={listId}
              aria-expanded
              aria-autocomplete="list"
            />
            {loading && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-ink-3" />}
          </div>
          <ul id={listId} role="listbox" className="thin-scroll max-h-[300px] overflow-y-auto p-1">
            {!query && <li className="label px-2.5 pt-2 pb-1">Popular on Shopify · type to search</li>}
            {options.map((o, i) => (
              <li key={o.kind === "product" ? o.p.id : o.kind} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left", i === active && "bg-surface-2")}
                >
                  {o.kind === "none" && (
                    <>
                      <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                        <Sparkle className="size-4 text-ink-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px]">Let the agent find it</span>
                        <span className="block text-xs text-ink-3">Argon describes the object, the shopper searches</span>
                      </span>
                    </>
                  )}
                  {o.kind === "url" && (
                    <>
                      <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
                        <Link2 className="size-4 text-ink-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px]">Use this product URL</span>
                        <span className="block truncate font-mono text-xs text-ink-3">{o.url}</span>
                      </span>
                    </>
                  )}
                  {o.kind === "product" && (
                    <>
                      <ProductThumb product={o.p} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px]">{o.p.title}</span>
                        <span className="block truncate text-xs text-ink-3">{o.p.shopName ?? o.p.shop}</span>
                      </span>
                      <span className="tnum shrink-0 text-[13px] font-medium">{money(o.p.price)}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
            {query && !isUrl(query) && !loading && items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">No matches for “{query}”</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
