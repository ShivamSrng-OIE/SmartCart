import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { MODES, MORE, type View } from "./Header";
import { gsap, useGSAP, d } from "../lib/motion";
import { cx } from "./ui";

const DETAIL: Record<string, { body: string; see: string[]; tone: "neutral" | "danger" | "safe" }> = {
  shop: {
    body: "Search real Shopify products, check what each store sells, and build your own cart. No AI involved.",
    see: ["Live product search", "Your cart and a real store checkout"],
    tone: "neutral",
  },
  unprotected: {
    body: "Tell an AI what to buy and show it a photo. A note hidden in the photo can make it buy the wrong thing.",
    see: ["Every step the AI takes", "What it tried to buy, and what that would cost"],
    tone: "danger",
  },
  protected: {
    body: "The same AI, but CartTrap checks every purchase first. It blocks the trick, explains why, and finds a safe option.",
    see: ["The decision in about 0.2 seconds", "Why it was stopped, money saved, a safe swap"],
    tone: "safe",
  },
};

export function HomePage({ onView }: { onView: (v: View) => void }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      gsap.from("[data-hero] > *", { y: 14, opacity: 0, stagger: 0.07, duration: d(0.6), ease: "power3.out" });
      gsap.from("[data-mode]", { y: 22, opacity: 0, stagger: 0.09, duration: d(0.65), ease: "power3.out", delay: 0.15 });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-2 sm:gap-8 sm:py-6">
      <div data-hero className="max-w-3xl">
        <p className="label">CartTrap</p>
        <h1 className="mt-2 text-[32px] leading-[1.1] font-semibold tracking-[-0.025em] sm:text-5xl">Can an AI shopper be tricked into buying the wrong thing?</h1>
        <p className="mt-3 text-[15px] text-ink-2 sm:text-lg">Try it three ways. Same Shopify products, same request, very different results.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3 md:gap-4">
        {MODES.map((m) => {
          const info = DETAIL[m.id];
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              data-mode
              onClick={() => onView(m.id)}
              className="group card flex flex-col p-5 text-left transition-shadow hover:shadow-[0_0_0_1px_var(--line-strong),0_16px_32px_-20px_rgb(0_0_0/0.35)] sm:p-6"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-7 items-center justify-center rounded-full bg-ink font-mono text-xs font-semibold text-ink-inverse">{m.key}</span>
                <Icon className={cx("size-6", info.tone === "danger" ? "text-danger" : info.tone === "safe" ? "text-safe" : "text-ink-3")} />
              </div>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">{m.label}</h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{info.body}</p>
              <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4">
                {info.see.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-[13px] text-ink-2">
                    <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", info.tone === "danger" ? "bg-danger" : info.tone === "safe" ? "bg-safe" : "bg-ink-3")} />
                    {s}
                  </li>
                ))}
              </ul>
              <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                Start <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <p className="label">Also</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {MORE.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.id} onClick={() => onView(m.id)} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-left transition-colors hover:bg-surface">
                <Icon className="size-4 shrink-0 text-ink-3" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{m.label}</span>
                  <span className="block truncate text-xs text-ink-3">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
