import { describe, expect, it } from "vitest";
import { isApiRequest } from "./session";

describe("which requests carry the session id", () => {
  const origin = "http://localhost:5173";
  it("sends it to our API, relative or absolute", () => {
    expect(isApiRequest("/api/trust", origin)).toBe(true);
    expect(isApiRequest("http://localhost:5173/api/check-cart", origin)).toBe(true);
  });
  it("never sends it anywhere else", () => {
    expect(isApiRequest("/shop-mcp", origin)).toBe(false);
    expect(isApiRequest("/media/warehouse/x.jpg", origin)).toBe(false);
    expect(isApiRequest("https://cdn.shopify.com/s/files/x.jpg", origin)).toBe(false);
    expect(isApiRequest("https://evil.example/api/trust", origin)).toBe(false);
  });
});
