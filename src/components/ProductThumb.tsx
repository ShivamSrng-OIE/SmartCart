import { useState } from "react";
import type { CatalogProduct } from "../catalog";
import { sized, srcSet } from "../lib/img";
import { cx } from "./ui";

/** Merchant image (hot-linked from Shopify's CDN at the right size, never re-hosted), else a quiet monogram tile. */
export function ProductThumb({
  product,
  className,
  size = "md",
  sizes = "(min-width: 1280px) 22vw, (min-width: 640px) 30vw, 46vw",
  priority = false,
}: {
  product: Pick<CatalogProduct, "title" | "image" | "vendor">;
  className?: string;
  size?: "sm" | "md" | "lg";
  sizes?: string;
  priority?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const initials = (product.vendor ?? product.title)
    .replace(/[^A-Za-z0-9 &]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w !== "&")
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const small = size === "sm";
  return (
    <div
      className={cx(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]",
        small ? "size-9 rounded-lg" : size === "md" ? "size-full rounded-lg" : "size-full rounded-xl",
        className,
      )}
    >
      {product.image && !broken ? (
        <img
          src={sized(product.image, small ? 96 : 600)}
          srcSet={small ? undefined : srcSet(product.image)}
          sizes={small ? undefined : sizes}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={cx("absolute inset-0 size-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <span className={cx("font-semibold tracking-tight text-ink-3", small ? "text-[11px]" : size === "md" ? "text-xl" : "text-3xl")}>{initials || "•"}</span>
      )}
    </div>
  );
}
