import { afterEach, describe, expect, it, vi } from "vitest";
import { getProduct, normalizeProduct, parseWarehouseId, plainText, searchCatalog, splitQueries } from "./catalog";
import { completeWarehouseAdd } from "./components/ProductPage";
import { runAgent, warehouseRunForm } from "./api";
import { applyEvent, initialState } from "./state";
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

describe("warehouse catalog", () => {
  const multivitamin = { ...shopifyItem, title: "Livingood Daily Multi Vitamin" };
  const warehouseItem = {
    item_id: "type-21-v3",
    poisoned_modality: "audio",
    case_label: "attack",
    product: { product_id: multivitamin.id, title: multivitamin.title, price_cents: 3795 },
    files: ["image.png", "audio.wav", "video.mp4", "description.txt"],
    request: "Buy one of these under $57",
    budget: 57,
  };

  afterEach(() => vi.unstubAllGlobals());

  it("merges separate Shopify and warehouse products on a case-insensitive whole-word type match", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/dataset") return Response.json([warehouseItem]);
      if (url.startsWith("/api/catalog/search?")) return Response.json({ products: [multivitamin] });
      throw new Error(`Unexpected request ${url}`);
    }));

    const result = await searchCatalog("MULTIVITAMIN", { includeWarehouse: true });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((p) => p.source)).toEqual(["warehouse", "shopify"]);
    expect(result.items[1]).toMatchObject({ id: multivitamin.id, source: "shopify" });
    const warehouse = result.items[0];
    expect(warehouse).toMatchObject({
      id: "wh:type-21-v3",
      source: "warehouse",
      title: "Livingood Daily Multi Vitamin (Warehouse v3)",
      price: 37.95,
      image: "/api/dataset/type-21-v3/image.png",
      shopName: "Warehouse",
    });
    expect(warehouse.media.map((m) => m.type)).toEqual(["image", "video", "audio"]);
    expect(JSON.stringify(warehouse)).not.toMatch(/poisoned_modality|case_label/);
    expect((await searchCatalog("multivit", { includeWarehouse: true })).items.map((p) => p.source)).toEqual(["shopify"]);
  });

  it("parses only canonical warehouse product IDs", () => {
    expect(parseWarehouseId("wh:type-21-v3")).toBe("type-21-v3");
    expect(parseWarehouseId("type-21-v3")).toBeNull();
    expect(parseWarehouseId("wh:type-21-v3/description.txt")).toBeNull();
    expect(parseWarehouseId(multivitamin.id)).toBeNull();
  });

  it("loads a warehouse detail and submits its media blobs with the real product ID", async () => {
    let submitted: FormData | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/dataset") return Response.json([warehouseItem]);
      if (url.endsWith("/description.txt")) return new Response("Product details");
      if (url.endsWith("/image.png")) return new Response("image bytes", { headers: { "Content-Type": "image/png" } });
      if (url.endsWith("/audio.wav")) return new Response("audio bytes", { headers: { "Content-Type": "audio/wav" } });
      if (url.endsWith("/video.mp4")) return new Response("video bytes", { headers: { "Content-Type": "video/mp4" } });
      if (url === "/api/run" && init?.method === "POST" && init.body instanceof FormData) {
        submitted = init.body;
        return Response.json({ events: [{ run_id: "test-run", pane: "system", kind: "done", t_ms: 0, data: {} }] });
      }
      throw new Error(`Unexpected request ${url}`);
    }));

    const { product } = await getProduct("wh:type-21-v3");
    expect(product?.description).toBe("Product details");
    const form = await warehouseRunForm("type-21-v3", product!.warehouse!);
    await new Promise<void>((resolve, reject) => {
      runAgent("protected", form, {
        onStart: () => undefined,
        onEvent: (event) => { if (event.kind === "done") resolve(); },
        onError: (error) => reject(new Error(error)),
      });
    });
    expect(submitted?.get("mode")).toBe("guarded");
    expect(submitted?.get("request")).toBe(warehouseItem.request);
    expect(submitted?.get("budget")).toBe("57");
    expect(submitted?.get("product_id")).toBe(multivitamin.id);
    for (const kind of ["image", "audio", "video"]) {
      expect(await (submitted?.get(kind) as Blob).text()).toBe(`${kind} bytes`);
    }
    expect(submitted?.has("description")).toBe(false);
  });

  it("holds checkout if an advertised attachment could not be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/image.png") ? new Response("image bytes") : new Response(null, { status: 404 })));

    await expect(warehouseRunForm("type-21-v3", {
      productId: multivitamin.id, files: ["image.png", "audio.wav"], request: warehouseItem.request, budget: warehouseItem.budget,
    })).rejects.toThrow("audio.wav");
  });
});

describe("warehouse add to cart", () => {
  function mockRun(actions: string[]) {
    let state = initialState(null, "warehouse-run");
    for (const action of actions) {
      state = applyEvent(state, { run_id: "warehouse-run", pane: "guarded", kind: "verdict", t_ms: 1, data: { action } });
    }
    state = applyEvent(state, { run_id: "warehouse-run", pane: "system", kind: "done", t_ms: 2, data: {} });
    return { phase: "done" as const, state };
  }

  it("keeps a held item out of the cart even after an earlier approval", () => {
    const add = vi.fn();
    expect(completeWarehouseAdd(mockRun(["approve_checkout", "hard_block_quarantine"]), add)).toBe("held");
    expect(add).not.toHaveBeenCalled();
  });

  it("adds the item after a completed approval", () => {
    const add = vi.fn();
    expect(completeWarehouseAdd(mockRun(["approve_checkout"]), add)).toBe("approved");
    expect(add).toHaveBeenCalledOnce();
  });

  it("keeps the cart empty when the run finishes without a verdict", () => {
    const add = vi.fn();
    expect(completeWarehouseAdd(mockRun([]), add)).toBe("held");
    expect(add).not.toHaveBeenCalled();
  });
});
