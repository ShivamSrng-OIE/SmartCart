import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { RequestPanel } from "./RequestPanel";
import { useDraft } from "../draft";
import { TracePane } from "./TracePane";
import { Seismograph } from "./Seismograph";
import { VerdictBanner } from "./VerdictBanner";
import { FraudCard } from "./FraudCard";
import { OutcomeStrip } from "./OutcomeStrip";
import { Button, Segmented, StepHeading, cx } from "./ui";
import { useArena } from "../hooks/useArena";
import type { Mode } from "../hooks/useBackend";
import type { RuleSet } from "../types";
import type { PaneState } from "../state";
import { clock, money } from "../lib/format";

function VictimFooter({ pane }: { pane: PaneState }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-ink-2">Order total</span>
      <span className={cx("tnum text-lg font-semibold tracking-tight", pane.status === "hijacked" ? "text-danger" : "text-ink")}>{money(pane.attempted || null)}</span>
    </div>
  );
}

function RunClock({ startedAt, live }: { startedAt: number | null; live: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!startedAt) {
      if (ref.current) ref.current.textContent = clock(0);
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
  return <span ref={ref} className="tnum text-xs text-ink-3" title="Time since you pressed Run" />;
}

export function Arena({
  mode,
  rules,
}: {
  mode: Mode;
  rules: RuleSet;
}) {
  const { intent, fixture, toForm } = useDraft();
  const { state, phase, error, startedAt, run, reset } = useArena(mode);
  const [tab, setTab] = useState<"checks" | "log">("checks");
  const resultRef = useRef<HTMLDivElement>(null);
  const busy = phase === "starting" || phase === "streaming";
  const checking = busy && !state.verdict && state.guarded.status !== "idle";

  // On narrow screens, bring the result into view as soon as a run starts.
  useEffect(() => {
    if (phase === "streaming" && window.innerWidth < 1024) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase]);

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* 1 · set up */}
      <header>
        <p className="label">Compare</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Assistant and Safe Checkout, side by side</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2 sm:text-[15px]">One request, sent to both at once.</p>
      </header>
      <RequestPanel wide mode={mode} busy={busy} onRun={() => run({ form: toForm(), intent, fixture })} onReset={reset} canReset={phase !== "idle"} title="Your request" runLabel="Ask both" />

      {error && (
        <div className="flex flex-col gap-2 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold">The assistant didn’t respond.</span> Please try again in a moment.
            </span>
          </p>
          <Button size="sm" onClick={() => run({ form: toForm(), intent, fixture })}>
            Try again
          </Button>
        </div>
      )}

      {/* 2 · result at a glance */}
      <div ref={resultRef} className="flex scroll-mt-20 flex-col gap-2.5">
        <StepHeading n={2} title="Result" hint={phase === "idle" ? "" : "Same request, both assistants"} aside={<RunClock startedAt={startedAt} live={busy} />} />
        <OutcomeStrip state={state} phase={phase} />
      </div>

      {/* 3 · details */}
      <div className="flex flex-col gap-2.5">
        <StepHeading n={3} title="Details" />
        <div
          className={cx(
            "grid grid-cols-1 gap-3 sm:gap-4",
            "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:[grid-template-areas:'victim_decide'_'why_why']",
            "2xl:h-[calc(100dvh-140px)] 2xl:min-h-[640px] 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6.4fr)_minmax(0,5fr)] 2xl:[grid-template-areas:'victim_decide_why']",
          )}
        >
          {/* Without CartTrap */}
          <TracePane
            variant="victim"
            pane={state.victim}
            products={state.products}
            className="order-3 max-h-[560px] lg:order-none lg:max-h-[720px] lg:[grid-area:victim] 2xl:max-h-none 2xl:min-h-0"
            footer={<VictimFooter pane={state.victim} />}
          />

          {/* With CartTrap: decision + checks / step log */}
          <section className="card order-1 flex min-h-0 flex-col overflow-hidden lg:order-none lg:[grid-area:decide]" aria-label="Verification">
            <header className="border-b border-line px-4 py-3 sm:px-5">
              <p className="label">Safe Checkout</p>
              <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">Verification</h2>
            </header>
            <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-5">
              <VerdictBanner verdict={state.verdict} checking={checking || phase === "starting"} />
              <div className="mt-5 mb-4 flex items-center justify-between gap-3">
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
                <Seismograph rules={rules} verdict={state.verdict} checking={checking} />
              ) : (
                <TracePane variant="guarded" pane={state.guarded} products={state.products} bare className="-mx-1" />
              )}
            </div>
          </section>

          {/* Why it was stopped */}
          <FraudCard
            card={state.fraudCard}
            evidence={state.guarded.evidence}
            finished={state.guarded.finished}
            verdict={state.verdict}
            status={state.guarded.status}
            attempted={state.victim.attempted}
            className="order-2 lg:order-none lg:[grid-area:why] 2xl:min-h-0"
          />
        </div>
      </div>
    </div>
  );
}
