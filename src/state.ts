import type { FraudCard, Intent, Pane, TraceEvent, Verdict } from "./types";
import { STATE_CHANGING, summarizeCall, violatesIntent, type ProductLedger } from "./lib/spend";

export type Tone = "neutral" | "danger" | "safe" | "warn";

export type PaneStatus =
  | "idle"
  | "running"
  | "hijacked"
  | "intercepted"
  | "blocked"
  | "escalated"
  | "approved"
  | "firewall_error";

export interface Step {
  id: string;
  kind: TraceEvent["kind"];
  t_ms: number;
  title: string;
  args?: Record<string, unknown>;
  result?: unknown;
  message?: string;
  tone: Tone;
  /** total $ this call would have moved, when we can compute it */
  spend?: number | null;
  quantity?: number | null;
  /** guarded only: verdict that answered this state-changing call */
  verdict?: Verdict;
  data: Record<string, unknown>;
}

export interface PaneState {
  status: PaneStatus;
  steps: Step[];
  attempted: number;
  finished: boolean;
  lastT: number;
}

export interface ArenaState {
  runId?: string;
  intent: Intent | null;
  victim: PaneState;
  guarded: PaneState;
  redteam: PaneState;
  verdict?: Verdict;
  verdicts: Verdict[];
  fraudCard?: FraudCard;
  firewallError?: string;
  products: ProductLedger;
  done: boolean;
}

export const emptyPane = (): PaneState => ({ status: "idle", steps: [], attempted: 0, finished: false, lastT: 0 });

export function initialState(intent: Intent | null = null, runId?: string): ArenaState {
  return {
    runId,
    intent,
    victim: emptyPane(),
    guarded: emptyPane(),
    redteam: emptyPane(),
    verdicts: [],
    products: {},
    done: false,
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function statusForVerdict(v: Verdict): PaneStatus {
  if (v.error) return "firewall_error";
  if (v.action === "approve_checkout") return "approved";
  if (v.action === "escalate_to_neon_swap") return "escalated";
  return "blocked";
}

function toneForVerdict(v: Verdict): Tone {
  if (v.action === "approve_checkout" && !v.error) return "safe";
  if (v.action === "escalate_to_neon_swap" && !v.error) return "warn";
  return "danger";
}

function rememberProduct(products: ProductLedger, result: unknown): ProductLedger {
  const r = obj(result);
  const product = r.product && typeof r.product === "object" ? obj(r.product) : r;
  const id = str(product.id) ?? str(product.product_id);
  if (!id) return products;
  return { ...products, [id]: product };
}

function patchPane(s: ArenaState, pane: Pane, next: PaneState): ArenaState {
  return { ...s, [pane]: next };
}

/** Pure reducer: one TraceEvent in, a new ArenaState out. Never mutates `s`. */
export function applyEvent(s: ArenaState, e: TraceEvent): ArenaState {
  if (s.runId && e.run_id && e.run_id !== s.runId) return s;

  const paneKey: Pane = e.pane === "victim" || e.pane === "guarded" || e.pane === "redteam" ? e.pane : "guarded";
  const prev = s[paneKey];
  const data = obj(e.data);
  const id = `${paneKey}-${prev.steps.length}-${e.t_ms}`;
  const base = { ...prev, lastT: Math.max(prev.lastT, e.t_ms || 0) };
  const running: PaneStatus = prev.status === "idle" ? "running" : prev.status;

  switch (e.kind) {
    case "tool_call": {
      const name = str(data.name) ?? str(data.tool) ?? "tool";
      const args = obj(data.arguments ?? data.args);
      // Neon's safe-swap calls run after the verdict and are not re-checked.
      const pending = paneKey === "guarded" && STATE_CHANGING.has(name) && data.source !== "neon";
      const sum = STATE_CHANGING.has(name) ? summarizeCall(name, args, s.products) : null;
      const step: Step = {
        id,
        kind: e.kind,
        t_ms: e.t_ms,
        title: name,
        args,
        tone: pending ? "warn" : "neutral",
        spend: sum?.total ?? null,
        quantity: sum?.quantity ?? null,
        data,
      };
      return patchPane(s, paneKey, { ...base, status: running, steps: [...prev.steps, step] });
    }

    case "tool_result": {
      const name = str(data.name) ?? str(data.tool);
      const result = "result" in data ? data.result : data;
      const products = name === "get_product" || name === "lookup_catalog" ? rememberProduct(s.products, result) : s.products;
      const steps = [...prev.steps];
      let idx = -1;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].kind === "tool_call" && steps[i].result === undefined && (!name || steps[i].title === name)) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) steps[idx] = { ...steps[idx], result };
      else steps.push({ id, kind: e.kind, t_ms: e.t_ms, title: name ?? "result", result, tone: "neutral", data });
      return { ...patchPane(s, paneKey, { ...base, status: running, steps }), products };
    }

    case "intercepted": {
      const tool = str(data.tool) ?? str(data.name) ?? "call";
      const args = obj(data.arguments ?? data.args);
      const sum = summarizeCall(tool, args, s.products);
      const explicit = typeof data.hijacked === "boolean" ? (data.hijacked as boolean) : undefined;
      const hijack = paneKey === "victim" && (explicit ?? violatesIntent(sum, s.intent));
      const step: Step = {
        id,
        kind: e.kind,
        t_ms: e.t_ms,
        title: tool,
        args,
        tone: hijack ? "danger" : "warn",
        spend: sum.total,
        quantity: sum.quantity,
        data,
      };
      const attempted = Math.max(prev.attempted, sum.total ?? 0);
      let status: PaneStatus = running;
      if (paneKey === "victim") status = hijack || prev.status === "hijacked" ? "hijacked" : "intercepted";
      return patchPane(s, paneKey, { ...base, status, attempted, steps: [...prev.steps, step] });
    }

    case "verdict": {
      const v = data as unknown as Verdict;
      const steps = [...prev.steps];
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].kind === "tool_call" && steps[i].tone === "warn" && STATE_CHANGING.has(steps[i].title) && !steps[i].verdict) {
          steps[i] = { ...steps[i], verdict: v, tone: toneForVerdict(v) };
          break;
        }
      }
      const step: Step = {
        id,
        kind: e.kind,
        t_ms: e.t_ms,
        title: v.error ? "firewall_error" : v.action,
        tone: toneForVerdict(v),
        verdict: v,
        data,
      };
      const next = patchPane(s, paneKey, { ...base, status: statusForVerdict(v), steps: [...steps, step] });
      return {
        ...next,
        verdict: v,
        verdicts: [...s.verdicts, v],
        firewallError: v.error ? v.error : s.firewallError,
      };
    }

    case "fraud_card": {
      const card = data as unknown as FraudCard;
      const step: Step = { id, kind: e.kind, t_ms: e.t_ms, title: "fraud_card", tone: "neutral", data };
      return { ...patchPane(s, paneKey, { ...base, steps: [...prev.steps, step] }), fraudCard: card };
    }

    case "log": {
      const message = str(data.message) ?? str(data.msg) ?? str(data.text) ?? "";
      const step: Step = {
        id,
        kind: e.kind,
        t_ms: e.t_ms,
        title: str(data.stage) ?? str(data.source) ?? "log",
        message,
        tone: (str(data.tone) as Tone | undefined) ?? "neutral",
        data,
      };
      return patchPane(s, paneKey, { ...base, status: running, steps: [...prev.steps, step] });
    }

    case "done": {
      const finished = { ...base, finished: true };
      return { ...patchPane(s, paneKey, finished), done: true };
    }

    default:
      return s;
  }
}

export function parseJsonl(text: string): TraceEvent[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TraceEvent);
}

export function replayAll(events: TraceEvent[], intent: Intent | null = null): ArenaState {
  return events.reduce(applyEvent, initialState(intent));
}
