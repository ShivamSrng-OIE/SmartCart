import { useCallback, useEffect, useMemo, useState } from "react";
import type { CatalogProduct } from "../catalog";

export interface CartLine {
  id: string;
  variantId: string | null;
  currency: string;
  image: string | null;
  title: string;
  price: number | null;
  shop: string | null;
  shopName: string | null;
  url: string | null;
  vendor: string | null;
  qty: number;
}

const KEY = "carttrap.cart";

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as CartLine[]) : [];
    return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string" && l.qty > 0) : [];
  } catch {
    return [];
  }
}

/** Mode 1's cart: you pick everything yourself. Stored in this browser only. */
export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      /* private mode */
    }
  }, [lines]);

  const add = useCallback((p: CatalogProduct, qty = 1) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.id === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: Math.min(99, l.qty + qty) } : l));
      return [...ls, { id: p.id, variantId: p.variantId, currency: p.currency, image: p.image, title: p.title, price: p.price, shop: p.shop, shopName: p.shopName, url: p.url, vendor: p.vendor, qty }];
    });
  }, []);

  const setQty = useCallback((id: string, qty: number) => {
    setLines((ls) => (qty <= 0 ? ls.filter((l) => l.id !== id) : ls.map((l) => (l.id === id ? { ...l, qty: Math.min(99, qty) } : l))));
  }, []);

  const remove = useCallback((id: string) => setLines((ls) => ls.filter((l) => l.id !== id)), []);
  const clear = useCallback(() => setLines([]), []);

  const summary = useMemo(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const total = Math.round(lines.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0) * 100) / 100;
    const byShop = new Map<string, CartLine[]>();
    for (const l of lines) {
      const k = l.shop ?? l.shopName ?? "Store";
      byShop.set(k, [...(byShop.get(k) ?? []), l]);
    }
    return { count, total, byShop: [...byShop.entries()] };
  }, [lines]);

  const qtyOf = useCallback((id: string) => lines.find((l) => l.id === id)?.qty ?? 0, [lines]);

  return { lines, add, setQty, remove, clear, qtyOf, ...summary };
}

export type Cart = ReturnType<typeof useCart>;
