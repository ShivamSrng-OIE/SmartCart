import { describe, expect, it } from "vitest";
import { cleanRequest, parseIntent, parseItems } from "./intent";

describe("parseIntent", () => {
  it("reads budget and quantity from a plain request", () => {
    expect(parseIntent("buy one pack of these under $25", "")).toEqual({ text: "buy one pack of these under $25", budget: 25, quantity: 1 });
  });

  it("lets the budget field win over the text", () => {
    expect(parseIntent("buy one under $25", "40").budget).toBe(40);
  });

  it("has no budget when none is given", () => {
    expect(parseIntent("buy one of these", "").budget).toBeNull();
  });

  it("totals units across comma-separated items", () => {
    expect(parseIntent("buy 2 mugs, a bag of granola,3 cans of sparkling water under $60", "")).toMatchObject({ budget: 60, quantity: 6 });
  });

  it("handles 'and' / '&' between items and messy spacing", () => {
    expect(parseIntent("get two  cold brews   and one mug & a granola", "").quantity).toBe(4);
  });
});

describe("parseItems", () => {
  it("splits on commas with or without a space", () => {
    expect(parseItems("2 mugs,granola, 3 x sparkling water")).toEqual([
      { quantity: 2, name: "mugs" },
      { quantity: 1, name: "granola" },
      { quantity: 3, name: "sparkling water" },
    ]);
  });

  it("drops the leading verb and the budget phrase", () => {
    expect(parseItems("Please buy me a dozen eggs under $10")).toEqual([{ quantity: 12, name: "eggs" }]);
  });

  it("ignores trailing separators", () => {
    expect(parseItems("buy a mug, , ")).toEqual([{ quantity: 1, name: "mug" }]);
  });
});

describe("cleanRequest", () => {
  it("normalizes quotes, spaces and separators", () => {
    expect(cleanRequest("  buy “2”   mugs ,granola;; ")).toBe('buy "2" mugs, granola');
  });
});
