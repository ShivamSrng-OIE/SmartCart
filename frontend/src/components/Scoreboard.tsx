import { useRef } from "react";
import { ArrowRight, BarChart3 } from "lucide-react";
import type { EvalResults, Metrics } from "../types";
import { money, pct } from "../lib/format";
import { countTo, gsap, useGSAP, d } from "../lib/motion";
import { cx } from "./ui";
import type { ByModality } from "../lib/dataset";
import { useEffect, useState } from "react";
import { getTrust, type TrustOverview } from "../lib/marketplace";

const SYSTEMS = [
  { key: "baseline", label: "Assistant", note: "Standard setup" },
  { key: "hardened", label: "Assistant + instructions", note: "Extra guidance in the prompt" },
  { key: "carttrap", label: "Safe Checkout", note: "Every order verified" },
] as const;


function Bar({ value, tone, good }: { value: number; tone: "danger" | "safe" | "ink"; good?: boolean }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <span
        data-bar
        className={cx("block h-full rounded-full", tone === "danger" ? "bg-danger" : tone === "safe" ? "bg-safe" : "bg-ink-2", good && "opacity-90")}
        style={{ width: `${Math.max(1.5, Math.min(1, value) * 100)}%` }}
      />
    </span>
  );
}

function Num({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  return (
    <span data-num={value} data-format={format === pctFmt ? "pct" : format === moneyFmt ? "money" : "ms"} className={cx("tnum", className)}>
      {format(value)}
    </span>
  );
}
const pctFmt = (n: number) => pct(n);
const moneyFmt = (n: number) => money(n, true);
const msFmt = (n: number) => (n ? `${Math.round(n)}` : "—");
const FORMATS: Record<string, (n: number) => string> = { pct: pctFmt, money: moneyFmt, ms: msFmt };

/** What Safe Checkout has done in real use (this server's marketplace), as opposed to the fixed benchmark above. */
function LiveNumbers() {
  const [t, setT] = useState<TrustOverview | null>(null);
  useEffect(() => {
    getTrust().then(setT).catch(() => undefined);
  }, []);
  if (!t) return null;
  const { totals } = t;
  return (
    <div data-reveal className="card p-4 sm:p-5">
      <p className="label mb-1">In real use</p>
      <h2 className="text-[17px] font-semibold tracking-tight">What it has caught on this site</h2>
      <p className="mt-1 text-sm text-ink-3">Separate from the benchmark: these are the checks shoppers and the assistant have actually triggered here.</p>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Orders held", String(totals.blocked)],
          ["Money protected", money(totals.protected_usd, true)],
          ["Listings blocked", String(totals.flagged_products)],
          ["Sellers flagged", String(totals.flagged_merchants)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="tnum mt-1 text-2xl font-semibold tracking-tight">{v}</dd>
          </div>
        ))}
      </dl>
      {totals.incidents === 0 && <p className="mt-3 text-[13px] text-ink-3">Nothing has been held yet. Add a flagged listing to your cart, or ask the assistant to shop, and these numbers will move.</p>}
    </div>
  );
}

export function Scoreboard({ results }: { results: EvalResults | null }) {
  if (!results || !Object.keys(results.systems).length) {
    return (
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <div>
          <p className="label mb-1">Performance</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">How Safe Checkout performs</h1>
        </div>
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center">
          <BarChart3 className="size-7 text-ink-3" />
          <p className="text-[15px] font-medium">Results will appear here after the next review</p>
          <p className="max-w-md text-sm text-ink-3">Each run compares the regular assistant and Safe Checkout on the same set of everyday and unusual orders.</p>
        </div>
      </div>
    );
  }
  return <ScoreboardBody results={results} />;
}

function ScoreboardBody({ results }: { results: EvalResults }) {
  const root = useRef<HTMLDivElement>(null);
  const rows = SYSTEMS.filter((s) => results.systems[s.key]).map((s) => ({ ...s, m: results.systems[s.key] as Metrics }));
  const ct = results.systems.carttrap;
  const base = results.systems.baseline;
  const meta = results.meta ?? {};
  const bm = (results as unknown as { by_modality?: ByModality }).by_modality;
  const byModality = bm && Object.keys(bm).length ? bm : null;
  const modalities = [...new Set(Object.values(byModality ?? {}).flatMap((m) => Object.keys(m)))].sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : a.localeCompare(b)));
  const byTier = results.by_tier && Object.keys(results.by_tier).length ? results.by_tier : null;
  const tiers = [...new Set(Object.values(byTier ?? {}).flatMap((m) => Object.keys(m)))];
  const nCases = meta.n_cases?.carttrap ?? (ct ? ct.n_attack + ct.n_benign : 0);
  const nScored = ct ? ct.n_attack + ct.n_benign : 0;
  const baselineClean = !!base && base.asr < 0.05;

  useGSAP(
    () => {
      gsap.from("[data-reveal]", { y: 16, opacity: 0, stagger: 0.07, duration: d(0.6), ease: "power3.out" });
      gsap.from("[data-bar]", { scaleX: 0, transformOrigin: "left center", stagger: 0.04, duration: d(0.9), ease: "power3.out", delay: 0.2 });
      root.current?.querySelectorAll<HTMLElement>("[data-num]").forEach((el) => {
        const v = Number(el.dataset.num);
        const f = FORMATS[el.dataset.format ?? "pct"];
        if (Number.isFinite(v) && v > 0) countTo(el, v, f, { duration: 1.2, delay: 0.2 });
      });
    },
    { scope: root, dependencies: [results] },
  );

  return (
    <div ref={root} className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 sm:gap-5">
      {/* heading */}
      <div data-reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label mb-1">Performance</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            How Safe Checkout performs across {nScored} orders
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-2 sm:text-[15px]">
            {ct ? `${ct.n_attack} unusual orders and ${ct.n_benign} everyday ones` : "The same set of orders"}, compared across {rows.length === 1 ? "one setup" : `${["", "", "two", "three"][rows.length] ?? rows.length} setups`}.
            {nCases > nScored && ` ${nCases - nScored} of ${nCases} didn’t finish in time and aren’t counted.`}
          </p>
        </div>
      </div>

      {/* headline: ASR falls */}
      {base && ct && (
        <div data-reveal className="card grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div>
            <p className="label">Wrong orders placed</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {rows.map((r, i) => (
                <span key={r.key} className="flex items-baseline gap-3">
                  {i > 0 && <ArrowRight className="size-5 self-center text-ink-3" />}
                  <span className="flex flex-col">
                    <Num
                      value={r.m.asr}
                      format={pctFmt}
                      className={cx(
                        "text-[40px] leading-none font-semibold tracking-[-0.04em] sm:text-[56px]",
                        r.key === "carttrap" ? "text-safe" : r.key === "baseline" && r.m.asr > 0 ? "text-danger" : "text-ink",
                      )}
                    />
                    <span className="mt-1 text-xs text-ink-3">{r.label}</span>
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-2">Lower is better. An order is wrong if it goes over budget, has the wrong quantity, or pays outside Shopify.</p>
            {baselineClean && (
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink-2">
                In this run the standard assistant placed no wrong orders either, so there was nothing for Safe Checkout to improve on. What differs is cost: Safe Checkout adds a check to every order, and it is shown in the speed figure.
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <div>
              <p className="label">Everyday orders completed</p>
              <Num value={ct.benign_completion} format={pctFmt} className="mt-1 block text-2xl font-semibold tracking-tight sm:text-3xl" />
              <p className={cx("mt-0.5 text-xs", ct.benign_completion >= 0.9 ? "text-safe" : "text-warn")}>{ct.benign_completion >= 0.9 ? "meets" : "misses"} the 90% target</p>
            </div>
            <div>
              <p className="label">Check time</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                <Num value={ct.p95_ms} format={msFmt} />
                <span className="text-sm font-medium text-ink-3"> ms</span>
              </p>
              <p className={cx("mt-0.5 text-xs", ct.p95_ms && ct.p95_ms <= 400 ? "text-safe" : "text-warn")}>95% of checks finish within this · {ct.p95_ms && ct.p95_ms <= 400 ? "meets" : "slower than"} the 400 ms target</p>
            </div>
            <div>
              <p className="label">Amount protected</p>
              <Num value={ct.dollars_defended} format={moneyFmt} className="mt-1 block text-2xl font-semibold tracking-tight sm:text-3xl" />
              <p className="mt-0.5 text-xs text-ink-3">across all reviewed orders</p>
            </div>
          </div>
        </div>
      )}

      {/* table (≥ md) */}
      <div data-reveal className="card hidden overflow-hidden md:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line">
              {["Setup", "Wrong orders", "Everyday orders completed", "Check time (typical / slowest 5%)", "Amount protected", "Orders"].map((h) => (
                <th key={h} className="label px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cx("border-b border-line last:border-0", r.key === "carttrap" && "bg-surface-2/50")}>
                <td className="px-5 py-4">
                  <p className="text-[15px] font-semibold">{r.label}</p>
                  <p className="text-xs text-ink-3">{r.note}</p>
                </td>
                <td className="w-[22%] px-5 py-4">
                  <Num value={r.m.asr} format={pctFmt} className={cx("text-lg font-semibold", r.key === "carttrap" ? "text-safe" : r.m.asr > 0.3 ? "text-danger" : "")} />
                  <div className="mt-1.5">
                    <Bar value={r.m.asr} tone={r.key === "carttrap" ? "safe" : "danger"} />
                  </div>
                </td>
                <td className="w-[22%] px-5 py-4">
                  <Num value={r.m.benign_completion} format={pctFmt} className="text-lg font-semibold" />
                  <div className="mt-1.5">
                    <Bar value={r.m.benign_completion} tone="ink" />
                  </div>
                </td>
                <td className="tnum px-5 py-4 text-sm text-ink-2">{r.m.p95_ms ? `${Math.round(r.m.p50_ms)} / ${Math.round(r.m.p95_ms)} ms` : "no checks"}</td>
                <td className="px-5 py-4">
                  <Num value={r.m.dollars_defended} format={moneyFmt} className="text-[15px] font-semibold" />
                </td>
                <td className="tnum px-5 py-4 text-sm text-ink-3">
                  {r.m.n_attack} + {r.m.n_benign}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* cards (< md) */}
      <div data-reveal className="flex flex-col gap-2.5 md:hidden">
        {rows.map((r) => (
          <div key={r.key} className={cx("card p-4", r.key === "carttrap" && "border-line-strong")}>
            <div className="flex items-baseline justify-between">
              <p className="text-[15px] font-semibold">{r.label}</p>
              <p className="tnum text-xs text-ink-3">
                {r.m.n_attack} + {r.m.n_benign} orders
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="label">Wrong orders</p>
                <Num value={r.m.asr} format={pctFmt} className={cx("text-xl font-semibold", r.key === "carttrap" ? "text-safe" : "text-danger")} />
                <div className="mt-1">
                  <Bar value={r.m.asr} tone={r.key === "carttrap" ? "safe" : "danger"} />
                </div>
              </div>
              <div>
                <p className="label">Everyday orders completed</p>
                <Num value={r.m.benign_completion} format={pctFmt} className="text-xl font-semibold" />
                <div className="mt-1">
                  <Bar value={r.m.benign_completion} tone="ink" />
                </div>
              </div>
            </div>
            <p className="tnum mt-3 text-xs text-ink-3">
              {r.m.p95_ms ? `p50 ${Math.round(r.m.p50_ms)} · p95 ${Math.round(r.m.p95_ms)} ms · ` : ""}
              {money(r.m.dollars_defended, true)} defended
            </p>
          </div>
        ))}
      </div>

      {byModality && (
        <div data-reveal className="card overflow-x-auto p-4 sm:p-5">
          <p className="label mb-1">Where it breaks</p>
          <h2 className="text-[17px] font-semibold tracking-tight">Wrong orders by attack type</h2>
          <table className="mt-3 w-full min-w-[420px] text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="label py-2 font-medium">Modality</th>
                {rows.map((r) => (
                  <th key={r.key} className="label py-2 font-medium">{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modalities.map((mod) => (
                <tr key={mod} className="border-b border-line last:border-0">
                  <td className="py-2.5 text-[15px] font-medium">{mod}</td>
                  {rows.map((r) => {
                    const c = byModality[r.key]?.[mod];
                    return (
                      <td key={r.key} className="tnum py-2.5 text-sm">
                        {c && c.n_attack > 0 ? (
                          <>
                            <span className={cx("font-semibold", r.key === "carttrap" ? "text-safe" : c.asr > 0.3 ? "text-danger" : "text-ink")}>{pct(c.asr)}</span>
                            <span className="ml-1.5 text-xs text-ink-3">n={c.n_attack}</span>
                          </>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {byTier && (
        <div data-reveal className="card overflow-x-auto p-4 sm:p-5">
          <p className="label mb-1">Difficulty</p>
          <h2 className="text-[17px] font-semibold tracking-tight">Wrong orders by how obvious the trick is</h2>
          <p className="mt-1 text-sm text-ink-3">“Bold” orders carry an in-your-face instruction; “subtle” ones hide it in fine print.</p>
          <table className="mt-3 w-full min-w-[420px] text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="label py-2 font-medium">Difficulty</th>
                {rows.map((r) => <th key={r.key} className="label py-2 font-medium">{r.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier} className="border-b border-line last:border-0">
                  <td className="py-2.5 text-[15px] font-medium capitalize">{tier}</td>
                  {rows.map((r) => {
                    const c = byTier[r.key]?.[tier];
                    return (
                      <td key={r.key} className="tnum py-2.5 text-sm">
                        {c ? (
                          <>
                            <span className={cx("font-semibold", r.key === "carttrap" ? "text-safe" : c.asr > 0.3 ? "text-danger" : "text-ink")}>{pct(c.asr)}</span>
                            <span className="ml-1.5 text-xs text-ink-3">n={c.n_attack}</span>
                          </>
                        ) : <span className="text-ink-3">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LiveNumbers />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* where it breaks */}
        <div data-reveal className="card p-4 sm:p-5">
          <p className="label mb-1">Known issues</p>
          <h2 className="text-[17px] font-semibold tracking-tight">Cases we got wrong, and what changed</h2>
          {results.failures?.length ? (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {results.failures.map((f) => (
                <li key={f.case_id + (f.system ?? "")} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="shrink-0 text-xs text-ink-2 sm:w-48">{f.case_id}</span>
                  <span className="text-sm text-ink">{f.note ?? f.vector}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-3">Known issues from the latest review show here.</p>
          )}
        </div>

        {/* provenance */}
        <div data-reveal className="card p-4 sm:p-5">
          <p className="label mb-1">Methodology</p>
          <h2 className="text-[17px] font-semibold tracking-tight">Order set locked before tuning</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            {[
              ["Order set fingerprint", meta.case_dir_hash ? meta.case_dir_hash.slice(0, 12) : "—"],
              ["Orders scored", nCases ? `${nScored} of ${nCases}` : "—"],
              ["Numbers checked", meta.recomputed ? "recomputed from the cases" : "match the cases"],
              ["Run started", meta.started_at ? new Date(meta.started_at).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) : "—"],
              ["Shopify data", meta.shop_mode ?? "—"],
              ["Checker", meta.backend ?? "—"],
              ["Commit", meta.git_sha ? meta.git_sha.slice(0, 7) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-3">{k}</dt>
                <dd className="tnum truncate text-[13px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
