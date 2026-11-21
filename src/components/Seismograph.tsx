import { useMemo, useRef, useState } from "react";
import type { Probe, ProbeCategory, ProbeResult, RuleSet, Verdict } from "../types";
import { humanize, prob } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { Chip, cx } from "./ui";

const CATEGORY_ORDER: ProbeCategory[] = ["injection", "spend_hijack", "coercion", "pack_lie", "split_payload", "privacy", "promo_benign"];
const CATEGORY_LABEL: Record<ProbeCategory, string> = {
  injection: "Injection",
  spend_hijack: "Spend hijack",
  coercion: "Coercion",
  pack_lie: "Pack lie",
  split_payload: "Split payload",
  privacy: "Privacy",
  promo_benign: "Benign promo",
};

interface Light {
  probe: Probe;
  result?: ProbeResult;
}

function buildLights(rules: RuleSet, verdict?: Verdict): Light[] {
  const byId = new Map((verdict?.probes ?? []).map((r) => [r.id, r]));
  const known = new Set(rules.probes.map((p) => p.id));
  const extra: Probe[] = (verdict?.probes ?? [])
    .filter((r) => !known.has(r.id))
    .map((r) => ({ id: r.id, type: "noul", category: "injection", instructions: "Probe added after this rule set was loaded.", threshold: 0.1, added_by: "neon" }));
  const all = [...rules.probes, ...extra];
  const rank = (c: ProbeCategory) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? 99 : i;
  };
  return all
    .map((probe, i) => ({ probe, result: byId.get(probe.id), i }))
    .sort((a, b) => rank(a.probe.category) - rank(b.probe.category) || a.i - b.i)
    .map(({ probe, result }) => ({ probe, result }));
}

export function Seismograph({ rules, rulesLive = true, verdict, checking }: { rules: RuleSet; rulesLive?: boolean; verdict?: Verdict; checking: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPolylineElement>(null);
  const scanRef = useRef<SVGRectElement>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const lights = useMemo(() => buildLights(rules, verdict), [rules, verdict]);
  const evaluated = !!verdict && verdict.probes.length > 0;
  const fired = lights.filter((l) => l.result?.fired);
  const focused = lights.find((l) => l.probe.id === focus) ?? fired.sort((a, b) => (b.result?.p ?? 0) - (a.result?.p ?? 0))[0];

  const categories = useMemo(() => {
    const m = new Map<ProbeCategory, { total: number; fired: number }>();
    for (const l of lights) {
      const c = m.get(l.probe.category) ?? { total: 0, fired: 0 };
      c.total += 1;
      if (l.result?.fired) c.fired += 1;
      m.set(l.probe.category, c);
    }
    return CATEGORY_ORDER.filter((c) => m.has(c)).map((c) => ({ c, ...m.get(c)! }));
  }, [lights]);

  // Seismograph line: one sample per probe, height = p.
  const W = 1000;
  const H = 64;
  const pts = lights.map((l, i) => {
    const x = lights.length > 1 ? (i / (lights.length - 1)) * W : 0;
    const p = l.result?.p ?? 0;
    return `${x.toFixed(1)},${(H - 4 - p * (H - 10)).toFixed(1)}`;
  });
  const thresholdY = H - 4 - 0.1 * (H - 10);

  // Verdict arrives: lights ripple in grid order, the line draws, fired lights ring.
  useGSAP(
    () => {
      if (!evaluated) return;
      const cells = gsap.utils.toArray<HTMLElement>("[data-light]", root.current);
      gsap.fromTo(
        cells.map((c) => c.querySelector("[data-bulb]")),
        { scale: 0.3, opacity: 0.2 },
        { scale: 1, opacity: 1, duration: d(0.35), ease: "back.out(2)", stagger: { each: 0.006, from: "start" } },
      );
      gsap.fromTo(
        root.current!.querySelectorAll("[data-fired] [data-ring]"),
        { scale: 0.6, opacity: 0.9 },
        { scale: 2.6, opacity: 0, duration: d(0.9), ease: "power2.out", repeat: 1, delay: 0.25 },
      );
      const line = lineRef.current;
      if (line) {
        const len = line.getTotalLength?.() || 2000;
        gsap.fromTo(line, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: d(0.7), ease: "power2.inOut" });
      }
    },
    { scope: root, dependencies: [verdict] },
  );

  // While waiting on the firewall, a scan bar sweeps the trace.
  useGSAP(
    () => {
      const scan = scanRef.current;
      if (!scan) return;
      if (checking && !evaluated) {
        gsap.fromTo(scan, { attr: { x: -60 }, opacity: 1 }, { attr: { x: W }, duration: d(1.1), ease: "none", repeat: -1 });
      } else {
        gsap.killTweensOf(scan);
        gsap.set(scan, { opacity: 0 });
      }
    },
    { dependencies: [checking, evaluated] },
  );

  return (
    <div ref={root} className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-2">Each square is one yes/no check on the photo, the real listing and the cart. Red means it found a problem.</p>
          <span className="tnum text-xs text-ink-3">
            {lights.length} checks · rule set v{rules.version}
            {!rulesLive && <span title="GET /api/rules isn't serving yet; showing the bundled sample rule set"> · sample</span>}
          </span>
        </div>
        {evaluated ? (
          <Chip tone={fired.length ? "danger" : "safe"}>{fired.length ? `${fired.length} problems found` : "no problems"}</Chip>
        ) : (
          <Chip>{checking ? "checking…" : "waiting"}</Chip>
        )}
      </div>

      {/* trace line */}
      <div className="relative overflow-hidden rounded-xl border border-line bg-sunken">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-12 w-full sm:h-14" aria-hidden>
          <line x1="0" x2={W} y1={thresholdY} y2={thresholdY} stroke="var(--line-strong)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
          <rect ref={scanRef} x={-60} y={0} width={60} height={H} fill="var(--ink)" fillOpacity={0.07} style={{ opacity: 0 }} />
          <polyline
            ref={lineRef}
            points={pts.join(" ")}
            fill="none"
            stroke={evaluated ? (fired.length ? "var(--danger)" : "var(--safe)") : "var(--line-strong)"}
            strokeWidth={1.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="pointer-events-none absolute top-1.5 right-2 font-mono text-[10px] text-ink-3">above the dashed line = problem</span>
      </div>

      {/* lights */}
      <div className="grid grid-cols-5 gap-1.5 @md:grid-cols-8 @2xl:grid-cols-10">
        {lights.map((l) => {
          const r = l.result;
          const isFired = !!r?.fired;
          const p = r?.p ?? 0;
          return (
            <button
              key={l.probe.id}
              data-light
              data-fired={isFired || undefined}
              onMouseEnter={() => setFocus(l.probe.id)}
              onFocus={() => setFocus(l.probe.id)}
              onClick={() => setFocus(l.probe.id)}
              aria-label={`${humanize(l.probe.id)}: ${r ? prob(p) : "not evaluated"}`}
              className={cx(
                "group relative flex min-w-0 flex-col items-start gap-1 rounded-lg border px-1.5 py-1.5 text-left transition-colors sm:px-2",
                isFired ? "border-danger-line bg-danger-soft" : "border-line bg-surface hover:border-line-strong",
                focus === l.probe.id && "ring-1 ring-ink",
              )}
            >
              <span className="flex w-full items-center justify-between gap-1">
                <span className="relative inline-flex size-2.5">
                  {isFired && <span data-ring className="absolute inset-0 rounded-full bg-danger opacity-0" />}
                  <span
                    data-bulb
                    className={cx("relative inline-flex size-2.5 rounded-[3px]", isFired ? "bg-danger" : r ? "bg-safe" : "bg-line-strong")}
                    style={r && !isFired ? { opacity: 0.35 + Math.min(p * 6, 0.65) } : undefined}
                  />
                </span>
                <span className={cx("tnum font-mono text-[10px] sm:text-[11px]", isFired ? "font-semibold text-danger" : "text-ink-3")}>{r ? prob(p) : "··"}</span>
              </span>
              <span className={cx("hidden w-full text-[10.5px] leading-[1.2] hyphens-auto @xs:line-clamp-2", isFired ? "text-ink" : "text-ink-2")}>{humanize(l.probe.id)}</span>
            </button>
          );
        })}
      </div>

      {/* focused probe */}
      <div className="flex min-h-[44px] items-start justify-between gap-3 rounded-xl border border-line bg-surface-2/50 px-3 py-2">
        {focused ? (
          <>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {humanize(focused.probe.id)}
                <span className="ml-2 font-mono text-[10px] tracking-wide text-ink-3 uppercase">{CATEGORY_LABEL[focused.probe.category] ?? focused.probe.category}</span>
                {focused.probe.added_by === "neon" && <span className="ml-2 font-mono text-[10px] text-warn uppercase">learned</span>}
              </p>
              <p className="text-xs leading-snug text-ink-3">{focused.probe.instructions}</p>
            </div>
            <div className="shrink-0 text-right">
              <div className={cx("tnum font-mono text-sm font-semibold", focused.result?.fired ? "text-danger" : "text-ink")}>
                {focused.result ? prob(focused.result.p) : "—"}
              </div>
              <div className="tnum font-mono text-[10px] text-ink-3">flags at {prob(focused.probe.threshold)}</div>
            </div>
          </>
        ) : (
          <p className="self-center text-xs text-ink-3">Hover or tap a square to see what that check asks.</p>
        )}
      </div>

      {/* category tally */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {categories.map(({ c, total, fired: f }) => (
          <span key={c} className="tnum text-xs text-ink-3">
            {CATEGORY_LABEL[c]} <span className={f ? "font-medium text-danger" : "text-ink-2"}>{f}</span>/{total}
          </span>
        ))}
      </div>
    </div>
  );
}
