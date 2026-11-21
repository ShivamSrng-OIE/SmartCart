import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { InputBar } from "./InputBar";
import { TracePane } from "./TracePane";
import { Seismograph } from "./Seismograph";
import { VerdictBanner } from "./VerdictBanner";
import { FraudCard } from "./FraudCard";
import { Button, Dot, Segmented, cx } from "./ui";
import { useArena } from "../hooks/useArena";
import type { Mode } from "../hooks/useBackend";
import type { RuleSet } from "../types";
import type { PaneState } from "../state";
import { clock, money } from "../lib/format";
import type { ProductRef } from "../catalog";

function VictimFooter({ pane }: { pane: PaneState }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-ink-2">Attempted spend</span>
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
  return <span ref={ref} className="tnum font-mono text-xs text-ink-3" />;
}

export function Arena({
  mode,
  rules,
  onSwitchToReplay,
  product,
  onProduct,
}: {
  mode: Mode;
  rules: RuleSet;
  onSwitchToReplay: () => void;
  product: ProductRef | null;
  onProduct: (p: ProductRef | null) => void;
}) {
  const { state, phase, error, startedAt, run, reset } = useArena(mode);
  const [mobilePane, setMobilePane] = useState<"victim" | "guarded">("victim");
  const fwRef = useRef<HTMLElement>(null);
  const busy = phase === "starting" || phase === "streaming";
  const checking = busy && !state.verdict && state.guarded.status !== "idle";

  // On narrow screens, bring the verdict into view as soon as a run starts.
  useEffect(() => {
    if (phase === "streaming" && window.innerWidth < 1024) fwRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase]);

  const victimStatus = state.victim.status;
  const guardedStatus = state.guarded.status;

  return (
    <div className="flex flex-col gap-3 sm:gap-4 2xl:h-[calc(100dvh-56px-40px)]">
      <InputBar mode={mode} busy={busy} onRun={run} onReset={reset} canReset={phase !== "idle"} product={product} onProduct={onProduct} />

      {error && (
        <div className="flex flex-col gap-2 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold">Couldn’t run live.</span> {error}
            </span>
          </p>
          <Button size="sm" onClick={onSwitchToReplay}>
            Use the recorded run
          </Button>
        </div>
      )}

      <div
        className={cx(
          "grid min-h-0 flex-1 grid-cols-1 gap-3 sm:gap-4",
          "md:grid-cols-2 md:[grid-template-areas:'fw_fw'_'fraud_fraud'_'victim_guarded']",
          "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:[grid-template-areas:'victim_fw'_'guarded_fraud']",
          "2xl:grid-cols-[minmax(0,5fr)_minmax(0,6.2fr)_minmax(0,5fr)] 2xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] 2xl:[grid-template-areas:'victim_fw_fraud'_'guarded_fw_fraud']",
        )}
      >
        {/* Firewall: verdict + seismograph */}
        <section ref={fwRef} className="card scroll-mt-20 p-4 sm:p-5 md:[grid-area:fw] 2xl:min-h-0 2xl:overflow-y-auto thin-scroll" aria-label="Firewall">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Dot tone={state.verdict ? (guardedStatus === "approved" ? "safe" : guardedStatus === "escalated" ? "warn" : "danger") : "neutral"} pulse={checking} />
              <span className="text-[13px] font-medium">Decisions firewall</span>
              <span className="hidden text-xs text-ink-3 sm:inline">· checks every money-moving call</span>
            </div>
            <RunClock startedAt={startedAt} live={busy} />
          </div>
          <VerdictBanner verdict={state.verdict} checking={checking || phase === "starting"} />
          <div className="mt-5">
            <Seismograph rules={rules} verdict={state.verdict} checking={checking} />
          </div>
        </section>

        {/* Fraud card */}
        <FraudCard
          card={state.fraudCard}
          verdict={state.verdict}
          status={guardedStatus}
          attempted={state.victim.attempted}
          className="md:[grid-area:fraud] 2xl:min-h-0"
        />

        {/* Traces — tablets and up */}
        <TracePane
          variant="victim"
          pane={state.victim}
          products={state.products}
          className="hidden md:flex md:[grid-area:victim] md:max-h-[520px] lg:max-h-none 2xl:min-h-0"
          footer={<VictimFooter pane={state.victim} />}
        />
        <TracePane variant="guarded" pane={state.guarded} products={state.products} className="hidden md:flex md:[grid-area:guarded] md:max-h-[520px] lg:max-h-none 2xl:min-h-0" />

        {/* Traces — phones */}
        <div className="flex flex-col gap-2 md:hidden">
          <Segmented
            value={mobilePane}
            onChange={setMobilePane}
            className="w-full"
            options={[
              {
                value: "victim",
                label: (
                  <>
                    <Dot tone={victimStatus === "hijacked" ? "danger" : "neutral"} /> Unprotected
                  </>
                ),
              },
              {
                value: "guarded",
                label: (
                  <>
                    <Dot tone={guardedStatus === "approved" ? "safe" : guardedStatus === "blocked" || guardedStatus === "firewall_error" ? "danger" : guardedStatus === "escalated" ? "warn" : "neutral"} />{" "}
                    Protected
                  </>
                ),
              },
            ]}
          />
          {mobilePane === "victim" ? (
            <TracePane variant="victim" pane={state.victim} products={state.products} compact footer={<VictimFooter pane={state.victim} />} />
          ) : (
            <TracePane variant="guarded" pane={state.guarded} products={state.products} compact />
          )}
        </div>
      </div>
    </div>
  );
}
