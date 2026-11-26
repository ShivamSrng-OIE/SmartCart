import { useCallback, useEffect, useState } from "react";
import { defaultRules, getEvalLatest, getRules, healthInfo, recordedEval, type ServiceLimits } from "../api";
import { REPLAY_MODE } from "../config";
import type { EvalResults, RuleSet } from "../types";

export type Mode = "live" | "replay";

export interface Backend {
  mode: Mode;
  online: boolean | null;
  /** the shared model keys' state (rate limited, quota used up): the app then suggests adding your own key */
  limits: ServiceLimits | null;
  rules: RuleSet;
  evalResults: EvalResults | null;
  refresh: () => void;
  bumpRules: (version: number) => void;
}

/**
 * Live APIs only. The rule set starts from the default shipped with the site and is replaced
 * by GET /api/rules; eval results only ever come from GET /api/eval/latest.
 */
export function useBackend(): Backend {
  const [online, setOnline] = useState<boolean | null>(null);
  const [limits, setLimits] = useState<ServiceLimits | null>(null);
  const [rules, setRules] = useState<RuleSet>(defaultRules);
  const [evalResults, setEval] = useState<EvalResults | null>(() => (REPLAY_MODE ? recordedEval() : null));

  const load = useCallback(async () => {
    const h = await healthInfo();
    const ok = h.ok;
    setOnline(ok);
    setLimits(h.limits);
    if (!ok) return;
    getRules()
      .then((r) => r.probes.length && setRules(r))
      .catch(() => undefined);
    getEvalLatest()
      .then((e) => Object.keys(e.systems).length && setEval(e))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(
      () =>
        void healthInfo().then((h) => {
          setOnline(h.ok);
          setLimits(h.limits);
        }),
      15000,
    );
    return () => window.clearInterval(id);
  }, [load]);

  const bumpRules = useCallback((version: number) => setRules((r) => ({ ...r, version: Math.max(r.version, version) })), []);

  return { mode: REPLAY_MODE ? "replay" : "live", online, limits, rules, evalResults, refresh: () => void load(), bumpRules };
}
