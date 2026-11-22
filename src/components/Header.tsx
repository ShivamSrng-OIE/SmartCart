import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Bot, ChevronDown, Columns2, Database, Home, KeyRound, LayoutGrid, Moon, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Store, Sun, Swords, Trophy, X } from "lucide-react";
import { COUNTRIES, setCountry, useCountry } from "../locale";
import type { Theme } from "../hooks/useTheme";
import { gsap, d } from "../lib/motion";
import { cx } from "./ui";

export type View = "home" | "shop" | "product" | "unprotected" | "protected" | "compare" | "redteam" | "results" | "dataset" | "merchant" | "trust" | "settings";

export interface NavItem {
  id: View;
  label: string;
  short: string;
  hint: string;
  icon: typeof Bot;
  key?: string;
}

/** The three modes: the main way through the site. */
export const MODES: NavItem[] = [
  { id: "shop", label: "Shop", short: "Shop", hint: "Search products and check out yourself", icon: Search, key: "1" },
  { id: "unprotected", label: "Assistant", short: "Assistant", hint: "Let the AI assistant shop for you", icon: Bot, key: "2" },
  { id: "protected", label: "Safe Checkout", short: "Safe", hint: "The assistant, with every order verified", icon: ShieldCheck, key: "3" },
];

export const MORE: NavItem[] = [
  { id: "merchant", label: "Sell on Tote", short: "Sell", hint: "Merchant sign-in, listings and photos", icon: Store },
  { id: "trust", label: "Marketplace trust", short: "Trust", hint: "Which sellers shoppers can trust", icon: BadgeCheck },
  { id: "compare", label: "Compare", short: "Compare", hint: "Assistant and Safe Checkout side by side", icon: Columns2 },
  { id: "redteam", label: "Safety updates", short: "Updates", hint: "How Safe Checkout learns new checks", icon: Swords },
  { id: "results", label: "Results", short: "Results", hint: "How Safe Checkout performs, in numbers", icon: Trophy },
  { id: "dataset", label: "Dataset", short: "Dataset", hint: "The poisoned orders we test against", icon: Database },
  { id: "settings", label: "AI models & your key", short: "AI & key", hint: "Which AI runs the checks, and using your own key", icon: SlidersHorizontal },
];

export const ALL_VIEWS: View[] = ["home", "product", ...MODES.map((m) => m.id), ...MORE.map((m) => m.id)];

/** Tote mark: a rounded tote bag with an arched handle. Reads at 16px and in both themes. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M12.25 13V11.5a3.75 3.75 0 0 1 7.5 0V13" fill="none" stroke="var(--brand-ink)" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M8.4 13.6c0-.6.5-1.1 1.1-1.1h13c.6 0 1.1.5 1.1 1.1l-1.05 9.35a2.6 2.6 0 0 1-2.58 2.3h-7.96a2.6 2.6 0 0 1-2.58-2.3z" fill="var(--brand-ink)" />
      <path d="M12.6 17.2c1 .9 2.1 1.35 3.4 1.35s2.4-.45 3.4-1.35" fill="none" stroke="var(--brand)" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** Wordmark: lowercase "tote", tight and heavy enough to sit next to the mark. */
export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-[19px] leading-none font-bold tracking-[-0.05em]">tote</span>
    </span>
  );
}

function CountryPicker({ compact = false }: { compact?: boolean }) {
  const country = useCountry();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Deliver to ${country.name}. Prices in ${country.currency} where stores support it.`}
        className={cx("inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink", compact && "w-full justify-between px-3")}
      >
        <span className="rounded bg-surface-2 px-1 text-[10px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line)]">{country.code}</span>
        <span className={compact ? "" : "hidden lg:inline"}>{compact ? `Deliver to ${country.name}` : country.currency}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Deliver to" className={cx("thin-scroll absolute z-50 max-h-80 w-60 overflow-y-auto rounded-xl bg-surface p-1 shadow-[0_0_0_1px_var(--line),var(--shadow-lg)]", compact ? "bottom-[calc(100%+6px)] left-0" : "top-[calc(100%+6px)] right-0")}>
          <li className="label px-2.5 pt-2 pb-1">Deliver to</li>
          {COUNTRIES.map((c) => (
            <li key={c.code} role="option" aria-selected={c.code === country.code}>
              <button
                onClick={() => {
                  setCountry(c.code);
                  setOpen(false);
                }}
                className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-2", c.code === country.code && "bg-surface-2 font-medium")}
              >
                <span className="w-7 rounded bg-surface-2 px-1 text-center text-[10px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line)]">{c.code}</span>
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-ink-3">{c.currency}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      onClick={() => {
        gsap.fromTo(ref.current!.firstElementChild, { rotate: -90, scale: 0.6, opacity: 0 }, { rotate: 0, scale: 1, opacity: 1, duration: d(0.45), ease: "back.out(2)" });
        onToggle();
      }}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
      className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <span className="inline-flex">{theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}</span>
    </button>
  );
}

function MoreMenu({ view, onView }: { view: View; onView: (v: View) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const active = MORE.some((m) => m.id === view);
  useEffect(() => {
    if (!open) return;
    gsap.fromTo(pop.current, { y: -4, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.18), ease: "power2.out" });
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative hidden md:block short:block">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx("inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-2", active ? "text-ink" : "text-ink-2")}
      >
        More <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div ref={pop} role="menu" className="absolute top-[calc(100%+6px)] right-0 z-40 w-64 rounded-xl bg-surface p-1 shadow-[0_0_0_1px_var(--line),var(--shadow-lg)]">
          {MORE.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                role="menuitem"
                onClick={() => {
                  onView(m.id);
                  setOpen(false);
                }}
                className={cx("flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2", view === m.id && "bg-surface-2")}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span>
                  <span className="block text-[13px] font-medium">{m.label}</span>
                  <span className="block text-xs text-ink-3">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Header({
  view,
  onView,
  theme,
  onTheme,
  cartCount,
  onCart,
  onKey,
  hasOwnKey = false,
}: {
  cartCount: number;
  onCart: () => void;
  /** open "use your own AI key" */
  onKey?: () => void;
  hasOwnKey?: boolean;
  view: View;
  onView: (v: View) => void;
  theme: Theme;
  onTheme: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sheet) gsap.fromTo(sheetRef.current, { yPercent: 100 }, { yPercent: 0, duration: d(0.4), ease: "expo.out" });
  }, [sheet]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
        <div className="mx-auto flex h-14 max-w-[2400px] items-center gap-3 px-3 sm:px-5 xl:px-8 short:h-12 short:gap-2">
          <button onClick={() => onView("home")} className="shrink-0" aria-label="Tote home">
            <Logo />
          </button>

          <nav className="mx-auto hidden md:flex short:flex" aria-label="Modes">
            <div className="flex items-center gap-0.5 rounded-[10px] bg-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
              {MODES.map((v) => {
                const Icon = v.icon;
                const on = view === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => onView(v.id)}
                    aria-current={on ? "page" : undefined}
                    title={v.hint}
                    className={cx("inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-all", on ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink")}
                  >
                    <span className={cx("flex size-4 items-center justify-center rounded text-[10px] font-semibold max-md:short:hidden", on ? "bg-ink text-ink-inverse" : "bg-line text-ink-2")}>{v.key}</span>
                    <Icon className="hidden size-4 lg:block max-md:short:block" />
                    <span className="max-md:short:hidden">{v.label}</span>
                    <span className="hidden max-md:short:inline">{v.short}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <button
              onClick={() => onView("merchant")}
              aria-current={view === "merchant" ? "page" : undefined}
              className={cx("hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-surface-2 lg:inline-flex", view === "merchant" ? "text-ink" : "text-ink-2")}
            >
              <Store className="size-4" /> Sell
            </button>
            <span className="hidden sm:block">
              <CountryPicker />
            </span>
            <MoreMenu view={view} onView={onView} />
            {onKey && (
              <button
                onClick={onKey}
                aria-label={hasOwnKey ? "Your AI key is in use. Change or remove it" : "Use your own AI key"}
                title={hasOwnKey ? "Your AI key is in use" : "Use your own AI key"}
                className={cx("relative inline-flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 hover:text-ink", hasOwnKey ? "text-safe" : "text-ink-2")}
              >
                <KeyRound className="size-[18px]" />
                {hasOwnKey && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-safe ring-2 ring-bg" aria-hidden />}
              </button>
            )}
            <ThemeToggle theme={theme} onToggle={onTheme} />
            <button
              data-cart-target
              onClick={onCart}
              aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
              title="Cart"
              className="relative inline-flex size-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ShoppingBag className="size-[18px]" />
              <span
                data-cart-badge
                className={cx(
                  "tnum absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-ink transition-opacity",
                  cartCount ? "opacity-100" : "opacity-0",
                )}
              >
                {cartCount}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* phones: thumb-reach tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-md md:hidden short:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Modes">
        <div className="grid h-16 grid-cols-4">
          {MODES.map((v) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button key={v.id} onClick={() => onView(v.id)} aria-current={on ? "page" : undefined} className={cx("relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", on ? "text-ink" : "text-ink-3")}>
                {on && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-brand" />}
                <Icon className="size-5" />
                {v.short}
              </button>
            );
          })}
          <button onClick={() => setSheet(true)} className={cx("relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium", ([...MORE.map((m) => m.id), "home"] as View[]).includes(view) ? "text-ink" : "text-ink-3")}>
            <LayoutGrid className="size-5" />
            More
          </button>
        </div>
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheet(false)} />
          <div ref={sheetRef} className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
            <div className="mb-2 sm:hidden">
              <CountryPicker compact />
            </div>
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-[15px] font-semibold">More</span>
              <button onClick={() => setSheet(false)} aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
                <X className="size-4" />
              </button>
            </div>
            {[{ id: "home" as View, label: "Home", short: "Home", hint: "Back to the start", icon: Home }, ...MORE].map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    onView(m.id);
                    setSheet(false);
                  }}
                  className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-2", view === m.id && "bg-surface-2")}
                >
                  <Icon className="size-5 text-ink-3" />
                  <span>
                    <span className="block text-[15px] font-medium">{m.label}</span>
                    <span className="block text-[13px] text-ink-3">{m.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
