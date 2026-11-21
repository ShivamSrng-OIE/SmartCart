import { useRef } from "react";
import type { Verdict } from "../types";
import { ms, prob } from "../lib/format";
import { countTo, gsap, useGSAP, d } from "../lib/motion";
import { cx } from "./ui";

const TIER_LABEL: Record<string, string> = {
  low: "Low tier · under $40",
  normal: "Normal tier",
  high: "High tier · over $150",
  spend_request: "Spend request · zero trust",
};

export function VerdictBanner({ verdict, checking }: { verdict?: Verdict; checking: boolean }) {
  const wordRef = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLSpanElement>(null);

  const word = !verdict
    ? checking
      ? "Watching"
      : "Standing by"
    : verdict.error
      ? "Failed closed"
      : verdict.action === "approve_checkout"
        ? "Approved"
        : verdict.action === "escalate_to_neon_swap"
          ? "Escalated"
          : "Blocked";
  const tone = !verdict ? "neutral" : verdict.error || verdict.action === "hard_block_quarantine" ? "danger" : verdict.action === "approve_checkout" ? "safe" : "warn";
  const sub = !verdict
    ? checking
      ? "Every money-moving call is checked before it reaches Shopify."
      : "Run a scenario to see the firewall decide."
    : verdict.error
      ? `The firewall could not answer (${verdict.error}). CartTrap blocks by default.`
      : verdict.action === "approve_checkout"
        ? "The cart matches what you asked for. It goes through."
        : verdict.action === "escalate_to_neon_swap"
          ? "The listing doesn't match the media. Neon is finding an honest swap."
          : "Prompt injection in the media. The call never reached Shopify.";

  useGSAP(
    () => {
      if (!wordRef.current) return;
      if (verdict) {
        gsap.fromTo(
          wordRef.current,
          { yPercent: 60, opacity: 0, filter: "blur(6px)" },
          { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: d(0.55), ease: "expo.out" },
        );
        countTo(latRef.current, verdict.latency_ms, (n) => `${Math.round(n)}`, { duration: 0.6 });
      } else {
        gsap.fromTo(wordRef.current, { opacity: 0 }, { opacity: 1, duration: d(0.3) });
      }
    },
    { dependencies: [verdict, checking] },
  );

  const approveP = verdict?.action_probs?.approve_checkout;

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="label mb-1">Firewall verdict</p>
        <div className="overflow-hidden">
          <div
            ref={wordRef}
            className={cx(
              "text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-5xl xl:text-[56px]",
              tone === "danger" ? "text-danger" : tone === "safe" ? "text-safe" : tone === "warn" ? "text-warn" : "text-ink-3",
            )}
          >
            {word}
            {checking && !verdict && <span className="ml-1 inline-block animate-pulse">…</span>}
          </div>
        </div>
        <p className="mt-1.5 max-w-xl text-sm text-ink-2 sm:text-[15px]">{sub}</p>
      </div>

      {verdict && (
        <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-right sm:gap-x-7">
          <div>
            <dt className="label">Decision</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
              <span ref={latRef}>{Math.round(verdict.latency_ms)}</span>
              <span className="ml-0.5 text-sm font-medium text-ink-3">ms</span>
            </dd>
          </div>
          <div>
            <dt className="label">P(approve)</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">{prob(approveP)}</dd>
          </div>
          <div>
            <dt className="label">Severity</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
              {verdict.severity}
              <span className="text-sm font-medium text-ink-3">/3</span>
            </dd>
          </div>
          <dd className="col-span-3 mt-1 font-mono text-[11px] text-ink-3">
            {TIER_LABEL[verdict.tier] ?? verdict.tier} · {verdict.backend} · gate ≥ 0.92 {verdict.latency_ms > 400 && `· slow (${ms(verdict.latency_ms)})`}
          </dd>
        </dl>
      )}
    </div>
  );
}
