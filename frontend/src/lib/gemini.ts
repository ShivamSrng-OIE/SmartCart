/**
 * Gemini-compatible adapter: turns Gemini API response shapes into the arena's TraceEvents,
 * so a backend can return Gemini output as-is and the UI still renders every step.
 *
 * Accepted shapes (per response, or per SSE chunk):
 *  - GenerateContentResponse:  { candidates: [{ content: { parts: [...] } }], usageMetadata? }
 *  - an array of those (streamGenerateContent with alt=json)
 *  - parts: { text } → log · { functionCall: {name, args} } → tool_call · { functionResponse: {name, response} } → tool_result
 *  - CartTrap extras a backend may attach next to `candidates`: { verdict }, { fraud_card }, { intercepted }, { events: TraceEvent[] }
 */
import type { Pane, TraceEvent } from "../types";
import { STATE_CHANGING } from "./spend";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export function looksLikeGemini(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(looksLikeGemini);
  return isObj(v) && (Array.isArray(v.candidates) || isObj(v.functionCall) || "promptFeedback" in v);
}

export function looksLikeTraceEvent(v: unknown): v is TraceEvent {
  return isObj(v) && typeof v.kind === "string" && typeof v.pane === "string" && "data" in v;
}

export interface GeminiMapOptions {
  runId: string;
  pane: Pane;
  /** ms since the run started; supplied by the caller so streamed chunks keep real timing */
  now: () => number;
  /** the unprotected shopper's state-changing calls are logged as intercepted (dry-run) */
  interceptStateChanging?: boolean;
  model?: string;
}

/** Map one Gemini response (or chunk) to zero or more TraceEvents. */
export function geminiToEvents(raw: unknown, o: GeminiMapOptions): TraceEvent[] {
  if (Array.isArray(raw)) return raw.flatMap((r) => geminiToEvents(r, o));
  if (!isObj(raw)) return [];
  const ev = (kind: TraceEvent["kind"], data: Obj): TraceEvent => ({ run_id: o.runId, pane: o.pane, t_ms: Math.round(o.now()), kind, data });
  const out: TraceEvent[] = [];

  // Pre-built TraceEvents win.
  if (Array.isArray(raw.events)) out.push(...(raw.events as unknown[]).filter(looksLikeTraceEvent));

  const candidates = Array.isArray(raw.candidates) ? (raw.candidates as Obj[]) : [];
  for (const cand of candidates.slice(0, 1)) {
    const parts = Array.isArray((cand.content as Obj | undefined)?.parts) ? ((cand.content as Obj).parts as Obj[]) : [];
    for (const part of parts) {
      if (typeof part.text === "string" && part.text.trim() && !part.thought) {
        out.push(ev("log", { source: o.pane === "victim" ? "hydrogen" : "carttrap", message: part.text.trim(), model: o.model }));
      }
      if (isObj(part.functionCall)) {
        const name = String(part.functionCall.name ?? "tool");
        const args = isObj(part.functionCall.args) ? part.functionCall.args : {};
        out.push(ev("tool_call", { name, arguments: args }));
        if (o.interceptStateChanging && STATE_CHANGING.has(name)) out.push(ev("intercepted", { intercepted: true, tool: name, arguments: args }));
      }
      if (isObj(part.functionResponse)) {
        const name = String(part.functionResponse.name ?? "tool");
        const resp = part.functionResponse.response;
        out.push(ev("tool_result", { name, result: isObj(resp) && "result" in resp ? resp.result : resp }));
      }
    }
    const reason = cand.finishReason;
    if (typeof reason === "string" && /SAFETY|BLOCKLIST|PROHIBITED|SPII/.test(reason)) {
      out.push(ev("log", { source: "carttrap", message: `Gemini stopped the response (${reason}).`, tone: "warn" }));
    }
  }

  if (isObj(raw.promptFeedback) && raw.promptFeedback.blockReason) {
    out.push(ev("log", { source: "carttrap", message: `Gemini blocked the prompt (${String(raw.promptFeedback.blockReason)}).`, tone: "warn" }));
  }
  if (isObj(raw.intercepted)) out.push(ev("intercepted", raw.intercepted));
  if (isObj(raw.verdict)) out.push(ev("verdict", raw.verdict));
  if (isObj(raw.fraud_card)) out.push(ev("fraud_card", raw.fraud_card));
  return out;
}

/** Normalize anything a backend sends on the stream into TraceEvents. */
export function toEvents(payload: unknown, o: GeminiMapOptions): TraceEvent[] {
  if (looksLikeTraceEvent(payload)) return [payload];
  if (Array.isArray(payload) && payload.every(looksLikeTraceEvent)) return payload;
  if (looksLikeGemini(payload) || (isObj(payload) && (payload.events || payload.verdict || payload.fraud_card))) return geminiToEvents(payload, o);
  return [];
}
