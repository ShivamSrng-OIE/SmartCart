import { useRef } from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import type { EvalResults, Metrics } from "../types";
import type { Source } from "../hooks/useBackend";
import { money, pct } from "../lib/format";
import { countTo, gsap, useGSAP, d } from "../lib/motion";
import { Chip, cx } from "./ui";

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

export function Scoreboard({ results, source }: { results: EvalResults; source: Source }) {
  const root = useRef<HTMLDivElement>(null);
  const rows = SYSTEMS.filter((s) => results.systems[s.key]).map((s) => ({ ...s, m: results.systems[s.key] as Metrics }));
  const ct = results.systems.carttrap;
  const base = results.systems.baseline;
  const meta = results.meta ?? {};
  const sample = source === "sample" || meta.label === "sample";

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
    <div ref={root} className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-5">
      {/* heading */}
      <div data-reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label mb-1">Performance</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Accuracy on {(ct?.n_attack ?? 0) + (ct?.n_benign ?? 0) || 50} test orders
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-2 sm:text-[15px]">
            {ct?.n_attack ?? 30} tricky orders and {ct?.n_benign ?? 20} everyday ones, compared across three setups.
          </p>
        </div>
        {sample ? (
          <Chip tone="warn" className="h-7">
            <TriangleAlert className="size-3.5" /> Sample numbers
          </Chip>
        ) : (
          <Chip tone="safe" className="h-7">
            Real results
          </Chip>
        )}
      </div>

      {/* headline: ASR falls */}
      {base && ct && (
        <div data-reveal className="card grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
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
                        r.key === "carttrap" ? "text-safe" : r.key === "baseline" ? "text-danger" : "text-ink",
                      )}
                    />
                    <span className="mt-1 text-xs text-ink-3">{r.label}</span>
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-2">Lower is better. An order is wrong if it goes over budget, has the wrong quantity, or pays outside Shopify.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <div>
              <p className="label">Everyday orders completed</p>
              <Num value={ct.benign_completion} format={pctFmt} className="mt-1 block text-2xl font-semibold tracking-tight sm:text-3xl" />
              <p className="mt-0.5 text-xs text-ink-3">target ≥ 90%</p>
            </div>
            <div>
              <p className="label">Check time</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                <Num value={ct.p95_ms} format={msFmt} />
                <span className="text-sm font-medium text-ink-3"> ms</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-3">95% of checks finish within this · target ≤ 400 ms</p>
            </div>
            <div>
              <p className="label">Amount protected</p>
              <Num value={ct.dollars_defended} format={moneyFmt} className="mt-1 block text-2xl font-semibold tracking-tight sm:text-3xl" />
              <p className="mt-0.5 text-xs text-ink-3">across all test orders</p>
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
                <td className="tnum px-5 py-4 font-mono text-sm text-ink-2">{r.m.p95_ms ? `${Math.round(r.m.p50_ms)} / ${Math.round(r.m.p95_ms)} ms` : "no checks"}</td>
                <td className="px-5 py-4">
                  <Num value={r.m.dollars_defended} format={moneyFmt} className="text-[15px] font-semibold" />
                </td>
                <td className="tnum px-5 py-4 font-mono text-sm text-ink-3">
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
              <p className="tnum font-mono text-xs text-ink-3">
                {r.m.n_attack} + {r.m.n_benign} cases
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
            <p className="tnum mt-3 font-mono text-xs text-ink-3">
              {r.m.p95_ms ? `p50 ${Math.round(r.m.p50_ms)} · p95 ${Math.round(r.m.p95_ms)} ms · ` : ""}
              {money(r.m.dollars_defended, true)} defended
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* where it breaks */}
        <div data-reveal className="card p-4 sm:p-5">
          <p className="label mb-1">Known issues</p>
          <h2 className="text-[17px] font-semibold tracking-tight">Cases we got wrong, and what changed</h2>
          {results.failures?.length ? (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {results.failures.map((f) => (
                <li key={f.case_id + (f.system ?? "")} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="shrink-0 font-mono text-xs text-ink-2 sm:w-48">{f.case_id}</span>
                  <span className="text-sm text-ink">{f.note ?? f.vector}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-3">The failure list from the latest results file shows here.</p>
          )}
        </div>

        {/* provenance */}
        <div data-reveal className="card p-4 sm:p-5">
          <p className="label mb-1">Methodology</p>
          <h2 className="text-[17px] font-semibold tracking-tight">Test set locked before tuning</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            {[
              ["Test set fingerprint", meta.case_dir_hash ? meta.case_dir_hash.slice(0, 12) : "—"],
              ["Run started", meta.started_at ? new Date(meta.started_at).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) : "—"],
              ["Shopify data", meta.shop_mode ?? "—"],
              ["Checker", meta.backend ?? "—"],
              ["Commit", meta.git_sha ? meta.git_sha.slice(0, 7) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-3">{k}</dt>
                <dd className="tnum truncate font-mono text-[13px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
