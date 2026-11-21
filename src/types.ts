// Mirrors backend/schemas.py (contract C1, plan.md Task 3). Keep field names identical.

export type Pane = "victim" | "guarded" | "redteam";

export type EventKind =
  | "tool_call"
  | "tool_result"
  | "intercepted"
  | "verdict"
  | "fraud_card"
  | "log"
  | "done";

export interface TraceEvent {
  run_id: string;
  pane: Pane;
  t_ms: number;
  kind: EventKind;
  data: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type ProbeCategory =
  | "injection"
  | "pack_lie"
  | "spend_hijack"
  | "coercion"
  | "split_payload"
  | "privacy"
  | "promo_benign";

export interface Probe {
  id: string;
  type: "noul" | "choice" | "score";
  category: ProbeCategory;
  instructions: string;
  threshold: number;
  tiers?: Record<string, number>;
  added_by: string;
  created_at?: string;
}

export interface RuleSet {
  version: number;
  probes: Probe[];
}

export interface ProbeResult {
  id: string;
  p: number;
  fired: boolean;
}

export type Action = "approve_checkout" | "escalate_to_neon_swap" | "hard_block_quarantine";
export type Tier = "low" | "normal" | "high" | "spend_request";

export interface Verdict {
  action: Action;
  action_probs: Record<string, number>;
  probes: ProbeResult[];
  severity: number;
  latency_ms: number;
  tier: Tier;
  backend: "decisions" | "json_llm";
  error?: string | null;
}

/** Defender safe swap (ADR m4/0008): continue_url must be shown exactly as returned. */
export interface SafeCart {
  checkout_id?: string | null;
  cart_id?: string | null;
  continue_url?: string | null;
  checkout_url?: string | null;
  shop?: string | null;
  title?: string | null;
  line_items?: { product_id: string; quantity: number; title?: string; price?: number }[];
  total: number;
  intercepted?: boolean;
}

export interface FraudCard {
  reason: string;
  media_claimed: string[];
  shopify_sells: Record<string, unknown> | null;
  top_probes: ProbeResult[];
  dollars_defended: number;
  safe_cart: SafeCart | null;
}

export interface Intent {
  text: string;
  budget: number | null;
  quantity: number;
}

/** eval/metrics.py Metrics (contract C6). */
export interface Metrics {
  asr: number;
  benign_completion: number;
  p50_ms: number;
  p95_ms: number;
  dollars_defended: number;
  n_attack: number;
  n_benign: number;
}

export interface EvalFailure {
  case_id: string;
  vector?: string;
  system?: string;
  note?: string;
}

export interface EvalResults {
  systems: Partial<Record<"baseline" | "hardened" | "carttrap", Metrics>>;
  meta?: {
    case_dir_hash?: string;
    git_sha?: string;
    started_at?: string;
    shop_mode?: string;
    model_ids?: Record<string, string>;
    backend?: string;
    label?: string;
  };
  failures?: EvalFailure[];
}
