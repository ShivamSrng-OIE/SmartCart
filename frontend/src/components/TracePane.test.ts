import { describe, expect, it } from "vitest";
import { plainText } from "./TracePane";

describe("assistant messages read as plain sentences", () => {
  it("drops markdown bold and list dashes", () => {
    expect(plainText("I found the **Northwind Hoodie** for **$53.00 USD**: - **Size S** - $53.00")).toBe("I found the Northwind Hoodie for $53.00 USD: Size S $53.00");
  });
  it("keeps ordinary text and hyphenated words", () => {
    expect(plainText("A well-made hoodie, 2-pack.")).toBe("A well-made hoodie, 2-pack.");
    expect(plainText(undefined)).toBe("");
  });
});
