import { useCallback, useEffect, useState } from "react";
import { getEvalLatest, getRules, health, sampleEval, sampleRules } from "../api";
import type { EvalResults, RuleSet } from "../types";

export type Mode = "live" | "replay";
export type Source = "live" | "sample";

export interface Backend {
  mode: Mode;
  setMode: (m: Mode) => void;
  online: boolean | null;
  rules: RuleSet;
  rulesSource: Source;
  evalResults: EvalResults;
  evalSource: Source;
  refresh: () => void;
  bumpRules: (version: number) => void;
}

/**
 * Decides live vs replay. Live when the backend answers /health; the user can force replay
 * (rehearsal, venue Wi-Fi down). Rules and eval fall back to bundled samples, clearly labelled.
 */
export function useBackend(): Backend {
  const [online, setOnline] = useState<boolean | null>(null);
  const [mode, setModeState] = useState<Mode>("replay");
  const [userPicked, setUserPicked] = useState(false);
  const [rules, setRules] = useState<RuleSet>(sampleRules);
  const [rulesSource, setRulesSource] = useState<Source>("sample");
  const [evalResults, setEval] = useState<EvalResults>(sampleEval);
  const [evalSource, setEvalSource] = useState<Source>("sample");

  const load = useCallback(async () => {
    const ok = await health();
    setOnline(ok);
    if (!userPicked) setModeState(ok ? "live" : "replay");
    if (!ok) return;
    getRules()
      .then((r) => {
        if (r.probes.length) {
          setRules(r);
          setRulesSource("live");
        }
      })
      .catch(() => undefined);
    getEvalLatest()
      .then((e) => {
        if (Object.keys(e.systems).length) {
          setEval(e);
          setEvalSource("live");
        }
      })
      .catch(() => undefined);
  }, [userPicked]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void health().then(setOnline), 15000);
    return () => window.clearInterval(id);
  }, [load]);

  const setMode = useCallback((m: Mode) => {
    setUserPicked(true);
    setModeState(m);
  }, []);

  const bumpRules = useCallback((version: number) => setRules((r) => ({ ...r, version: Math.max(r.version, version) })), []);

  return { mode, setMode, online, rules, rulesSource, evalResults, evalSource, refresh: () => void load(), bumpRules };
}
