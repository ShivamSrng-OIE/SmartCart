import { useState } from "react";
import type { CatalogProduct } from "../catalog";
import { cx } from "./ui";

/** Merchant image if the catalog returns one (hot-linked, never re-hosted); otherwise a quiet monogram tile. */
export function ProductThumb({ product, className, size = "md" }: { product: Pick<CatalogProduct, "title" | "image" | "vendor">; className?: string; size?: "sm" | "md" | "lg" }) {
  const [broken, setBroken] = useState(false);
  const initials = (product.vendor ?? product.title)
    .replace(/[^A-Za-z0-9 &]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w !== "&")
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div
      className={cx(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]",
        size === "sm" ? "size-9 rounded-lg" : size === "md" ? "size-full rounded-lg" : "size-full rounded-xl",
        className,
      )}
    >
      {product.image && !broken ? (
        <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <span className={cx("font-semibold tracking-tight text-ink-3", size === "sm" ? "text-[11px]" : size === "md" ? "text-xl" : "text-3xl")}>{initials || "•"}</span>
      )}
    </div>
  );
}
