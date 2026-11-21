import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Bot, Loader2, ShieldAlert, ShieldCheck, ShieldX, ShoppingCart, TriangleAlert } from "lucide-react";
import { RequestPanel } from "./RequestPanel";
import { TracePane } from "./TracePane";
import { Seismograph } from "./Seismograph";
import { VerdictBanner } from "./VerdictBanner";
import { FraudCard } from "./FraudCard";
import { describeCall } from "./OutcomeStrip";
import { Button, Chip, Segmented, cx } from "./ui";
import { useAgentRun } from "../hooks/useAgentRun";
import { useDraft } from "../draft";
import type { AgentKind } from "../config";
import type { Mode } from "../hooks/useBackend";
import type { RuleSet } from "../types";
import { clock, money } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";

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

function ResultCard({ tone, icon, eyebrow, headline, body, action, pending }: { tone: Tone; icon: ReactNode; eyebrow: string; headline: string; body: ReactNode; action?: ReactNode; pending?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    gsap.fromTo(ref.current!.querySelectorAll("[data-r]"), { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.4), stagger: 0.06, ease: "power2.out" });
  }, { dependencies: [headline] });
  const toneCls = { neutral: "text-ink", danger: "text-danger", safe: "text-safe", warn: "text-warn" }[tone];
  const edge = { neutral: "before:bg-line-strong", danger: "before:bg-danger", safe: "before:bg-safe", warn: "before:bg-warn" }[tone];
  return (
    <section ref={ref} className={cx("card relative overflow-hidden p-4 before:absolute before:inset-y-0 before:left-0 before:w-1 sm:p-5 sm:pl-6", edge)} aria-live="polite">
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
    </section>
  );
}

export function AgentPage({
  kind,
  mode,
  rules,
  rulesLive,
  onSwitchToReplay,
  onOtherMode,
}: {
  kind: AgentKind;
  mode: Mode;
  rules: RuleSet;
  rulesLive: boolean;
  onSwitchToReplay: () => void;
  onOtherMode: () => void;
}) {
  const copy = COPY[kind];
  const { intent, fixture, toForm } = useDraft();
  const { state, phase, error, startedAt, run, reset, pane } = useAgentRun(kind, mode);
  const [tab, setTab] = useState<"checks" | "log">("checks");
  const resultRef = useRef<HTMLDivElement>(null);
  const busy = phase === "starting" || phase === "streaming";
  const p = state[pane];
  const verdict = state.verdict;
  const checking = busy && !verdict;

  useEffect(() => {
    if (phase === "starting" && window.innerWidth < 1024) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase]);

  const asked = `${intent.quantity}${intent.budget != null ? ` for ${money(intent.budget)} or less` : ""}`;
  const otherBtn = (
    <Button variant="secondary" size="md" onClick={onOtherMode} trailing={<ArrowRight className="size-4" />}>
      {copy.other}
    </Button>
  );

  /* ---------------------------------------------------------- the headline */
  let result: Parameters<typeof ResultCard>[0];
  if (kind === "unprotected") {
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
            The assistant put together <span className="font-medium text-ink">{call ?? "an order you didn’t ask for"}</span>. You asked for {asked}. Sandbox mode, so nothing was charged.
          </>
        ),
        action: otherBtn,
      };
    else if (p.status === "intercepted")
      result = { tone: "neutral", icon: <ShoppingCart className="size-6 shrink-0" />, eyebrow: "Result", headline: "Your cart is ready", body: <>{call ? `${call}.` : "The cart matches your request."} Sandbox mode, so nothing was charged.</>, action: otherBtn };
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

  return (
    <div className="mx-auto w-full max-w-[1600px]">
          <header className="mb-4 flex flex-col gap-2 lg:hidden">
            <div className="min-w-0">
              <p className="label">{copy.step}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{copy.title}</h1>
              <p className="mt-1 max-w-3xl text-sm text-ink-2 sm:text-[15px]">{copy.body}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {copy.models.map((m) => (
                <Chip key={m} className="h-6" mono={false}>
                  {m}
                </Chip>
              ))}
            </div>
          </header>
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]">
        <RequestPanel
          mode={mode}
          busy={busy}
          onRun={() => run(toForm(), intent, fixture)}
          onReset={reset}
          canReset={phase !== "idle"}
          runLabel={copy.run}
          className="lg:sticky lg:top-[76px] lg:self-start"
        />

        <div ref={resultRef} className="flex min-w-0 scroll-mt-20 flex-col gap-4">
          <header className="hidden flex-col gap-2 lg:flex xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <p className="label">{copy.step}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{copy.title}</h1>
              <p className="mt-1 max-w-3xl text-sm text-ink-2 sm:text-[15px]">{copy.body}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {copy.models.map((m) => (
                <Chip key={m} className="h-6" mono={false}>
                  {m}
                </Chip>
              ))}
            </div>
          </header>
          {error && (
            <div className="flex flex-col gap-2 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-sm text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-semibold">The assistant isn’t responding.</span> {error}
                </span>
              </p>
              <Button size="sm" onClick={onSwitchToReplay}>
                Use sample data
              </Button>
            </div>
          )}

          <div className="relative">
            <span className="absolute top-3 right-4 z-10">
              <RunClock startedAt={startedAt} live={busy} />
            </span>
            <ResultCard {...result} />
          </div>

          {kind === "unprotected" ? (
            <TracePane
              variant="victim"
              pane={state.victim}
              products={state.products}
              className="max-h-[70dvh] min-h-[320px]"
              footer={
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-ink-2">Order total</span>
                  <span className={cx("tnum text-lg font-semibold tracking-tight", state.victim.status === "hijacked" ? "text-danger" : "text-ink")}>{money(state.victim.attempted || null)}</span>
                </div>
              }
            />
          ) : (
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Verification">
                <header className="border-b border-line px-4 py-3 sm:px-5">
                  <h2 className="text-[15px] font-semibold tracking-tight">Verification</h2>
                </header>
                <div className="flex flex-col p-4 sm:p-5">
                  <VerdictBanner verdict={verdict} checking={checking} size="md" />
                  <div className="mt-5 mb-4">
                    <Segmented
                      value={tab}
                      onChange={setTab}
                      options={[
                        { value: "checks", label: `Checks · ${rules.probes.length}` },
                        { value: "log", label: `Activity · ${state.guarded.steps.length}` },
                      ]}
                    />
                  </div>
                  {tab === "checks" ? (
                    <Seismograph rules={rules} rulesLive={rulesLive} verdict={verdict} checking={checking} />
                  ) : (
                    <TracePane variant="guarded" pane={state.guarded} products={state.products} bare className="-mx-1 max-h-[60dvh]" />
                  )}
                </div>
              </section>
              <FraudCard card={state.fraudCard} verdict={verdict} status={state.guarded.status} attempted={state.victim.attempted} className="2xl:self-start" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
