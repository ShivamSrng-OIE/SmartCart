import { describe, expect, it } from "vitest";
import { parseRouterResponse, routeLocally } from "./router";

describe("routeLocally", () => {
  it("sends product words to Shop", () => {
    expect(routeLocally("cold brew").route).toBe("shop");
    expect(routeLocally("ceramic mug, granola").route).toBe("shop");
  });

  it("sends tasks and budgets to the assistant", () => {
    expect(routeLocally("buy me one pack of cold brew under $25").route).toBe("assistant");
    expect(routeLocally("I have $30, get anything nice").route).toBe("assistant");
    expect(routeLocally("something for my dad under 40").route).toBe("assistant");
  });

  it("sends verification-minded tasks to Safe Checkout", () => {
    expect(routeLocally("buy 2 mugs but make sure the order is verified").route).toBe("safe");
    expect(routeLocally("order a legit flash drive under $20, no scams").route).toBe("safe");
  });
});

describe("parseRouterResponse", () => {
  it("reads a flat choice", () => {
    expect(parseRouterResponse({ choice: "assistant", probabilities: { assistant: 0.91 } }, "x")).toMatchObject({ route: "assistant", confidence: 0.91, source: "decisions" });
  });

  it("reads a Decisions-style answers block and safe_checkout alias", () => {
    expect(parseRouterResponse({ answers: { route: { choice: "safe_checkout", probabilities: { safe_checkout: 0.8 } } } }, "x")?.route).toBe("safe");
  });

  it("picks the top probability when no choice is given", () => {
    expect(parseRouterResponse({ probabilities: { shop: 0.2, assistant: 0.7, safe: 0.1 } }, "x")?.route).toBe("assistant");
  });

  it("returns null on junk", () => {
    expect(parseRouterResponse({ choice: "checkout-page" }, "x")).toBeNull();
    expect(parseRouterResponse(null, "x")).toBeNull();
  });
});
