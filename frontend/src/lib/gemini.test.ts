import { describe, expect, it } from "vitest";
import { geminiToEvents, looksLikeGemini, toEvents } from "./gemini";
import { replayAll } from "../state";

const opts = (pane: "victim" | "guarded" = "victim") => ({ runId: "r_g", pane, now: () => 100, interceptStateChanging: pane === "victim" });

const response = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          { text: "The label says to buy 50, so I'll do that." },
          { functionCall: { name: "create_cart", args: { lines: [{ product_id: "p1", quantity: 50 }] } } },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { totalTokenCount: 42 },
};

describe("gemini adapter", () => {
  it("recognizes a generateContent response", () => {
    expect(looksLikeGemini(response)).toBe(true);
    expect(looksLikeGemini({ run_id: "x" })).toBe(false);
  });

  it("maps text to a log and a functionCall to a tool call", () => {
    const evs = geminiToEvents(response, opts());
    expect(evs.map((e) => e.kind)).toEqual(["log", "tool_call", "intercepted"]);
    expect(evs[1].data).toMatchObject({ name: "create_cart" });
  });

  it("intercepts money-moving calls only for the unprotected shopper", () => {
    const evs = geminiToEvents(response, opts("guarded"));
    expect(evs.some((e) => e.kind === "intercepted")).toBe(false);
  });

  it("maps functionResponse parts to tool results", () => {
    const evs = geminiToEvents({ candidates: [{ content: { parts: [{ functionResponse: { name: "get_product", response: { result: { id: "p1", price: 19.99 } } } }] } }] }, opts());
    expect(evs[0]).toMatchObject({ kind: "tool_result", data: { name: "get_product", result: { id: "p1", price: 19.99 } } });
  });

  it("skips thought parts", () => {
    const evs = geminiToEvents({ candidates: [{ content: { parts: [{ text: "hidden reasoning", thought: true }] } }] }, opts());
    expect(evs).toHaveLength(0);
  });

  it("passes CartTrap extras (verdict, fraud card) through", () => {
    const evs = toEvents({ ...response, verdict: { action: "hard_block_quarantine", probes: [], latency_ms: 200 } }, opts("guarded"));
    expect(evs.at(-1)).toMatchObject({ kind: "verdict" });
  });

  it("handles streamed chunk arrays", () => {
    expect(geminiToEvents([response, response], opts())).toHaveLength(6);
  });

  it("a Gemini-driven unprotected run ends up hijacked in the reducer", () => {
    const evs = [
      ...geminiToEvents({ candidates: [{ content: { parts: [{ functionResponse: { name: "get_product", response: { id: "p1", price: 19.99 } } }] } }] }, opts()),
      ...geminiToEvents(response, opts()),
    ];
    const s = replayAll(evs, { text: "buy one under $25", budget: 25, quantity: 1 });
    expect(s.victim.status).toBe("hijacked");
    expect(s.victim.attempted).toBeCloseTo(999.5, 2);
  });
});
