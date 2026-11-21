import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEMO_MODE, SCENARIOS, type FixtureName, type Scenario } from "./config";
import { findDemo, firstLiveProduct, refFromProduct, type ProductRef } from "./catalog";
import { parseIntent, requestText } from "./lib/intent";
import type { Intent } from "./types";

export type MediaKind = "image" | "audio" | "video" | "pdf";

export interface Attached {
  kind: MediaKind;
  blob: Blob;
  name: string;
  url: string;
  source: "camera" | "upload" | "mic";
}

/** One test, shared by every mode so you can run the same attack on both shoppers. */
export interface Draft {
  request: string;
  budget: string;
  product: ProductRef | null;
  media: Partial<Record<MediaKind, Attached>>;
  scenarioId: string | null;
}

interface DraftApi {
  draft: Draft;
  intent: Intent;
  fixture: FixtureName;
  scenario: Scenario | null;
  set: (patch: Partial<Draft>) => void;
  attach: (kind: MediaKind, blob: Blob, name: string, source: Attached["source"]) => void;
  detach: (kind: MediaKind) => void;
  pickScenario: (s: Scenario) => void;
  toForm: () => FormData;
}

const Ctx = createContext<DraftApi | null>(null);

function initial(): Draft {
  const s = SCENARIOS[0];
  const p = DEMO_MODE ? findDemo(s.productId) : null;
  return { request: s.request, budget: s.budget, product: p ? refFromProduct(p) : null, media: {}, scenarioId: s.id };
}

export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(initial);

  const set = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);

  const attach = useCallback((kind: MediaKind, blob: Blob, name: string, source: Attached["source"]) => {
    setDraft((d) => {
      if (d.media[kind]) URL.revokeObjectURL(d.media[kind]!.url);
      return { ...d, media: { ...d.media, [kind]: { kind, blob, name, url: URL.createObjectURL(blob), source } } };
    });
  }, []);

  const detach = useCallback((kind: MediaKind) => {
    setDraft((d) => {
      if (d.media[kind]) URL.revokeObjectURL(d.media[kind]!.url);
      const media = { ...d.media };
      delete media[kind];
      return { ...d, media };
    });
  }, []);

  // Examples get a real Shopify product: the first live match for the example's search.
  const liveReq = useRef(0);
  const attachLive = useCallback((s: Scenario) => {
    const ticket = ++liveReq.current;
    void firstLiveProduct(s.search).then((p) => {
      if (!p || ticket !== liveReq.current) return;
      setDraft((d) => (d.scenarioId === s.id ? { ...d, product: refFromProduct(p) } : d));
    });
  }, []);

  const pickScenario = useCallback(
    (s: Scenario) => {
      const p = DEMO_MODE ? findDemo(s.productId) : null;
      setDraft((d) => ({ ...d, request: s.request, budget: s.budget, product: p ? refFromProduct(p) : null, scenarioId: s.id }));
      attachLive(s);
    },
    [attachLive],
  );

  useEffect(() => {
    attachLive(SCENARIOS[0]);
  }, [attachLive]);

  const value = useMemo<DraftApi>(() => {
    const scenario = SCENARIOS.find((s) => s.id === draft.scenarioId) ?? null;
    return {
      draft,
      intent: parseIntent(draft.request, draft.budget),
      fixture: scenario?.fixture ?? "attack",
      scenario,
      set,
      attach,
      detach,
      pickScenario,
      toForm: () => {
        const form = new FormData();
        const budgetNum = Number.parseFloat(draft.budget);
        form.set("request", requestText(draft.request, Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : null).slice(0, 1000));
        if (draft.budget.trim()) form.set("budget", draft.budget.trim());
        if (draft.product?.url) form.set("product_url", draft.product.url);
        if (draft.product?.id) {
          form.set("product_id", draft.product.id);
          form.set("demo_product_id", draft.product.id); // older backend field name
        }
        for (const m of Object.values(draft.media)) if (m) form.set(m.kind, m.blob, m.name);
        return form;
      },
    };
  }, [draft, set, attach, detach, pickScenario]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDraft(): DraftApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDraft must be used inside <DraftProvider>");
  return v;
}
