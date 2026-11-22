import { describe, expect, it } from "vitest";
import { applyEvent, initialState, type ArenaState } from "../state";
import type { TraceEvent } from "../types";
import { checkStages, currentActivity } from "./progress";

const ev = (kind: TraceEvent["kind"], data: Record<string, unknown>, pane: TraceEvent["pane"] = "guarded"): TraceEvent => ({ run_id: "r", pane, t_ms: 1, kind, data });
const run = (events: TraceEvent[]): ArenaState => events.reduce(applyEvent, initialState(null, "r"));
const facts = { photos: 2 };
const status = (s: ArenaState) => Object.fromEntries(checkStages(s, facts).map((x) => [x.id, x.status]));

describe("the live check progress", () => {
  it("starts with the listing being read and the firewall being asked, at the same time", () => {
    const s = run([ev("tool_call", { tool: "create_cart" })]);
    expect(status(s)).toEqual({ reading: "active", firewall: "active", decision: "todo" });
    expect(checkStages(s, facts)[0].label).toBe("Reading 2 photos and the description");
    expect(currentActivity(s, facts)).toBe("Reading and checking the order");
  });

  it("marks reading done when Argon's reading arrives, then decides at the verdict", () => {
    const read = run([ev("tool_call", { tool: "create_cart" }), ev("log", { event: "perception", message: "Argon read the listing" })]);
    expect(status(read)).toEqual({ reading: "done", firewall: "active", decision: "todo" });
    const approved = run([ev("log", { event: "perception" }), ev("verdict", { action: "approve_checkout", probes: [], action_probs: {}, severity: 0, latency_ms: 5, tier: "low", backend: "decisions" })]);
    expect(status(approved)).toEqual({ reading: "done", firewall: "done", decision: "done" });
    expect(checkStages(approved, facts)[2].label).toMatch(/^Approved/);
  });

  it("adds the follow-up work for a held order and ticks each off as its result arrives", () => {
    const base = [ev("log", { event: "perception" }), ev("verdict", { action: "hard_block_quarantine", probes: [], action_probs: {}, severity: 3, latency_ms: 5, tier: "low", backend: "decisions" })];
    expect(status(run(base))).toEqual({ reading: "done", firewall: "done", decision: "done", alternative: "active", evidence: "active", explain: "active" });
    const card = { reason: "r", media_claimed: [], shopify_sells: null, top_probes: [], dollars_defended: 1, safe_cart: { total: 10 } };
    const more = run([...base, ev("fraud_card", card), ev("evidence", { items: [{ modality: "text", text: "t", before: "", after: "" }] })]);
    expect(status(more)).toMatchObject({ alternative: "done", evidence: "done", explain: "active" });
    const finished = run([...base, ev("fraud_card", card), ev("done", {}, "system")]);
    expect(Object.values(status(finished)).every((v) => v === "done")).toBe(true);
    expect(currentActivity(finished, facts)).toBe("Finishing up");
  });

  it("describes the listing's media in plain words", () => {
    const s = initialState(null, "r");
    expect(checkStages(s, { photos: 1 })[0].label).toBe("Reading 1 photo and the description");
    expect(checkStages(s, { photos: 3, hasVideo: true, hasAudio: true })[0].label).toBe("Reading 3 photos, the video, the audio and the description");
    expect(checkStages(s, { photos: 0 })[0].label).toBe("Reading the description");
  });
});
