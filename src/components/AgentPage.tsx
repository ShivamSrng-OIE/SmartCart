import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Bot, Loader2, ShieldAlert, ShieldCheck, ShieldX, ShoppingCart, TriangleAlert } from "lucide-react";
import { RequestPanel } from "./RequestPanel";
import { TracePane } from "./TracePane";
import { Seismograph } from "./Seismograph";
import { VerdictBanner } from "./VerdictBanner";
import { FraudCard } from "./FraudCard";
import { describeCall } from "./OutcomeStrip";
import { Button, Segmented, cx } from "./ui";
import { useAgentRun } from "../hooks/useAgentRun";
import { useDraft } from "../draft";
import type { AgentKind } from "../config";
import type { Mode } from "../hooks/useBackend";
import type { RuleSet } from "../types";
import { clock, money, shortId } from "../lib/format";
import { ProductThumb } from "./ProductThumb";
import type { ArenaState, Step } from "../state";
import { countTo, gsap, useGSAP, d } from "../lib/motion";

type Tone = "neutral" | "danger" | "safe" | "warn";

const COPY: Record<AgentKind, { step: string; title: string; body: string; models: string[]; run: string; other: string }> = {
  unprotected: {
    step: "Assistant",
    title: "Shopping assistant",
    body: "Tell the assistant what you need. Add a photo of the product if you have one, and it will find it on Shopify and build your cart.",
    models: ["Gemini 4 Hydrogen"],
    run: "Ask the assistant",
    other: "Try it with Safe Checkout",
  },
  protected: {
    step: "Safe Checkout",
    title: "Assistant with Safe Checkout",
    body: "The same assistant. Before any order is placed, Safe Checkout verifies it against your request and the store’s listing.",
    models: ["Gemini 4 Argon", "Decisions API", "Gemini 4 Neon"],
    run: "Ask the assistant",
    other: "Compare with the regular assistant",
  },
};

function RunClock({ startedAt, live }: { startedAt: number | null; live: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!startedAt) {
      if (ref.current) ref.current.textContent = "";
      return;
    }
    if (!live) return;
    let raf = 0;
    const tick = () => {
      if (ref.current) ref.current.textContent = clock(performance.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, live]);
  return <span ref={ref} className="tnum font-mono text-xs text-ink-3" title="Time since you pressed Run" />;
}

/** The cart the assistant put together: item drops in, quantity and total roll up. */
function OrderCard({ step, products, held }: { step: Step; products: ArenaState["products"]; held: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const qtyRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const args = step.args ?? {};
  const lines = (args.lines ?? args.line_items) as Record<string, unknown>[] | undefined;
  const first = Array.isArray(lines) ? lines[0] : undefined;
  const pid = String(first?.product_id ?? (first?.item as Record<string, unknown> | undefined)?.id ?? "");
  const prod = products[pid] as Record<string, unknown> | undefined;
  const title = (prod?.title as string | undefined) ?? (pid ? shortId(pid) : step.title.replace(/_/g, " "));
  const media = Array.isArray(prod?.media) ? (prod!.media as Record<string, unknown>[]) : [];
  const image = (prod?.image_url as string | undefined) ?? (media[0]?.url as string | undefined) ?? null;
  const qty = step.quantity ?? (first?.quantity as number | undefined) ?? 1;
  const total = step.spend ?? null;
  const wrong = step.tone === "danger";

  useGSAP(
    () => {
      const tl = gsap.timeline();
      tl.from(ref.current, { y: -18, opacity: 0, scale: 0.96, duration: d(0.5), ease: "back.out(1.8)" });
      tl.add(() => {
        countTo(qtyRef.current, qty, (n) => String(Math.max(1, Math.round(n))), { from: 1, duration: qty > 5 ? 1.4 : 0.5 });
        if (total != null) countTo(totalRef.current, total, (n) => money(n), { from: total / Math.max(qty, 1), duration: qty > 5 ? 1.4 : 0.5 });
      });
      if (wrong) tl.fromTo(qtyRef.current, { scale: 1 }, { scale: 1.25, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" }, "+=1.3");
      if (held) tl.from("[data-stamp]", { scale: 1.8, rotate: -24, opacity: 0, duration: d(0.45), ease: "back.out(2.2)" }, "+=0.15");
    },
    { scope: ref, dependencies: [step.id] },
  );

  return (
    <div ref={ref} className={cx("relative w-full overflow-hidden rounded-xl border bg-surface p-3 sm:w-[300px]", wrong && !held ? "border-danger-line" : "border-line")}>
      <p className="label mb-2">Order</p>
      <div className="flex items-center gap-3">
        <div className="size-14 shrink-0">
          <ProductThumb product={{ title, image, vendor: (prod?.vendor as string | undefined) ?? null }} className="size-14 rounded-lg" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] leading-snug font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            Qty <span ref={qtyRef} className={cx("tnum inline-block font-semibold", wrong ? "text-danger" : "text-ink")}>{qty}</span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-2.5">
        <span className="text-xs text-ink-3">Total</span>
        <span ref={totalRef} className={cx("tnum text-lg font-semibold tracking-tight", wrong && !held ? "text-danger" : "text-ink")}>
          {money(total)}
        </span>
      </div>
      {held && (
        <span data-stamp className="pointer-events-none absolute top-3 right-3 rotate-[-8deg] rounded-md border-2 border-warn px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest text-warn">
          HELD
        </span>
      )}
    </div>
  );
}

function ResultCard({
  tone,
  icon,
  eyebrow,
  headline,
  body,
  action,
  pending,
  aside,
}: {
  tone: Tone;
  icon: ReactNode;
  eyebrow: string;
  headline: string;
  body: ReactNode;
  action?: ReactNode;
  pending?: boolean;
  aside?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    gsap.fromTo(ref.current!.querySelectorAll("[data-r]"), { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.4), stagger: 0.06, ease: "power2.out" });
  }, { dependencies: [headline] });
  const toneCls = { neutral: "text-ink", danger: "text-danger", safe: "text-safe", warn: "text-warn" }[tone];
  const edge = { neutral: "before:bg-line-strong", danger: "before:bg-danger", safe: "before:bg-safe", warn: "before:bg-warn" }[tone];
  return (
    <section ref={ref} className={cx("card relative flex flex-col gap-4 overflow-hidden p-4 before:absolute before:inset-y-0 before:left-0 before:w-1 sm:flex-row sm:items-start sm:justify-between sm:p-5 sm:pl-6", edge)} aria-live="polite">
      <div className="min-w-0 flex-1">
      <p data-r className="label">
        {eyebrow}
      </p>
      <div data-r className={cx("mt-1.5 flex items-center gap-2.5", toneCls)}>
        {pending ? <Loader2 className="size-6 shrink-0 animate-spin text-ink-3" /> : icon}
        <h2 className="text-2xl leading-tight font-semibold tracking-tight sm:text-[28px]">{headline}</h2>
      </div>
      <div data-r className="mt-1.5 max-w-2xl text-[15px] text-ink-2">
        {body}
      </div>
      {action && (
        <div data-r className="mt-3.5">
          {action}
        </div>
      )}
      </div>
      {aside}
    </section>
  );
}

export function AgentPage({
  kind,
  mode,
  rules,
  onOtherMode,
}: {
  kind: AgentKind;
  mode: Mode;
  rules: RuleSet;
  onOtherMode: () => void;
}) {
  const copy = COPY[kind];
  const { intent, fixture, toForm } = useDraft();
  const { state, phase, error, startedAt, run, reset, pane } = useAgentRun(kind, mode);
  const [tab, setTab] = useState<"review" | "checks" | "log">("log");
  const [tabPicked, setTabPicked] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const busy = phase === "starting" || phase === "streaming";
  const p = state[pane];
  const verdict = state.verdict;
  const checking = busy && !verdict;

  useEffect(() => {
    if (phase === "starting") {
      setTabPicked(false);
      setTab("log");
    }
  }, [phase]);
  useEffect(() => {
    if (!tabPicked && (state.fraudCard || state.verdict?.action === "approve_checkout")) setTab(state.fraudCard ? "review" : "checks");
  }, [state.fraudCard, state.verdict, tabPicked]);

  useEffect(() => {
    if (phase === "starting" && window.innerWidth < 1024) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase]);

  const asked = `${intent.quantity}${intent.budget != null ? ` for ${money(intent.budget)} or less` : ""}`;
  const otherBtn = (
    <Button variant="secondary" size="md" onClick={onOtherMode} trailing={<ArrowRight className="size-4" />}>
      {copy.other}
    </Button>
  );

  // The cart the shopper tried to place: intercepted (Assistant) or the call Safe Checkout checked.
  const orderStep =
    kind === "unprotected"
      ? [...state.victim.steps].reverse().find((x) => x.kind === "intercepted")
      : [...state.guarded.steps].reverse().find((x) => x.kind === "tool_call" && x.verdict && /cart|checkout/.test(x.title));
  const held = kind === "protected" && !!verdict && verdict.action !== "approve_checkout";

  /* ---------------------------------------------------------- the headline */
  let result: Parameters<typeof ResultCard>[0];
  if (phase === "error") {
    result = { tone: "neutral", icon: <Bot className="size-6 shrink-0 text-ink-3" />, eyebrow: "Result", headline: "No order yet", body: "The assistant didn’t respond, so nothing was ordered. Try again in a moment." };
  } else if (kind === "unprotected") {
    const last = [...p.steps].reverse().find((s) => s.kind === "intercepted");
    const call = describeCall(last, state.products);
    if (phase === "idle") result = { tone: "neutral", icon: <Bot className="size-6 shrink-0 text-ink-3" />, eyebrow: "Result", headline: "What can I find for you?", body: "Describe what you need on the left. You’ll see each step the assistant takes and the order it puts together." };
    else if (p.status === "hijacked")
      result = {
        tone: "danger",
        icon: <ShieldX className="size-6 shrink-0" />,
        eyebrow: "Result",
        headline: "This order doesn’t match your request",
        body: (
          <>
            The assistant put together <span className="font-medium text-ink">{call ?? "an order you didn’t ask for"}</span>. You asked for {asked}. Nothing has been charged.
          </>
        ),
        action: otherBtn,
      };
    else if (p.status === "intercepted")
      result = { tone: "neutral", icon: <ShoppingCart className="size-6 shrink-0" />, eyebrow: "Result", headline: "Your cart is ready", body: <>{call ? `${call}.` : "The cart matches your request."} Nothing has been charged yet.</>, action: otherBtn };
    else if (p.finished) result = { tone: "neutral", icon: <ShoppingCart className="size-6 shrink-0" />, eyebrow: "Result", headline: "No order placed", body: "The assistant finished without building a cart." };
    else result = { tone: "neutral", icon: null, pending: true, eyebrow: "Result", headline: "Working on it…", body: "Searching Shopify and looking at your photo." };
  } else {
    const saved = state.fraudCard?.dollars_defended;
    if (phase === "idle") result = { tone: "neutral", icon: <ShieldCheck className="size-6 shrink-0 text-ink-3" />, eyebrow: "Result", headline: "What can I find for you?", body: "Describe what you need on the left. Safe Checkout verifies the order before it’s placed." };
    else if (!verdict) result = { tone: "neutral", icon: null, pending: true, eyebrow: "Result", headline: p.status === "idle" ? "Starting…" : "Working on it…", body: "The assistant is shopping. The order will be verified before it’s placed." };
    else if (verdict.error) result = { tone: "warn", icon: <ShieldAlert className="size-6 shrink-0" />, eyebrow: "Result", headline: "Order on hold", body: `Verification couldn’t finish (${verdict.error}), so the order was held. Nothing was charged.` };
    else if (verdict.action === "approve_checkout")
      result = { tone: "safe", icon: <ShieldCheck className="size-6 shrink-0" />, eyebrow: "Result", headline: "Order verified", body: `Checked in ${Math.round(verdict.latency_ms)} ms. It matches what you asked for (${asked}).`, action: otherBtn };
    else
      result = {
        tone: "safe",
        icon: <ShieldCheck className="size-6 shrink-0" />,
        eyebrow: "Result",
        headline: verdict.action === "escalate_to_neon_swap" ? "We suggested a better match" : "Order held for review",
        body: (
          <>
            The order didn’t match your request, so it wasn’t placed
            {saved ? (
              <>
                {" "}(<span className="font-medium text-ink">{money(saved)}</span> protected)
              </>
            ) : null}
            .{state.fraudCard?.safe_cart ? " We found an alternative that fits." : state.fraudCard ? "" : " Preparing details…"}
          </>
        ),
        action: otherBtn,
      };
  }

  const Intro = ({ className }: { className?: string }) => (
    <header className={cx("flex flex-col gap-1", className)}>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">{copy.title}</h1>
      <p className="max-w-3xl text-sm text-ink-2 sm:text-[15px]">{copy.body}</p>
      <p className="text-xs text-ink-3">Powered by {copy.models.join(" · ")}</p>
    </header>
  );

  const steps = kind === "unprotected" ? state.victim.steps.length : state.guarded.steps.length;

  return (
    <div className="w-full">
      <Intro className="mb-4 lg:hidden" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)] 2xl:grid-cols-[440px_minmax(0,1fr)] 2xl:gap-6">
        <RequestPanel
          mode={mode}
          busy={busy}
          onRun={() => run(toForm(), intent, fixture)}
          onReset={reset}
          canReset={phase !== "idle"}
          runLabel={copy.run}
          className="lg:sticky lg:top-[76px] lg:self-start short:static"
        />

        <div ref={resultRef} className="flex min-w-0 scroll-mt-20 flex-col gap-4">
          <Intro className="hidden lg:flex" />

          {error && (
            <div className="flex flex-col gap-2 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-sm text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-semibold">The assistant didn’t respond.</span> Please try again in a moment.
                </span>
              </p>
              <Button size="sm" onClick={() => run(toForm(), intent, fixture)}>
                Try again
              </Button>
            </div>
          )}

          {/* 1. the outcome, with the order beside it: the only place the money is shown */}
          <ResultCard {...result} aside={orderStep ? <OrderCard step={orderStep} products={state.products} held={held} /> : undefined} />

          {/* 2. one details card with tabs */}
          {phase !== "idle" && !(phase === "error" && steps === 0) && (
            <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Details">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
                {kind === "protected" ? (
                  <Segmented
                    value={tab}
                    onChange={(v) => {
                      setTab(v);
                      setTabPicked(true);
                    }}
                    options={[
                      { value: "review", label: "Review" },
                      { value: "checks", label: `Checks · ${rules.probes.length}` },
                      { value: "log", label: `Activity · ${steps}` },
                    ]}
                  />
                ) : (
                  <h2 className="text-[15px] font-semibold tracking-tight">
                    Activity <span className="tnum text-[13px] font-normal text-ink-3">· {steps} steps</span>
                  </h2>
                )}
                <RunClock startedAt={startedAt} live={busy} />
              </header>
              <div className="min-h-0 p-4 sm:p-5">
                {kind === "unprotected" || tab === "log" ? (
                  <TracePane variant={kind === "unprotected" ? "victim" : "guarded"} pane={kind === "unprotected" ? state.victim : state.guarded} products={state.products} bare quiet className="-mx-1 max-h-[60dvh]" />
                ) : tab === "checks" ? (
                  <div className="flex flex-col gap-5">
                    <VerdictBanner verdict={verdict} checking={checking} size="md" />
                    <Seismograph rules={rules} verdict={verdict} checking={checking} />
                  </div>
                ) : (
                  <FraudCard card={state.fraudCard} evidence={state.guarded.evidence} finished={state.guarded.finished} verdict={verdict} status={state.guarded.status} attempted={state.victim.attempted} bare />
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
