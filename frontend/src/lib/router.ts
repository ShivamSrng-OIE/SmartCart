/**
 * Landing-page search router: decides whether what someone typed is a product search (Shop),
 * a task for the shopping assistant, or a task that should go through Safe Checkout.
 *
 * Primary: the team backend at ENDPOINTS.router, which asks the Gemini Decisions API one
 * `choice` question (the key never reaches the browser). Fallback: the local rules below,
 * used when the endpoint is missing, slow (> 1.2 s) or returns something unreadable.
 */
import { ENDPOINTS } from "../config";

export type Route = "shop" | "assistant" | "safe";

export interface RouteDecision {
  route: Route;
  confidence: number;
  source: "decisions" | "local";
  text: string;
}

export const ROUTE_CHOICES: { id: Route; description: string }[] = [
  { id: "shop", description: "The user is looking for products to browse: a product name, category or brand to search for." },
  { id: "assistant", description: "The user wants something bought or chosen for them: a task, a request with a budget or quantity, or 'anything under $X'." },
  { id: "safe", description: "Same as assistant, but the user explicitly cares that the order is verified, safe, protected or legitimate." },
];

const SAFE = /\b(safe(ly)?|verif(y|ied)|protect(ed|ion)?|secure(ly)?|scam|fraud|legit(imate)?|trust(ed|worthy)?|careful(ly)?|no surprises)\b/i;
const TASK_START = /^(please\s+)?(buy|get|order|grab|purchase|pick|choose|find me|get me|show me something|help me|can you|could you|i need|i want|i'd like|i would like|we need|surprise me|add)\b/i;
const BUDGET = /(\$\s*\d|\b(under|below|less than|up to|within|budget|max(imum)?|i have|i've got|spend)\s+\$?\d)/i;
const OPEN = /\b(anything|something|whatever|gift|surprise|you choose|your choice)\b/i;
const QUANTITY = /\b(\d+|two|three|four|five|six|a dozen|a pair of|a couple of)\s+(bags?|packs?|bottles?|cans?|boxes?|of|x)\b/i;

/** Fast deterministic routing, used instantly while typing and as the fallback. */
export function routeLocally(raw: string): RouteDecision {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { route: "shop", confidence: 0.5, source: "local", text };
  let assistant = 0;
  if (TASK_START.test(text)) assistant += 0.45;
  if (BUDGET.test(text)) assistant += 0.3;
  if (OPEN.test(text)) assistant += 0.3;
  if (QUANTITY.test(text)) assistant += 0.2;
  if (/\bfor (my|me|a|the)\b/i.test(text)) assistant += 0.1;
  if (text.split(" ").length > 7) assistant += 0.1;
  const safe = SAFE.test(text);

  if (safe && assistant >= 0.3) return { route: "safe", confidence: Math.min(0.95, 0.6 + assistant / 2), source: "local", text };
  if (assistant >= 0.45) return { route: "assistant", confidence: Math.min(0.95, 0.5 + assistant / 2), source: "local", text };
  if (safe) return { route: "safe", confidence: 0.6, source: "local", text };
  return { route: "shop", confidence: Math.max(0.55, 0.9 - assistant), source: "local", text };
}

const isRoute = (v: unknown): v is Route => v === "shop" || v === "assistant" || v === "safe" || v === "safe_checkout";
const norm = (v: string): Route => (v === "safe_checkout" ? "safe" : (v as Route));

/** Read whatever reasonable shape the backend returns (flat, Decisions-style, or a probability map). */
export function parseRouterResponse(j: unknown, text: string): RouteDecision | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const answer = (o.answers as Record<string, unknown> | undefined)?.route ?? o.route ?? o.decision ?? o;
  const a = (typeof answer === "object" && answer ? answer : { choice: answer }) as Record<string, unknown>;
  const probs = (a.probabilities ?? a.probs ?? o.probabilities) as Record<string, number> | undefined;
  let choice = a.choice ?? a.route ?? a.answer;
  if (!isRoute(choice) && probs) choice = Object.entries(probs).sort((x, y) => y[1] - x[1])[0]?.[0];
  if (!isRoute(choice)) return null;
  const route = norm(choice as string);
  const p = probs?.[choice as string] ?? probs?.[route];
  return { route, confidence: typeof p === "number" ? p : 0.8, source: "decisions", text };
}

/** Ask the Decisions-API-backed router; fall back to local rules within 1.2 s. */
export async function routeQuery(text: string, signal?: AbortSignal): Promise<RouteDecision> {
  const local = routeLocally(text);
  if (!text.trim() || !ENDPOINTS.router) return local;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 1200);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const r = await fetch(ENDPOINTS.router, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, question: "Which page should handle this?", choices: ROUTE_CHOICES }),
    });
    if (!r.ok) return local;
    return parseRouterResponse(await r.json(), text) ?? local;
  } catch {
    return local;
  } finally {
    window.clearTimeout(timer);
  }
}
