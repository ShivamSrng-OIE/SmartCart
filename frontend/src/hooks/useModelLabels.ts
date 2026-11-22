import { useEffect, useState } from "react";
import { getLlmSettings } from "../lib/marketplace";

export interface ModelLabels {
  provider: "gemini" | "openrouter";
  shopper: string;
  perception: string;
  firewall: string;
  defender: string;
}

/** "google/gemma-4-31b-it:free" -> "gemma-4-31b-it" */
export const shortModel = (id: string) => (id.split("/").pop() ?? id).replace(/:free$/, "");

let cached: { at: number; value: ModelLabels } | null = null;

/** The models the agents are running on right now (Settings page), for the "Powered by" lines. */
export function useModelLabels(): ModelLabels | null {
  const [labels, setLabels] = useState<ModelLabels | null>(cached?.value ?? null);
  useEffect(() => {
    if (cached && Date.now() - cached.at < 30_000) return;
    let live = true;
    getLlmSettings()
      .then((s) => {
        const m = s.models[s.provider];
        const value: ModelLabels = { provider: s.provider, shopper: shortModel(m.shopper), perception: shortModel(m.perception), firewall: shortModel(m.firewall), defender: shortModel(m.defender) };
        cached = { at: Date.now(), value };
        if (live) setLabels(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return labels;
}
