import type { EvalResults, Metrics, RuleSet, TraceEvent } from "./types";
import { parseJsonl } from "./state";
import attackJsonl from "./fixtures/run_attack.jsonl?raw";
import benignJsonl from "./fixtures/run_benign.jsonl?raw";
import redteamJsonl from "./fixtures/redteam_demo.jsonl?raw";
import rulesSample from "./fixtures/rules.sample.json";
import evalSample from "./fixtures/eval.sample.json";
import type { FixtureName } from "./config";

// ---------------------------------------------------------------- live API
// Routes from docs/architecture.md §5 (owned by Member 1). Send changes to M1.

export async function health(timeoutMs = 1200): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch("/health", { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return !!j?.ok;
  } catch {
    return false;
  }
}

/** POST /api/run (multipart) → run id. */
export async function startRun(form: FormData): Promise<string> {
  const r = await fetch("/api/run", { method: "POST", body: form });
  if (!r.ok) throw new Error(`POST /api/run failed: ${r.status} ${await r.text().catch(() => "")}`.trim());
  const j = (await r.json()) as { run_id?: string };
  if (!j.run_id) throw new Error("POST /api/run returned no run_id");
  return j.run_id;
}

/** GET /api/runs/{id}/stream over SSE. Returns a function that closes the stream. */
export function streamRun(runId: string, onEvent: (e: TraceEvent) => void, onError?: (err: string) => void): () => void {
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };
  es.onmessage = (msg) => {
    try {
      const e = JSON.parse(msg.data) as TraceEvent;
      onEvent(e);
      // The backend sends one done per pane; close once the guarded (or red-team) side finishes.
      if (e.kind === "done" && (e.pane === "guarded" || e.pane === "redteam")) close();
    } catch {
      /* ignore keep-alives / malformed lines */
    }
  };
  es.onerror = () => {
    if (closed) return;
    // EventSource auto-reconnects; the backend replays from the start, so the reducer stays correct.
    if (es.readyState === EventSource.CLOSED) {
      onError?.("Stream closed by the server");
      close();
    }
  };
  return close;
}

export async function launchRedteam(productId?: string, rounds = 3): Promise<string> {
  const r = await fetch("/api/redteam/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product_id: productId || undefined, rounds }),
  });
  if (!r.ok) throw new Error(`POST /api/redteam/launch failed: ${r.status}`);
  const j = (await r.json()) as { run_id?: string };
  if (!j.run_id) throw new Error("red-team launch returned no run_id");
  return j.run_id;
}

export async function getRules(): Promise<RuleSet> {
  const r = await fetch("/api/rules");
  if (!r.ok) throw new Error(`GET /api/rules failed: ${r.status}`);
  return normalizeRules(await r.json());
}

export async function getEvalLatest(): Promise<EvalResults> {
  const r = await fetch("/api/eval/latest");
  if (!r.ok) throw new Error(`GET /api/eval/latest failed: ${r.status}`);
  return normalizeEval(await r.json());
}

// ------------------------------------------------------------- normalizers
// Be liberal in what we accept so a small backend shape change never blanks the stage.

export function normalizeRules(raw: unknown): RuleSet {
  const r = (raw ?? {}) as Record<string, unknown>;
  const inner = (r.rules && typeof r.rules === "object" ? r.rules : r) as Record<string, unknown>;
  const probes = Array.isArray(inner.probes) ? inner.probes : Array.isArray(raw) ? (raw as unknown[]) : [];
  const version = Number(inner.version ?? r.version ?? 0) || 0;
  return { version, probes: probes as RuleSet["probes"] };
}

const SYSTEM_KEYS = ["baseline", "hardened", "carttrap"] as const;

export function normalizeEval(raw: unknown): EvalResults {
  const r = (raw ?? {}) as Record<string, unknown>;
  const systems: EvalResults["systems"] = {};
  const src = (r.systems ?? r.results ?? r) as unknown;
  if (Array.isArray(src)) {
    for (const row of src as Record<string, unknown>[]) {
      const key = String(row.system ?? row.name ?? "") as (typeof SYSTEM_KEYS)[number];
      if (SYSTEM_KEYS.includes(key)) systems[key] = (row.metrics ?? row) as Metrics;
    }
  } else if (src && typeof src === "object") {
    for (const key of SYSTEM_KEYS) {
      const v = (src as Record<string, unknown>)[key];
      if (v && typeof v === "object") systems[key] = ((v as Record<string, unknown>).metrics ?? v) as Metrics;
    }
  }
  return {
    systems,
    meta: (r.meta as EvalResults["meta"]) ?? undefined,
    failures: Array.isArray(r.failures) ? (r.failures as EvalResults["failures"]) : undefined,
  };
}

// ---------------------------------------------------------------- replay
// Recorded runs for rehearsal and the offline fallback.

const FIXTURES: Record<FixtureName | "redteam", string> = {
  attack: attackJsonl,
  benign: benignJsonl,
  redteam: redteamJsonl,
};

export const fixtureEvents = (name: FixtureName | "redteam"): TraceEvent[] => parseJsonl(FIXTURES[name]);
export const sampleRules = (): RuleSet => normalizeRules(rulesSample);
export const sampleEval = (): EvalResults => normalizeEval(evalSample);

/** Play events on their recorded t_ms clock. Returns a cancel function. */
export function replay(events: TraceEvent[], onEvent: (e: TraceEvent) => void, speed = 1, onDone?: () => void): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const sorted = [...events].sort((a, b) => a.t_ms - b.t_ms);
  sorted.forEach((e, i) => {
    timers.push(
      setTimeout(() => {
        onEvent(e);
        if (i === sorted.length - 1) onDone?.();
      }, e.t_ms / speed),
    );
  });
  return () => timers.forEach(clearTimeout);
}
