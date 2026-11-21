import { useEffect, useRef, useState } from "react";
import { videoSources, type CatalogProduct, type MediaItem } from "../catalog";
import { Box, Play } from "lucide-react";
import { sized, srcSet } from "../lib/img";
import { reducedMotion } from "../lib/motion";
import { cx } from "./ui";

const CYCLE_MS = 1100;

/**
 * Product image from Shopify's CDN at the right size (hot-linked, never re-hosted).
 * While `active` (the card is hovered/focused) it cycles through the product's other photos,
 * or plays its video muted. Extra media is only requested once someone hovers.
 */
export function ProductThumb({
  product,
  className,
  size = "md",
  sizes = "(min-width: 1900px) 16vw, (min-width: 1536px) 19vw, (min-width: 1024px) 24vw, (min-width: 640px) 31vw, 46vw",
  priority = false,
  fit = "contain",
  active = false,
}: {
  product: Pick<CatalogProduct, "title" | "image" | "vendor"> & { media?: MediaItem[] };
  className?: string;
  size?: "sm" | "md" | "lg";
  sizes?: string;
  priority?: boolean;
  /** contain: show the whole product (default). cover: fill the tile (lifestyle/category art). */
  fit?: "contain" | "cover";
  active?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [idx, setIdx] = useState(0);
  const [touched, setTouched] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const small = size === "sm";

  const images = (product.media ?? []).filter((m) => m.type === "image").map((m) => m.url);
  const gallery = images.length ? images : product.image ? [product.image] : [];
  const video = (product.media ?? []).find((m) => m.type === "video");
  const videoUrl = video ? videoSources(video).find((x) => /mp4/i.test(x.mime ?? x.format ?? x.url))?.url ?? null : null;
  const has3d = (product.media ?? []).some((m) => m.type === "model_3d");
  const hasVideo = !!video || (product.media ?? []).some((m) => m.type === "external_video");
  const canCycle = !small && gallery.length > 1 && !videoUrl;

  useEffect(() => {
    if (active) setTouched(true);
    if (!active) {
      setIdx(0);
      videoRef.current?.pause();
      return;
    }
    if (videoUrl && videoRef.current) {
      void videoRef.current.play().catch(() => undefined);
      return;
    }
    if (!canCycle || reducedMotion()) return;
    setIdx(1);
    const id = window.setInterval(() => setIdx((i) => (i + 1) % gallery.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [active, canCycle, gallery.length, videoUrl]);

  const initials = (product.vendor ?? product.title)
    .replace(/[^A-Za-z0-9 &]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w !== "&")
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const fitCls = fit === "cover" ? "object-cover" : "object-contain p-[6%]";

  return (
    <div
      className={cx(
        "relative flex shrink-0 items-center justify-center overflow-hidden shadow-[inset_0_0_0_1px_var(--line)]",
        fit === "contain" && !small ? "bg-white dark:bg-[#f4f4f2]" : "bg-surface-2",
        small ? "size-9 rounded-lg" : size === "md" ? "size-full rounded-lg" : "size-full rounded-xl",
        className,
      )}
    >
      {gallery[0] && !broken ? (
        <>
          <img
            src={sized(gallery[0], small ? 96 : 600)}
            srcSet={small ? undefined : srcSet(gallery[0])}
            sizes={small ? undefined : sizes}
            alt=""
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
            className={cx("absolute inset-0 size-full transition-opacity duration-300", small ? "object-cover" : fitCls, loaded && idx === 0 ? "opacity-100" : "opacity-0")}
          />
          {/* other photos: only mounted after the first hover */}
          {canCycle &&
            touched &&
            gallery.slice(1, 6).map((url, k) => (
              <img
                key={url}
                src={sized(url, 600)}
                alt=""
                decoding="async"
                referrerPolicy="no-referrer"
                className={cx("absolute inset-0 size-full transition-opacity duration-500", fitCls, idx === k + 1 ? "opacity-100" : "opacity-0")}
              />
            ))}
          {videoUrl && touched && !small && (
            <video
              ref={videoRef}
              src={videoUrl}
              poster={video?.poster ?? undefined}
              muted
              loop
              playsInline
              preload="metadata"
              className={cx("absolute inset-0 size-full object-cover transition-opacity duration-300", active ? "opacity-100" : "opacity-0")}
            />
          )}
          {!small && (has3d || hasVideo) && (
            <span className="absolute top-2 left-2 flex gap-1">
              {has3d && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Box className="size-3" /> 3D
                </span>
              )}
              {hasVideo && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Play className="size-2.5 fill-white" /> Video
                </span>
              )}
            </span>
          )}
          {canCycle && active && (
            <span className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
              {gallery.slice(0, 6).map((_, k) => (
                <span key={k} className={cx("h-1 rounded-full transition-all duration-300", idx === k ? "w-3 bg-black/70" : "w-1 bg-black/25")} />
              ))}
            </span>
          )}
        </>
      ) : (
        <span className={cx("font-semibold tracking-tight text-ink-3", small ? "text-[11px]" : size === "md" ? "text-xl" : "text-3xl")}>{initials || "•"}</span>
      )}
    </div>
  );
}
