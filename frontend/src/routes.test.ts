import { describe, expect, it } from "vitest";
import { parseRoute, pathFor, PATHS } from "./App";

describe("every page has its own address", () => {
  it("reads clean paths", () => {
    expect(parseRoute("/results")).toEqual({ view: "results", productId: null });
    expect(parseRoute("/safe-checkout/")).toEqual({ view: "protected", productId: null });
    expect(parseRoute("/product/wh%3Astreetform-bold-type-hoodie")).toEqual({ view: "product", productId: "wh:streetform-bold-type-hoodie" });
    expect(parseRoute("/nowhere")).toEqual({ view: "home", productId: null });
  });
  it("keeps old #/ links working, but not the skip link", () => {
    expect(parseRoute("/", "#/trust")).toEqual({ view: "trust", productId: null });
    expect(parseRoute("/", "#/product/gid%3A%2F%2Fshopify%2Fp%2F1")).toEqual({ view: "product", productId: "gid://shopify/p/1" });
    expect(parseRoute("/shop", "#main")).toEqual({ view: "shop", productId: null });
  });
  it("round-trips every page", () => {
    for (const view of Object.keys(PATHS)) expect(parseRoute(pathFor(view as never))).toEqual({ view, productId: null });
    expect(pathFor("product", "wh:x")).toBe("/product/wh%3Ax");
  });
});
