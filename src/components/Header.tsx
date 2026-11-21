import { useRef } from "react";
import { Moon, Sun, Swords, Trophy, Radar, Store } from "lucide-react";
import type { Mode } from "../hooks/useBackend";
import type { Theme } from "../hooks/useTheme";
import { gsap, d } from "../lib/motion";
import { Dot, Kbd, cx } from "./ui";

export type View = "arena" | "catalog" | "redteam" | "scoreboard";

export const VIEWS: { id: View; label: string; short: string; icon: typeof Radar; key: string }[] = [
  { id: "arena", label: "Arena", short: "Arena", icon: Radar, key: "1" },
  { id: "catalog", label: "Catalog", short: "Catalog", icon: Store, key: "2" },
  { id: "redteam", label: "Red team", short: "Red team", icon: Swords, key: "3" },
  { id: "scoreboard", label: "Scoreboard", short: "Scores", icon: Trophy, key: "4" },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-brand-ink shadow-[inset_0_-1px_0_rgb(0_0_0/0.3)]">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.1a1.5 1.5 0 0 0 1.5-1.1L20 8H6.2" />
          <path d="M10.5 10.8l2 2 3.5-3.6" />
          <circle cx="9.5" cy="19.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="19.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">CartTrap</span>
    </span>
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
      title="Toggle theme"
      className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <span className="inline-flex">{theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}</span>
    </button>
  );
}

function ModeSwitch({ mode, online, onChange }: { mode: Mode; online: boolean | null; onChange: (m: Mode) => void }) {
  return (
    <div className="flex items-center rounded-lg bg-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)]" role="radiogroup" aria-label="Data source">
      {(["live", "replay"] as Mode[]).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          title={m === "live" ? (online ? "Backend is up. Runs hit the real agents." : "Backend offline at :8000") : "Play recorded runs. Works with no network."}
          className={cx(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium capitalize transition-all",
            mode === m ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
          )}
        >
          {m === "live" && <Dot tone={online ? "safe" : online === false ? "danger" : "neutral"} pulse={!!online && mode === "live"} />}
          {m}
        </button>
      ))}
    </div>
  );
}

export function Header({
  view,
  onView,
  theme,
  onTheme,
  mode,
  online,
  onMode,
}: {
  view: View;
  onView: (v: View) => void;
  theme: Theme;
  onTheme: () => void;
  mode: Mode;
  online: boolean | null;
  onMode: (m: Mode) => void;
}) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
        <div className="mx-auto flex h-14 max-w-[1920px] items-center gap-3 px-3 sm:px-5">
          <a href="#/arena" onClick={() => onView("arena")} className="shrink-0" aria-label="CartTrap home">
            <Logo />
          </a>
          <span className="hidden text-xs text-ink-3 lg:inline">Execution firewall for AI shopping agents</span>

          <nav className="mx-auto hidden md:flex" aria-label="Views">
            <div className="flex items-center gap-0.5 rounded-[10px] bg-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
              {VIEWS.map((v) => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => onView(v.id)}
                    aria-current={view === v.id ? "page" : undefined}
                    className={cx(
                      "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-all",
                      view === v.id ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
                    )}
                  >
                    <Icon className="size-4" />
                    {v.label}
                    <span className="hidden xl:inline-flex">
                      <Kbd>{v.key}</Kbd>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <ModeSwitch mode={mode} online={online} onChange={onMode} />
            <ThemeToggle theme={theme} onToggle={onTheme} />
          </div>
        </div>
      </header>

      {/* phone: thumb-reach tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Views"
      >
        <div className="grid h-16 grid-cols-4">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button
                key={v.id}
                onClick={() => onView(v.id)}
                aria-current={on ? "page" : undefined}
                className={cx("relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", on ? "text-ink" : "text-ink-3")}
              >
                {on && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-brand" />}
                <Icon className="size-5" />
                {v.short}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
