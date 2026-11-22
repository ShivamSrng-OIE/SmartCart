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
        const running = s.active ?? s.provider; // while free OpenRouter models are rate limited, Gemini does the work
        const first = (role: string) => shortModel(s.roles.find((r) => r.id === role)?.models[running]?.[0] ?? "");
        const value: ModelLabels = { provider: running, shopper: first("shopper"), perception: first("perception"), firewall: first("firewall"), defender: first("defender") };
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
