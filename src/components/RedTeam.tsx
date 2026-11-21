import { useCallback, useEffect, useRef, useState } from "react";
import { Bug, CheckCircle2, FlaskConical, GitCommitHorizontal, Play, RotateCcw, ShieldCheck, ShieldX, Stethoscope, Wand2, Rocket } from "lucide-react";
import { fixtureEvents, launchRedteam, replay, streamRun } from "../api";
import type { TraceEvent } from "../types";
import type { Mode } from "../hooks/useBackend";
import { checkLabel, clock, humanize, ms, prob } from "../lib/format";
import { gsap, useGSAP, d } from "../lib/motion";
import { Button, Chip, cx } from "./ui";

type StageKey = "launch" | "attack" | "blocked" | "mutate" | "bypass" | "diagnose" | "probe_proposed" | "validate" | "patched" | "reblocked";
type Tone = "neutral" | "danger" | "safe" | "warn";

const STAGE: Record<StageKey, { title: string; icon: typeof Bug; tone: Tone }> = {
  launch: { title: "Review cycle started", icon: Rocket, tone: "neutral" },
  attack: { title: "New order pattern", icon: Bug, tone: "neutral" },
  blocked: { title: "Held by Safe Checkout", icon: ShieldCheck, tone: "safe" },
  mutate: { title: "New variation", icon: Wand2, tone: "neutral" },
  bypass: { title: "Slipped through", icon: ShieldX, tone: "danger" },
  diagnose: { title: "Reviewing the miss", icon: Stethoscope, tone: "neutral" },
  probe_proposed: { title: "New check drafted", icon: FlaskConical, tone: "warn" },
  validate: { title: "New check verified", icon: CheckCircle2, tone: "safe" },
  patched: { title: "New check switched on", icon: GitCommitHorizontal, tone: "safe" },
  reblocked: { title: "Same order, now held", icon: ShieldCheck, tone: "safe" },
};

const ORDER: StageKey[] = ["attack", "blocked", "bypass", "probe_proposed", "patched", "reblocked"];
const ORDER_LABEL: Record<string, string> = {
  attack: "Pattern",
  blocked: "Held",
  bypass: "Slipped",
  probe_proposed: "New check",
  patched: "Enabled",
  reblocked: "Held again",
};

interface Item {
  key: string;
  stage: StageKey;
  t_ms: number;
  message: string;
  data: Record<string, unknown>;
}

const toneDot: Record<Tone, string> = { neutral: "bg-ink-3", danger: "bg-danger", safe: "bg-safe", warn: "bg-warn" };
const toneText: Record<Tone, string> = { neutral: "text-ink", danger: "text-danger", safe: "text-safe", warn: "text-warn" };

export function RedTeam({
  mode,
  rulesVersion,
  onPatched,
}: {
  mode: Mode;
  rulesVersion: number;
  onPatched: (v: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const versionRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const t0 = useRef(0);

  const onEvent = useCallback(
    (e: TraceEvent) => {
      if (e.kind === "done") {
        setRunning(false);
        return;
      }
      const data = (e.data ?? {}) as Record<string, unknown>;
      const stage = String(data.stage ?? "") as StageKey;
      if (!STAGE[stage]) return;
      setItems((xs) => [...xs, { key: `${xs.length}-${e.t_ms}`, stage, t_ms: e.t_ms, message: String(data.message ?? ""), data }]);
      if (stage === "patched" && typeof data.rules_version_to === "number") onPatched(data.rules_version_to);
    },
    [onPatched],
  );

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setElapsed(performance.now() - t0.current), 50);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => () => stopRef.current?.(), []);

  const launch = async () => {
    stopRef.current?.();
    setItems([]);
    setError(null);
    setRunning(true);
    t0.current = performance.now();
    setElapsed(0);
    if (mode === "replay") {
      stopRef.current = replay(fixtureEvents("redteam"), onEvent, 1, () => setRunning(false));
      return;
    }
    try {
      const id = await launchRedteam();
      stopRef.current = streamRun(id, onEvent, (m) => {
        setError(m);
        setRunning(false);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  useGSAP(
    () => {
      const rows = listRef.current?.querySelectorAll("[data-item]");
      const last = rows?.[rows.length - 1];
      if (last) {
        gsap.from(last, { y: 10, opacity: 0, duration: d(0.4), ease: "power3.out" });
        gsap.from(last.querySelector("[data-rail]"), { scaleY: 0, transformOrigin: "top", duration: d(0.5), ease: "power2.out" });
      }
    },
    { scope: root, dependencies: [items.length] },
  );

  const patched = items.find((i) => i.stage === "patched");
  const proposed = items.find((i) => i.stage === "probe_proposed");
  const validate = items.find((i) => i.stage === "validate");
  const reached = new Set(items.map((i) => i.stage));
  const shownVersion = patched ? Number(patched.data.rules_version_to) : rulesVersion;

  useGSAP(
    () => {
      if (!patched || !versionRef.current) return;
      gsap.fromTo(versionRef.current, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: d(0.6), ease: "expo.out" });
    },
    { dependencies: [patched?.key] },
  );

  const probe = (proposed?.data.probe ?? null) as Record<string, unknown> | null;
  const benign = (validate?.data.benign ?? []) as { id: string; p: number }[];
  const exploit = (validate?.data.exploit ?? null) as { p: number; fired: boolean } | null;

  return (
    <div ref={root} className="mx-auto grid w-full max-w-[1800px] gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] 2xl:gap-6">
      {/* timeline */}
      <section className="card flex min-h-0 flex-col overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div>
            <p className="label mb-1">Safety updates</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">How Safe Checkout adds new checks</h1>
            <p className="mt-1 max-w-lg text-sm text-ink-2">
              Safe Checkout keeps learning. When a new kind of order slips through, a check is drafted, verified against everyday orders, and switched on.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="tnum font-mono text-sm text-ink-3">{clock(elapsed)}</span>
            <Button variant="primary" size="lg" onClick={launch} disabled={running} icon={items.length && !running ? <RotateCcw className="size-4" /> : <Play className="size-4 fill-current" />}>
              {running ? "Running" : items.length ? "Run again" : "Launch"}
            </Button>
          </div>
        </header>

        {/* progress */}
        <div className="grid grid-cols-6 gap-1 border-b border-line px-4 py-3 sm:px-5">
          {ORDER.map((k) => {
            const on = reached.has(k);
            const tone = STAGE[k].tone;
            return (
              <div key={k} className="flex min-w-0 flex-col gap-1.5">
                <span className={cx("h-1 rounded-full transition-colors duration-500", on ? toneDot[tone] : "bg-surface-2")} />
                <span className={cx("truncate text-[10px] font-medium sm:text-[11px]", on ? "text-ink" : "text-ink-3")}>{ORDER_LABEL[k]}</span>
              </div>
            );
          })}
        </div>

        <div className="thin-scroll min-h-[320px] flex-1 overflow-y-auto p-4 sm:p-5">
          {error && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-danger">
                <span className="font-semibold">Couldn’t start a review cycle.</span> Please try again in a moment.
              </p>
              <Button size="sm" onClick={launch}>
                Try again
              </Button>
            </div>
          )}
          {items.length === 0 ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 text-center">
              <Bug className="size-6 text-ink-3" />
              <p className="text-[15px] font-medium">Start a review cycle</p>
              <p className="max-w-sm text-sm text-ink-3">
                Up to 3 rounds.
              </p>
            </div>
          ) : (
            <ol ref={listRef} className="flex flex-col">
              {items.map((it, i) => {
                const s = STAGE[it.stage];
                const Icon = s.icon;
                const last = i === items.length - 1;
                return (
                  <li key={it.key} data-item className="relative flex gap-3 pb-4 last:pb-0">
                    {!last && <span data-rail className="absolute top-8 bottom-0 left-[15px] w-px bg-line" />}
                    <span className={cx("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-surface", s.tone === "neutral" ? "border-line" : s.tone === "danger" ? "border-danger-line" : s.tone === "safe" ? "border-safe-line" : "border-warn-line")}>
                      <Icon className={cx("size-4", toneText[s.tone])} />
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={cx("text-[14px] font-semibold", toneText[s.tone])}>
                          {s.title}
                          {typeof it.data.round === "number" && <span className="ml-2 font-mono text-[11px] font-normal text-ink-3">round {it.data.round}</span>}
                        </p>
                        <span className="tnum shrink-0 font-mono text-[11px] text-ink-3">{(it.t_ms / 1000).toFixed(1)}s</span>
                      </div>
                      <p className="text-[13px] text-ink-2">{it.message}</p>
                      {typeof it.data.payload === "string" && (
                        <p className="mt-1.5 inline-block rounded-md border border-line bg-sunken px-2 py-1 font-mono text-[12px] text-ink">“{it.data.payload}”</p>
                      )}
                      {typeof it.data.latency_ms === "number" && (
                        <p className="tnum mt-1 font-mono text-[11px] text-ink-3">
                          {ms(it.data.latency_ms as number)}
                          {it.data.top_probe ? ` · ${checkLabel(String((it.data.top_probe as Record<string, unknown>).id))} ${prob(Number((it.data.top_probe as Record<string, unknown>).p))}` : ""}
                          {typeof it.data.approve_p === "number" ? ` · P(approve) ${prob(it.data.approve_p as number)}` : ""}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      {/* rules side */}
      <aside className="flex flex-col gap-4">
        <section className="card p-4 sm:p-5">
          <p className="label">Rule set version</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="flex items-baseline gap-1 overflow-hidden">
              <span className="text-lg font-medium text-ink-3">v</span>
              <span ref={versionRef} className="tnum inline-block text-[56px] leading-none font-semibold tracking-[-0.04em]">
                {shownVersion}
              </span>
            </div>
            {patched ? (
              <Chip tone="safe">
                v{String(patched.data.rules_version_from)} → v{String(patched.data.rules_version_to)} · live now
              </Chip>
            ) : (
              <Chip>current</Chip>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-3">Each update is a new version and can be rolled back.</p>
        </section>

        <section className="card p-4 sm:p-5">
          <p className="label mb-2">The new check</p>
          {probe ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-medium break-all text-ink">{String(probe.id)}</span>
                <Chip tone="warn">{String(probe.added_by ?? "neon")}</Chip>
              </div>
              <p className="text-[14px] leading-snug text-ink-2">{String(probe.instructions)}</p>
              <p className="tnum font-mono text-[11px] text-ink-3">
                {String(probe.type)} · {String(probe.category)} · threshold {prob(Number(probe.threshold))}
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-3">New checks appear here.</p>
          )}
        </section>

        <section className="card p-4 sm:p-5">
          <p className="label mb-3">Verified before switching on</p>
          {exploit ? (
            <ul className="flex flex-col gap-2.5">
              <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <span className="text-[14px] font-medium">Flags the order that slipped through</span>
                <span className={cx("tnum font-mono text-[13px] font-semibold", exploit.fired ? "text-safe" : "text-danger")}>{prob(exploit.p)}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-safe" style={{ width: `${exploit.p * 100}%` }} />
                </span>
              </li>
              {benign.map((b) => (
                <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                  <span className="truncate text-[13px] text-ink-2">Normal order: {humanize(b.id.replace(/^benign_/, "")).toLowerCase()}</span>
                  <span className={cx("tnum font-mono text-[12px]", b.p < 0.1 ? "text-ink-2" : "text-danger")}>{prob(b.p)}</span>
                  <span className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-ink-3" style={{ width: `${Math.max(2, b.p * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">A check is only enabled if it flags that order and none of 5 everyday orders.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
