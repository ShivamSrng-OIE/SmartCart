import { useRef } from "react";
import { Quote, ShieldCheck } from "lucide-react";
import type { EvidenceItem, FraudCard as FraudCardT, Verdict } from "../types";
import type { PaneStatus } from "../state";
import { checkLabel, money, prob } from "../lib/format";
import { countTo, gsap, useGSAP, d } from "../lib/motion";
import { Evidence } from "./Evidence";
import { SafeCart } from "./SafeCart";
import { cx } from "./ui";

const SELLS_KEYS: [string, string][] = [
  ["title", "Listing"],
  ["price", "Price"],
  ["units", "Units"],
  ["pack_size", "Pack size"],
  ["quantity", "Quantity"],
  ["vendor", "Vendor"],
];

function fmtSells(key: string, v: unknown): string {
  if (key === "price") {
    const n = typeof v === "object" && v ? Number((v as Record<string, unknown>).amount) : Number(v);
    return Number.isFinite(n) ? money(n) : String(v);
  }
  return String(v);
}

const AGENT_RE = /\b(agent|agents|AI shop|bot|assistant|set quantity|qty|spend[_ ]request|promo[_ ]code)\b/i;

function rankClaims(lines: string[], evidence: EvidenceItem[]): { text: string; hidden: boolean }[] {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const needles = evidence.map((e) => norm(e.modality === "audio" ? e.transcript : e.text)).filter((x) => x.length > 2);
  const rows = lines.map((text) => {
    const n = norm(text);
    const hidden = AGENT_RE.test(text) || (n.length > 2 && needles.some((m) => m.includes(n) || n.includes(m)));
    return { text, hidden };
  });
  return [...rows.filter((r) => r.hidden), ...rows.filter((r) => !r.hidden)];
}

export function FraudCard({
  card,
  verdict,
  status,
  attempted,
  className,
  bare,
  evidence,
  photoUrl,
  finished,
}: {
  evidence?: EvidenceItem[];
  /** the run has ended: stop saying we're still looking for the evidence */
  finished?: boolean;
  /** the run's attached photo, used when an image item has no source_url */
  photoUrl?: string;
  /** no card chrome or header (inside the Assistant page's Review tab) */
  bare?: boolean;
  card?: FraudCardT;
  verdict?: Verdict;
  status: PaneStatus;
  attempted: number;
  className?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const dollarsRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!card) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: d(0.5) } });
      tl.from("[data-fc]", { y: 14, opacity: 0, stagger: 0.08 })
        .from("[data-claim]", { x: -10, opacity: 0, stagger: 0.06, duration: d(0.35) }, "-=0.35")
        .from("[data-sells]", { x: 10, opacity: 0, stagger: 0.05, duration: d(0.35) }, "<")
        .from("[data-bar]", { scaleX: 0, transformOrigin: "left center", stagger: 0.06, duration: d(0.6) }, "-=0.2");
      countTo(dollarsRef.current, card.dollars_defended, (n) => money(n), { duration: 1.4, delay: 0.15 });
    },
    { scope: root, dependencies: [card] },
  );

  // ---- empty states
  if (!card) {
    const approved = status === "approved";
    const waiting = verdict && !approved;
    return (
      <section ref={root} className={cx(!bare && "card", "flex flex-col overflow-hidden", className)} aria-label="Order review">
        <header className={cx("border-b border-line px-4 py-3 sm:px-5", bare && "hidden")}>
          <p className="label">Order review</p>
          <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">Why was this held?</h2>
        </header>
        <div className={cx("flex flex-1 flex-col justify-center", bare ? "py-2" : "p-5")}>
        {approved ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ShieldCheck className="size-7 text-safe" />
            <p className="text-[17px] font-semibold">Nothing to review</p>
            <p className="max-w-xs text-sm text-ink-2">The order matches your request and budget.</p>
          </div>
        ) : waiting ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">Preparing the details and looking for an alternative within your budget…</p>
            {[0.92, 0.75, 0.55].map((w, i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${w * 100}%` }} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-[15px] text-ink-2">If an order is held, the details show up here:</p>
            <ul className="flex flex-col gap-1.5 text-sm text-ink-3">
              <li>· the amount protected</li>
              <li>· what the photo showed vs. the store listing</li>
              <li>· which checks flagged it</li>
              <li>· a suggested alternative</li>
            </ul>
          </div>
        )}
        </div>
      </section>
    );
  }

  const sells = card.shopify_sells ?? null;
  // Perception can finish after the order is checked; the located evidence is the same text, so use it.
  const found = card.media_claimed.length
    ? card.media_claimed
    : (evidence ?? []).map((e) => (e.modality === "audio" ? e.transcript : e.text)).filter(Boolean);
  const claims = rankClaims(found, evidence ?? []);
  const top = [...card.top_probes].sort((a, b) => b.p - a.p).slice(0, 3);
  const safeTotal = card.safe_cart?.total ?? 0;
  const attemptedShown = attempted > 0 ? attempted : card.dollars_defended + safeTotal;

  return (
    <section ref={root} className={cx(!bare && "card", "flex min-h-0 flex-col overflow-hidden", className)} aria-label="Order review">
        <header className={cx("border-b border-line px-4 py-3 sm:px-5", bare && "hidden")}>
          <p className="label">Order review</p>
          <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">Why was this held?</h2>
        </header>
      <div className={cx("thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto", !bare && "p-4 sm:p-5")}>
        {/* dollars */}
        <div data-fc className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-line pb-4">
          <div>
            <p className="label" title="Dollars defended: the held order total minus the suggested alternative">Amount protected</p>
            <p className="tnum mt-1 text-[40px] leading-none font-semibold tracking-[-0.035em] text-ink sm:text-[44px]">
              <span ref={dollarsRef}>{money(card.dollars_defended)}</span>
            </p>
          </div>
          <p className="tnum pb-1 font-mono text-[12px] text-ink-3">
            <span className="text-danger">{money(attemptedShown)}</span> held − <span className="text-safe">{money(safeTotal)}</span> alternative
          </p>
        </div>

        {/* hidden-instruction evidence first */}
        <div data-fc>
          {evidence && evidence.length > 0 ? (
            <Evidence items={evidence} photoUrl={photoUrl} />
          ) : finished ? (
            <p className="rounded-xl border border-line px-3.5 py-2.5 text-sm text-ink-2">
              We couldn&rsquo;t pinpoint the exact spot in the file. The order was still held because of the checks below.
            </p>
          ) : (
            <p className="animate-pulse rounded-xl border border-danger-line px-3.5 py-2.5 text-sm text-ink-2">Locating the hidden instruction…</p>
          )}
        </div>

        {/* reason */}
        <div data-fc>
          <p className="label mb-1.5">Summary</p>
          <p className="text-[16px] leading-relaxed text-ink sm:text-[17px]">{card.reason}</p>
        </div>

        {/* evidence */}
        <div data-fc className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-danger-line p-3.5">
            <p className="label mb-2 text-danger!">Text found in your files</p>
            {claims.length ? (
              <ul className="flex flex-col gap-1.5">
                {claims.map(({ text: c, hidden }, i) => (
                  <li key={i} data-claim className={cx("flex gap-2 text-[14px]", hidden ? "font-bold text-danger" : "text-ink")}>
                    <Quote className="mt-1 size-3 shrink-0 text-danger" />
                    <span className="font-mono text-[13px] leading-snug">
                      {c}
                      {hidden && <span className="ml-2 rounded bg-danger px-1.5 py-0.5 align-middle font-sans text-[10px] font-bold tracking-wide text-white uppercase">hidden instruction</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No readable text or speech.</p>
            )}
          </div>
          <div className="rounded-xl border border-line p-3.5">
            <p className="label mb-2">Store listing</p>
            {sells ? (
              <dl className="flex flex-col gap-1.5">
                {SELLS_KEYS.filter(([k]) => sells[k] != null).map(([k, label]) => (
                  <div key={k} data-sells className="flex items-baseline justify-between gap-3 text-[14px]">
                    <dt className="shrink-0 text-ink-3">{label}</dt>
                    <dd className={cx("min-w-0 text-right text-ink", k === "title" ? "truncate font-medium" : "tnum font-mono text-[13px]")}>{fmtSells(k, sells[k])}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-ink-3">No store listing to compare with.</p>
            )}
          </div>
        </div>

        {/* probes */}
        {top.length > 0 && (
          <div data-fc>
            <p className="label mb-2">Flagged checks</p>
            <ul className="flex flex-col gap-2">
              {top.map((p) => (
                <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                  <span className="truncate text-[14px] text-ink">{checkLabel(p.id)}</span>
                  <span className={cx("tnum font-mono text-[13px] font-semibold", p.fired ? "text-danger" : "text-ink-2")}>{prob(p.p)}</span>
                  <span className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-2">
                    <span data-bar className={cx("block h-full rounded-full", p.fired ? "bg-danger" : "bg-ink-3")} style={{ width: `${Math.max(2, p.p * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {card.safe_cart && (
          <div data-fc>
            <SafeCart cart={card.safe_cart} />
          </div>
        )}
      </div>
    </section>
  );
}
