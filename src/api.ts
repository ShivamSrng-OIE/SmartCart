import type { EvalResults, Metrics, Pane, RuleSet, TraceEvent } from "./types";
import { parseJsonl } from "./state";
import attackJsonl from "./fixtures/run_attack.jsonl?raw";
import benignJsonl from "./fixtures/run_benign.jsonl?raw";
import redteamJsonl from "./fixtures/redteam_recorded.jsonl?raw";
import defaultRulesJson from "./fixtures/rules.sample.json";
import evalSample from "./fixtures/eval.sample.json";
import { ENDPOINTS, apiUrl, streamUrl, type FixtureName, type RunKind } from "./config";
import { looksLikeGemini, toEvents } from "./lib/gemini";

// ---------------------------------------------------------------- live API
// API routes; the backend guide (backend/README.md) lists them all.

/** How the shared model keys are doing: "busy" = the free models are rate limited and a backup fills in;
 *  "limited" = the shared quota is used up, so checks are slow or held for safety. */
export interface ServiceLimits {
  state: "ok" | "busy" | "limited";
  openrouter: "ok" | "busy";
  gemini: "ok" | "limited";
}

export interface HealthInfo {
  ok: boolean;
  limits: ServiceLimits | null;
}

export async function healthInfo(timeoutMs = 1200): Promise<HealthInfo> {
  if (!ENDPOINTS.health) return { ok: true, limits: null };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(ENDPOINTS.health, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, limits: null };
    const j = (await r.json().catch(() => null)) as { ok?: boolean; limits?: ServiceLimits } | null;
    return { ok: !!j?.ok, limits: j?.limits ?? null };
  } catch {
    return { ok: false, limits: null };
  }
}

export async function health(timeoutMs = 1200): Promise<boolean> {
  return (await healthInfo(timeoutMs)).ok;
}

/** POST /api/run (multipart) → run id. Kept for the side-by-side compare view. */
export async function startRun(form: FormData, url: string = ENDPOINTS.both.run): Promise<string> {
  const r = await fetch(url, { method: "POST", body: form });
  if (!r.ok) throw new Error(`POST ${url} failed: ${r.status} ${await r.text().catch(() => "")}`.trim());
  const j = (await r.json()) as { run_id?: string };
  if (!j.run_id) throw new Error(`POST ${url} returned no run_id`);
  return j.run_id;
}

/** SSE stream for a run. Each message may be a TraceEvent or a Gemini response chunk. */
export function streamRun(
  runId: string,
  onEvent: (e: TraceEvent) => void,
  onError?: (err: string) => void,
  opts: { pane?: Pane; closeOn?: Pane[] } = {},
): () => void {
  const es = new EventSource(streamUrl(runId));
  const t0 = performance.now();
  const closeOn = opts.closeOn ?? ["guarded", "redteam"];
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };
  es.onmessage = (msg) => {
    let payload: unknown;
    try {
      payload = JSON.parse(msg.data);
    } catch {
      return; // keep-alives / malformed lines
    }
    const events = toEvents(payload, { runId, pane: opts.pane ?? "guarded", now: () => performance.now() - t0 });
    for (const e of events) {
      onEvent(e);
      if (e.kind === "done" && (e.pane === "system" || closeOn.includes(e.pane))) close();
    }
  };
  es.onerror = () => {
    if (closed) return;
    // EventSource auto-reconnects; the backend replays from the start, so the reducer stays correct.
    if (es.readyState === EventSource.CLOSED) {
      onError?.("The stream was closed by the server");
      close();
    }
  };
  return close;
}

export interface AgentRunHandlers {
  onStart: (runId: string) => void;
  onEvent: (e: TraceEvent) => void;
  onError: (message: string) => void;
}

/**
 * Run one AI shopper (mode 2 or 3) against its configured endpoint.
 * The endpoint may answer with { run_id } + SSE, a raw Gemini generateContent JSON,
 * a Gemini streamGenerateContent SSE body, or { events: TraceEvent[] }.
 */
export function runAgent(kind: RunKind, form: FormData, h: AgentRunHandlers): () => void {
  const ep = ENDPOINTS[kind];
  const pane: Pane = kind === "unprotected" ? "victim" : "guarded";
  const ctrl = new AbortController();
  let stopStream: (() => void) | null = null;
  let sawDone = false;
  const t0 = performance.now();
  form.set("mode", ep.mode);

  const emit = (e: TraceEvent) => {
    if (e.kind === "done" && (e.pane === "system" || e.pane === pane)) sawDone = true;
    h.onEvent(e);
  };
  const finish = (runId: string) => {
    if (!sawDone) emit({ run_id: runId, pane, t_ms: Math.round(performance.now() - t0), kind: "done", data: {} });
  };
  const mapOpts = (runId: string) => ({ runId, pane, now: () => performance.now() - t0, interceptStateChanging: kind === "unprotected" });

  (async () => {
    let r: Response;
    try {
      r = await fetch(ep.run, { method: "POST", body: form, signal: ctrl.signal });
    } catch (err) {
      if ((err as Error).name !== "AbortError") h.onError(`Couldn’t reach ${ep.run}. Is the backend running?`);
      return;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      h.onError(`${ep.run} answered ${r.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
      return;
    }
    const type = r.headers.get("content-type") ?? "";

    // Streamed body (Gemini streamGenerateContent or TraceEvents as SSE / NDJSON)
    if (type.includes("text/event-stream") || type.includes("ndjson")) {
      const runId = `r_${Date.now().toString(36)}`;
      h.onStart(runId);
      const reader = r.body?.getReader();
      if (!reader) return h.onError("The response had no body to stream.");
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const raw = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              toEvents(JSON.parse(raw), mapOpts(runId)).forEach(emit);
            } catch {
              /* partial or non-JSON line */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") h.onError("The stream broke off before the run finished.");
        return;
      }
      finish(runId);
      return;
    }

    let json: unknown;
    try {
      json = await r.json();
    } catch {
      h.onError(`${ep.run} didn’t return JSON.`);
      return;
    }
    const j = json as Record<string, unknown>;

    // Team contract: { run_id } then SSE.
    if (typeof j?.run_id === "string" && !looksLikeGemini(j) && !Array.isArray(j.events)) {
      h.onStart(j.run_id);
      stopStream = streamRun(j.run_id, emit, h.onError, { pane, closeOn: [pane] });
      return;
    }

    // One-shot Gemini response (or { events }).
    const runId = typeof j?.run_id === "string" ? j.run_id : `r_${Date.now().toString(36)}`;
    h.onStart(runId);
    const events = toEvents(json, mapOpts(runId));
    if (!events.length) {
      h.onError("The response didn’t contain any steps the arena understands. See README › Gemini-compatible responses.");
      return;
    }
    events.forEach(emit);
    finish(runId);
  })();

  return () => {
    ctrl.abort();
    stopStream?.();
  };
}

export async function launchRedteam(productId?: string, rounds = 3): Promise<string> {
  const r = await fetch(apiUrl("/api/redteam/launch"), {
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
  const r = await fetch(apiUrl("/api/rules"));
  if (!r.ok) throw new Error(`GET /api/rules failed: ${r.status}`);
  return normalizeRules(await r.json());
}

export async function getEvalLatest(): Promise<EvalResults> {
  const r = await fetch(apiUrl("/api/eval/latest"));
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
  const meta = (r.meta as EvalResults["meta"]) ?? undefined;
  const systems: EvalResults["systems"] = {};
  if (meta?.sample === true) return { systems };
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
    by_modality: r.by_modality as EvalResults["by_modality"],
    n_errors: r.n_errors as EvalResults["n_errors"],
    meta,
    failures: Array.isArray(r.failures) ? (r.failures as EvalResults["failures"]) : undefined,
  };
}

// ---------------------------------------------------------------- replay
// Recorded runs for replay mode and the offline fallback.

const FIXTURES: Record<FixtureName | "redteam", string> = {
  attack: attackJsonl,
  benign: benignJsonl,
  redteam: redteamJsonl,
};

export const fixtureEvents = (name: FixtureName | "redteam"): TraceEvent[] => parseJsonl(FIXTURES[name]);
/** Default rule set shipped with the site, used until GET /api/rules answers. */
export const defaultRules = (): RuleSet => normalizeRules(defaultRulesJson);
/** Recorded results, used only in replay mode. */
export const recordedEval = (): EvalResults => normalizeEval(evalSample);

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
