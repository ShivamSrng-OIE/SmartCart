import { useRef } from "react";
import type { Verdict } from "../types";
import { ms } from "../lib/format";
import { countTo, gsap, useGSAP, d } from "../lib/motion";
import { cx } from "./ui";

const TIER_LABEL: Record<string, string> = {
  low: "Small cart (under $40), so promo stickers are tolerated",
  normal: "Normal cart",
  high: "Large cart (over $150), so the checks are strict",
  spend_request: "Outside payment request, so nothing is trusted",
};

export function VerdictBanner({ verdict, checking, size = "lg" }: { verdict?: Verdict; checking: boolean; size?: "lg" | "md" }) {
  const wordRef = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLSpanElement>(null);

  const word = !verdict
    ? checking
      ? "Checking"
      : "Waiting"
    : verdict.error
      ? "Blocked to be safe"
      : verdict.action === "approve_checkout"
        ? "Approved"
        : verdict.action === "escalate_to_neon_swap"
          ? "Escalated"
          : "Blocked";
  const tone = !verdict ? "neutral" : verdict.error || verdict.action === "hard_block_quarantine" ? "danger" : verdict.action === "approve_checkout" ? "safe" : "warn";
  const sub = !verdict
    ? checking
      ? "The shopper wants to buy something. CartTrap checks it first."
      : "Run a test. Before any purchase reaches Shopify, CartTrap decides here."
    : verdict.error
      ? `The check couldn’t finish (${verdict.error}), so CartTrap blocked the purchase to be safe.`
      : verdict.action === "approve_checkout"
        ? "The cart matches what you asked for, so the purchase goes through."
        : verdict.action === "escalate_to_neon_swap"
          ? "The photo doesn’t match the real listing, so CartTrap offers an honest swap."
          : "The photo was giving the agent orders. The purchase never reached Shopify.";

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
        <p className="label mb-1">CartTrap’s decision</p>
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
            <dt className="label">Decided in</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
              <span ref={latRef}>{Math.round(verdict.latency_ms)}</span>
              <span className="ml-0.5 text-sm font-medium text-ink-3">ms</span>
            </dd>
          </div>
          <div>
            <dt className="label" title="Model probability that this purchase is safe to approve. Needs 92% or more.">Safe score</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">{approveP != null ? `${Math.round(approveP * 100)}%` : "—"}</dd>
          </div>
          <div>
            <dt className="label">Threat level</dt>
            <dd className="tnum mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
              {verdict.severity}
              <span className="text-sm font-medium text-ink-3">/3</span>
            </dd>
          </div>
          <dd className="col-span-3 mt-1 font-mono text-[11px] text-ink-3">
            {TIER_LABEL[verdict.tier] ?? verdict.tier} · needs 92% to approve{verdict.latency_ms > 400 && ` · slow (${ms(verdict.latency_ms)})`}
          </dd>
        </dl>
      )}
    </div>
  );
}
