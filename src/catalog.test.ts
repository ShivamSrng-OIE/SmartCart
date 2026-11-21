import { describe, expect, it } from "vitest";
import { normalizeProduct, plainText, splitQueries } from "./catalog";
import { minorToMajor } from "./shop";

// Trimmed from a real search_catalog response (shop.dev quickstart + live call).
const shopifyItem = {
  id: "gid://shopify/p/32dPMDD84TLtg3E5Hm8U3X",
  title: "Cold Brew Concentrate",
  description: { plain: "<p><meta charset=\"utf-8\">Slow steeped for <b>12 hours</b>.</p>\n<ul>\n<li>Smooth</li>\n<li>100% Arabica</li>\n</ul>" },
  rating: { value: 4.8, scale_min: 1, scale_max: 5, count: 485 },
  media: [{ type: "image", url: "https://cdn.shopify.com/s/files/1/x.jpg", alt_text: "Cold Brew" }],
  options: [{ name: "Flavor", values: [{ label: "Colombian" }, { label: "Decaf" }] }],
  price_range: { min: { amount: 1999, currency: "USD" }, max: { amount: 2499, currency: "USD" } },
  variants: [
    {
      id: "gid://shopify/ProductVariant/41939763101849",
      price: { amount: 1999, currency: "USD" },
      availability: { available: true },
      url: "https://brand.example/products/cold-brew?variant=41939763101849&_pos=1&_sid=abc",
      seller: { id: "gid://shopify/Shop/1", name: "Brand Coffee", url: "https://brand.example", domain: "brand-coffee.myshopify.com" },
    },
  ],
};

describe("normalizeProduct (Shop MCP shape)", () => {
  const p = normalizeProduct(shopifyItem)!;

  it("converts minor-unit prices to dollars", () => {
    expect(p.price).toBe(19.99);
    expect(p.currency).toBe("USD");
  });

  it("takes the shop domain and variant id from the featured variant", () => {
    expect(p.shop).toBe("brand-coffee.myshopify.com");
    expect(p.shopName).toBe("Brand Coffee");
    expect(p.variantId).toBe("gid://shopify/ProductVariant/41939763101849");
  });

  it("keeps the product URL exactly as returned, query string included", () => {
    expect(p.url).toBe("https://brand.example/products/cold-brew?variant=41939763101849&_pos=1&_sid=abc");
  });

  it("uses the first image and plain-text description", () => {
    expect(p.image).toBe("https://cdn.shopify.com/s/files/1/x.jpg");
    expect(p.description).not.toMatch(/<|>/);
    expect(p.description).toContain("12 hours");
    expect(p.description).toContain("• Smooth");
  });

  it("reads rating, availability and options", () => {
    expect(p.rating).toEqual({ value: 4.8, count: 485 });
    expect(p.available).toBe(true);
    expect(p.options[0]).toEqual({ name: "Flavor", values: ["Colombian", "Decaf"] });
  });

  it("returns null instead of throwing on junk", () => {
    expect(normalizeProduct(null)).toBeNull();
    expect(normalizeProduct({ title: "no id" })).toBeNull();
  });

  it("still reads the demo catalog shape (major units)", () => {
    expect(normalizeProduct({ id: "x", title: "Mug", price: 24, seller: { domain: "kiln.example", name: "Kiln" } })).toMatchObject({ price: 24, shop: "kiln.example" });
  });
});

describe("helpers", () => {
  it("minorToMajor respects currency decimals", () => {
    expect(minorToMajor(6400, "CAD")).toBe(64);
    expect(minorToMajor(1500, "JPY")).toBe(1500);
    expect(minorToMajor("abc")).toBeNull();
  });

  it("splitQueries splits on commas, semicolons and new lines, dropping blanks and repeats", () => {
    expect(splitQueries("cold brew, mug,granola ; Mug\n insulated  bottle ,, ")).toEqual(["cold brew", "mug", "granola", "insulated bottle"]);
    expect(splitQueries("single item")).toEqual(["single item"]);
  });

  it("plainText strips tags and scripts", () => {
    expect(plainText("<script>alert(1)</script><p>Hi &amp; bye</p>")).toBe("Hi & bye");
  });

  it("plainText drops embedded media fallback text", () => {
    expect(plainText('<p>Comfy</p><video controls><source src="a.mp4">Your browser does not support HTML5 video.</video>')).toBe("Comfy");
  });
});
