import { useRef } from "react";
import type { Verdict } from "../types";
import { ms } from "../lib/format";
import { countTo, gsap, useGSAP, d } from "../lib/motion";
import { cx } from "./ui";

const TIER_LABEL: Record<string, string> = {
  low: "Small order (under $40)",
  normal: "Standard order",
  high: "Large order (over $150), stricter checks",
  spend_request: "External payment request",
};

export function VerdictBanner({ verdict, checking, size = "lg" }: { verdict?: Verdict; checking: boolean; size?: "lg" | "md" }) {
  const wordRef = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLSpanElement>(null);

  const word = !verdict
    ? checking
      ? "Verifying"
      : "Waiting"
    : verdict.error
      ? "On hold"
      : verdict.action === "approve_checkout"
        ? "Verified"
        : verdict.action === "escalate_to_neon_swap"
          ? "Better match"
          : "Held";
  const tone = !verdict ? "neutral" : verdict.error || verdict.action === "hard_block_quarantine" ? "danger" : verdict.action === "approve_checkout" ? "safe" : "warn";
  const sub = !verdict
    ? checking
      ? "Checking the order against your request and the store listing."
      : "Every order is verified here before it’s placed."
    : verdict.error
      ? `Verification couldn’t finish (${verdict.error}), so the order is on hold.`
      : verdict.action === "approve_checkout"
        ? "The order matches what you asked for."
        : verdict.action === "escalate_to_neon_swap"
          ? "The photo doesn’t match the store listing, so we suggested a better match."
          : "The order didn’t match your request, so it wasn’t placed.";

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
        <p className="label mb-1">Status</p>
        <div className="overflow-hidden">
          <div
            ref={wordRef}
            className={cx(
              size === "lg" ? "text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-5xl xl:text-[56px]" : "text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[40px]",
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
            <dt className="label">Checked in</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
              <span ref={latRef}>{Math.round(verdict.latency_ms)}</span>
              <span className="ml-0.5 text-sm font-medium text-ink-3">ms</span>
            </dd>
          </div>
          <div>
            <dt className="label" title="Confidence that the order is fine to place. Needs 92% or more.">Confidence</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">{approveP != null ? `${Math.round(approveP * 100)}%` : "—"}</dd>
          </div>
          <div>
            <dt className="label">Risk</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
              {verdict.severity}
              <span className="text-sm font-medium text-ink-3">/3</span>
            </dd>
          </div>
          <dd className="col-span-3 mt-1 text-[11px] text-ink-3">
            {TIER_LABEL[verdict.tier] ?? verdict.tier} · needs 92% confidence{verdict.latency_ms > 400 && ` · slow (${ms(verdict.latency_ms)})`}
          </dd>
        </dl>
      )}
    </div>
  );
}
