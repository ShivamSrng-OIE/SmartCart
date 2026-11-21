/**
 * Shopify's image CDN resizes on the fly with a `width` parameter, so we never download a
 * 2000px original for a 200px card. Other hosts are left untouched.
 */
export function sized(url: string | null | undefined, width: number): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!/(^|\.)cdn\.shopify\.com$|\.myshopify\.com$/.test(u.hostname) && !u.pathname.includes("/cdn/shop/")) return url;
    u.searchParams.set("width", String(Math.round(width)));
    return u.toString();
  } catch {
    return url;
  }
}

export function srcSet(url: string | null | undefined, widths: number[] = [200, 400, 800, 1200]): string | undefined {
  if (!url) return undefined;
  const first = sized(url, widths[0]);
  if (first === url) return undefined; // not resizable
  return widths.map((w) => `${sized(url, w)} ${w}w`).join(", ");
}
