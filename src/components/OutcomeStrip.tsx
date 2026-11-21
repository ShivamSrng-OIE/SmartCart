import { useRef } from "react";
import { MousePointerClick, Play, Columns2, ShieldAlert, ShieldCheck, ShieldX, Loader2, ShoppingCart } from "lucide-react";
import type { ArenaState, Step } from "../state";
import { money, shortId } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { cx } from "./ui";

type Tone = "neutral" | "danger" | "safe" | "warn";

const TONE_TEXT: Record<Tone, string> = { neutral: "text-ink", danger: "text-danger", safe: "text-safe", warn: "text-warn" };
const TONE_EDGE: Record<Tone, string> = { neutral: "before:bg-line-strong", danger: "before:bg-danger", safe: "before:bg-safe", warn: "before:bg-warn" };

/** "50 × Alder & Oak Cold Brew… for $999.50" from the victim's last intercepted call. */
export function describeCall(step: Step | undefined, products: ArenaState["products"]): string | null {
  if (!step) return null;
  const args = step.args ?? {};
  if (step.title.includes("spend_request")) return `a ${money(step.spend)} payment to an outside card`;
  const lines = (args.lines ?? args.line_items) as Record<string, unknown>[] | undefined;
  const first = Array.isArray(lines) ? lines[0] : undefined;
  const title = first ? ((products[String(first.product_id ?? "")]?.title as string | undefined) ?? shortId(first.product_id)) : null;
  const qty = step.quantity ?? (first?.quantity as number | undefined);
  if (!title) return step.spend != null ? money(step.spend) : null;
  return `${qty ?? 1} × ${title}${step.spend != null ? ` for ${money(step.spend)}` : ""}`;
}

function OutcomeCard({ eyebrow, icon, headline, detail, tone, pending }: { eyebrow: string; icon: React.ReactNode; headline: string; detail: string; tone: Tone; pending?: boolean }) {
  return (
    <div
      data-outcome
      className={cx(
        "card relative overflow-hidden p-3.5 before:absolute before:inset-y-0 before:left-0 before:w-1 sm:p-4 sm:pl-5",
        TONE_EDGE[tone],
      )}
    >
      <p className="label">{eyebrow}</p>
      <div className={cx("mt-1.5 flex items-center gap-2", TONE_TEXT[tone])}>
        {pending ? <Loader2 className="size-5 shrink-0 animate-spin text-ink-3" /> : icon}
        <p data-headline className="text-lg leading-tight font-semibold tracking-tight sm:text-2xl">
          {headline}
        </p>
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] text-ink-2 sm:text-sm">{detail}</p>
    </div>
  );
}

export function OutcomeStrip({ state, phase }: { state: ArenaState; phase: "idle" | "starting" | "streaming" | "done" | "error" }) {
  const root = useRef<HTMLDivElement>(null);
  const v = state.victim;
  const g = state.guarded;
  const verdict = state.verdict;
  const lastIntercept = [...v.steps].reverse().find((s) => s.kind === "intercepted");
  const call = describeCall(lastIntercept, state.products);

  useGSAP(
    () => {
      root.current?.querySelectorAll("[data-headline]").forEach((el) => {
        gsap.fromTo(el, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.35), ease: "power2.out" });
      });
    },
    { scope: root, dependencies: [v.status, g.status] },
  );

  // Before the first run: tell people how to read the page.
  if (phase === "idle") {
    const steps = [
      { icon: MousePointerClick, title: "Describe it", body: "Pick an example, or show a product and type what you need." },
      { icon: Play, title: "Ask both", body: "The same request goes to both assistants." },
      { icon: Columns2, title: "Compare", body: "Left is the regular assistant. Right uses Safe Checkout." },
    ];
    return (
      <div ref={root} className="card grid gap-3 p-3.5 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line sm:p-0">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="flex items-start gap-3 sm:p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">{i + 1}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <Icon className="size-3.5 text-ink-3" /> {s.title}
                </p>
                <p className="text-[13px] text-ink-2">{s.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Without CartTrap
  let left: { headline: string; detail: string; tone: Tone; icon: React.ReactNode; pending?: boolean };
  if (v.status === "hijacked") left = { headline: "Unexpected order", detail: call ? `Put together ${call}.` : "The order doesn’t match the request.", tone: "danger", icon: <ShieldX className="size-5 shrink-0" /> };
  else if (v.status === "intercepted") left = { headline: "Cart ready", detail: call ? `${call}.` : "The cart matched the request.", tone: "neutral", icon: <ShoppingCart className="size-5 shrink-0" /> };
  else if (v.status === "idle" || v.status === "running") left = { headline: "Working on it…", detail: "Searching Shopify and looking at the photo.", tone: "neutral", icon: null, pending: true };
  else left = { headline: "Finished", detail: "No purchase attempted.", tone: "neutral", icon: <ShoppingCart className="size-5 shrink-0" /> };
  if (v.finished && v.status === "running") left = { headline: "No purchase", detail: "The shopper stopped without making a cart.", tone: "neutral", icon: <ShoppingCart className="size-5 shrink-0" /> };

  // With CartTrap
  let right: { headline: string; detail: string; tone: Tone; icon: React.ReactNode; pending?: boolean };
  const saved = state.fraudCard?.dollars_defended;
  if (!verdict) right = { headline: "Verifying…", detail: "The order is checked before it’s placed.", tone: "neutral", icon: null, pending: true };
  else if (verdict.error) right = { headline: "On hold", detail: `Verification unavailable (${verdict.error}).`, tone: "warn", icon: <ShieldAlert className="size-5 shrink-0" /> };
  else if (verdict.action === "approve_checkout") right = { headline: "Order verified", detail: `Checked in ${Math.round(verdict.latency_ms)} ms.`, tone: "safe", icon: <ShieldCheck className="size-5 shrink-0" /> };
  else if (verdict.action === "escalate_to_neon_swap")
    right = { headline: "Better match suggested", detail: `The photo didn’t match the listing.${saved ? ` ${money(saved)} protected.` : ""}`, tone: "safe", icon: <ShieldCheck className="size-5 shrink-0" /> };
  else
    right = {
      headline: "Held for review",
      detail: `Checked in ${Math.round(verdict.latency_ms)} ms${saved ? `, ${money(saved)} protected` : ""}${state.fraudCard?.safe_cart ? ", alternative suggested." : "."}`,
      tone: "safe",
      icon: <ShieldCheck className="size-5 shrink-0" />,
    };

  return (
    <div ref={root} className="grid grid-cols-2 gap-2.5 sm:gap-4">
      <OutcomeCard eyebrow="Assistant" {...left} />
      <OutcomeCard eyebrow="Safe Checkout" {...right} />
    </div>
  );
}
