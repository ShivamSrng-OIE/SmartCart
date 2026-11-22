import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowLeft, ArrowUpRight, Bot, Box, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2, Minus, Play, Plus, ShieldCheck, Star, Store, TrendingDown, TrendingUp, X } from "lucide-react";
import { getProduct, isFlagged, mediaSummary, modelSources, refFromProduct, similarProducts, videoSources, type CatalogProduct, type MediaItem, type Offer, type ProductRef } from "../catalog";
import { ModelViewerModal } from "./ModelViewerModal";
import { AutoRail } from "./AutoRail";
import { FraudCard } from "./FraudCard";
import { CheckProgress, listingFacts, useElapsed } from "./CheckProgress";
import { currentActivity } from "../lib/progress";
import { useCartChecker } from "../hooks/useCartChecker";
import { ReportedNotice, TrustMeter, TrustNotice } from "./TrustBadge";
import type { Cart } from "../hooks/useCart";
import { money } from "../lib/format";
import { sized, srcSet } from "../lib/img";
import { flyToCart, gsap, reducedMotion, useGSAP, d } from "../lib/motion";
import { ProductThumb } from "./ProductThumb";
import { Button, Chip, cx } from "./ui";

/* ------------------------------------------------------------- helpers */

function Stars({ value, count, size = "sm" }: { value: number; count?: number; size?: "sm" | "md" }) {
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Rated ${value.toFixed(1)} out of 5${count ? ` from ${count} reviews` : ""}`}>
      <span className="inline-flex">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={cx(size === "md" ? "size-4" : "size-3.5", i < full ? "fill-current text-warn" : "text-line-strong")} />
        ))}
      </span>
      <span className={cx("tnum text-ink-2", size === "md" ? "text-sm" : "text-xs")}>
        {value.toFixed(1)}
        {count != null && <span className="text-ink-3"> · {count.toLocaleString()} reviews</span>}
      </span>
    </span>
  );
}

/** Words that describe the item, minus pack/size noise, for a "similar products" search. */
function similarQuery(title: string): string {
  return title
    .replace(/["“”'’()[\]]/g, " ")
    .replace(/\b\d+(\.\d+)?\s?(oz|ml|l|g|kg|lb|pack|ct|count|gb|tb)\b/gi, " ")
    .replace(/\s[-–|]\s.*$/, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join(" ");
}

function offerAsProduct(p: CatalogProduct, o: Offer): CatalogProduct {
  return { ...p, id: o.variantId, variantId: o.variantId, price: o.price, currency: o.currency, shop: o.seller.domain, shopName: o.seller.name, url: o.url, image: o.image ?? p.image, available: o.available };
}

/* --------------------------------------------------------------- gallery */

const AUTOPLAY_MS = 4500;

function Slide({ m, title, first, onPlay, onOpen3D, cover = false }: { m: MediaItem; title: string; first: boolean; onPlay: (playing: boolean) => void; onOpen3D: () => void; cover?: boolean }) {
  const [embed, setEmbed] = useState(false);
  if (m.type === "video") {
    return (
      <video poster={m.poster ?? undefined} controls playsInline preload="metadata" onPlay={() => onPlay(true)} onPause={() => onPlay(false)} onEnded={() => onPlay(false)} className="size-full bg-black object-contain">
        {videoSources(m).map((src) => (
          <source key={src.url} src={src.url} type={src.mime ?? undefined} />
        ))}
      </video>
    );
  }
  if (m.type === "external_video") {
    if (embed) {
      const sep = m.url.includes("?") ? "&" : "?";
      return (
        <iframe
          src={`${m.url}${sep}autoplay=1&rel=0`}
          title={m.alt ?? title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="size-full border-0 bg-black"
        />
      );
    }
    return (
      <button
        onClick={() => {
          setEmbed(true);
          onPlay(true);
        }}
        className="group relative size-full"
        aria-label={`Play video: ${m.alt ?? title}`}
      >
        {m.poster && <img src={sized(m.poster, 1000)} alt="" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/25">
          <span className="flex size-16 items-center justify-center rounded-full bg-white/95 shadow-float transition-transform group-hover:scale-105">
            <Play className="ml-1 size-7 fill-black text-black" />
          </span>
        </span>
      </button>
    );
  }
  if (m.type === "model_3d") {
    const { glb } = modelSources(m);
    return (
      <button onClick={onOpen3D} className="group relative flex size-full items-center justify-center bg-white" aria-label={`View ${title} in 3D`}>
        {m.poster && <img src={sized(m.poster, 1000)} alt="" decoding="async" referrerPolicy="no-referrer" className="size-full object-contain p-[6%] transition-transform duration-700 group-hover:scale-[1.03]" />}
        <span className="absolute inset-x-0 bottom-6 flex justify-center">
          <span className="btn-primary inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold shadow-float">
            <Box className="size-4" /> View in 3D
            {glb?.size ? <span className="font-normal opacity-70">· {(glb.size / 1_048_576).toFixed(0)} MB</span> : null}
          </span>
        </span>
      </button>
    );
  }
  return (
    <img
      src={sized(m.url, 1000)}
      srcSet={srcSet(m.url, [400, 700, 1000, 1400])}
      sizes="(min-width: 1024px) 50vw, 100vw"
      alt={m.alt ?? title}
      fetchPriority={first ? "high" : "auto"}
      loading={first ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      className={cover ? "size-full object-cover" : "size-full object-contain p-[4%]"}
    />
  );
}

/** Full-screen photo viewer: arrows / swipe / keys to move, tap or click to zoom (follows the pointer). */
function Lightbox({ images, start, title, onClose }: { images: MediaItem[]; start: number; title: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const root = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const sw = useRef<number | null>(null);
  const n = images.length;
  const go = (k: number) => {
    setZoom(false);
    setI((k + n) % n);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useGSAP(() => {
    gsap.fromTo(root.current, { opacity: 0 }, { opacity: 1, duration: d(0.2) });
  });
  useGSAP(() => {
    gsap.fromTo(imgRef.current, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: d(0.35), ease: "power2.out" });
  }, { dependencies: [i] });
  const m = images[i];
  return createPortal(
    <div ref={root} className="fixed inset-0 z-[70] flex flex-col bg-[#0b0b0b] text-white" role="dialog" aria-modal="true" aria-label={`${title} photos`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 short:py-1.5">
        <span className="tnum text-sm opacity-80">
          {i + 1} / {n}
        </span>
        <span className="hidden truncate text-sm opacity-70 sm:block">{title}</span>
        <button onClick={onClose} aria-label="Close" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-white/10">
          <X className="size-5" />
        </button>
      </div>
      <div
        className={cx("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden", zoom ? "cursor-zoom-out" : "cursor-zoom-in")}
        onPointerDown={(e) => (sw.current = e.clientX)}
        onPointerUp={(e) => {
          const s0 = sw.current;
          sw.current = null;
          if (s0 != null && Math.abs(e.clientX - s0) > 50 && !zoom) go(i + (e.clientX < s0 ? 1 : -1));
        }}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
          setZoom((z) => !z);
        }}
        onMouseMove={(e) => {
          if (!zoom) return;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
        }}
      >
        <img
          ref={imgRef}
          key={m.url}
          src={sized(m.url, 1800)}
          alt={m.alt ?? title}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          style={{ transformOrigin: origin }}
          className={cx("max-h-full max-w-full object-contain transition-transform duration-300 ease-out", zoom ? "scale-[2.2]" : "scale-100")}
        />
        {n > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                go(i - 1);
              }}
              aria-label="Previous photo"
              className="absolute left-3 inline-flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                go(i + 1);
              }}
              aria-label="Next photo"
              className="absolute right-3 inline-flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] short:hidden">
          {images.map((x, k) => (
            <button key={x.url + k} onClick={() => go(k)} aria-label={`Photo ${k + 1}`} className={cx("size-12 shrink-0 overflow-hidden rounded-md bg-white transition-opacity", k === i ? "opacity-100 ring-2 ring-white" : "opacity-50 hover:opacity-80")}>
              <img src={sized(x.url, 120)} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain p-0.5" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Product media carousel.
 * - drag or swipe: the slide follows your finger and snaps; tap a photo to open the zoomable viewer
 * - advances on its own every few seconds (dot fills as a timer); waits 8 s after you touch it,
 *   and pauses on hover, while a video plays or while the 3D viewer is open
 */
function Gallery({ media, title, fallback, wide = false }: { media: MediaItem[]; title: string; fallback: CatalogProduct; wide?: boolean }) {
  const shape = wide ? "aspect-[4/3] lg:aspect-[16/10]" : "aspect-[4/3] sm:aspect-[16/11] lg:aspect-square";
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [model, setModel] = useState<MediaItem | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [touchedAt, setTouchedAt] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dx: number; axis: "x" | "y" | null } | null>(null);
  const items = media;
  const n = items.length;
  const images = items.filter((m) => m.type === "image");
  const summary = mediaSummary(items);
  // A marketplace listing's photos are full-bleed shots: the frame takes the first photo's own proportions and the
  // photos fill it, instead of floating in white bands. Shopify's cut-outs keep the padded square.
  const first = images[0];
  const ratio = wide ? (first?.width && first?.height ? Math.min(1.9, Math.max(0.8, first.width / first.height)) : 4 / 3) : null;

  const go = (next: number, user = true) => {
    if (!n) return;
    const k = (next + n) % n;
    setI(k);
    if (user) setTouchedAt(performance.now());
    gsap.to(track.current, { xPercent: -100 * k, x: 0, duration: d(0.55), ease: "expo.out" });
    const t = thumbs.current?.children[k] as HTMLElement | undefined;
    t?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  // Re-arm autoplay 8 s after the last interaction.
  const [, force] = useState(0);
  useEffect(() => {
    if (!touchedAt) return;
    const t = window.setTimeout(() => force((x) => x + 1), 8000);
    return () => window.clearTimeout(t);
  }, [touchedAt]);
  const idle = performance.now() - touchedAt > 8000;
  const active = n > 1 && idle && !hover && !playing && !model && lightbox === null && !reducedMotion();

  useEffect(() => {
    const el = fill.current;
    if (!el) return;
    if (!active) {
      gsap.set(el, { scaleX: 0 });
      return;
    }
    const tween = gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: AUTOPLAY_MS / 1000, ease: "none", onComplete: () => go(i + 1, false) });
    const onVis = () => (document.hidden ? tween.pause() : tween.resume());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      tween.kill();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, i]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!n) {
    return (
      <div className={cx("card", shape, "short:aspect-auto short:h-[72svh]")}>
        <ProductThumb product={fallback} size="lg" priority />
      </div>
    );
  }

  const cur = items[i];
  const draggable = (el: EventTarget) => !(el as HTMLElement).closest("video, iframe, [data-nodrag]");

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={frame}
        className={cx("group/gal card relative touch-pan-y overflow-hidden select-none", ratio ? "bg-black" : cx("bg-white", shape), "short:aspect-auto short:h-[72svh]")}
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={`${title}, ${i + 1} of ${n}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(i + 1);
          if (e.key === "ArrowLeft") go(i - 1);
        }}
        onPointerDown={(e) => {
          if (n < 2 || !draggable(e.target)) return;
          drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, axis: null };
        }}
        onPointerMove={(e) => {
          const g = drag.current;
          if (!g) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.axis && Math.hypot(dx, dy) > 6) g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (g.axis !== "x") return;
          g.dx = dx;
          // rubber-band at the ends
          const edge = (i === 0 && dx > 0) || (i === n - 1 && dx < 0);
          gsap.set(track.current, { x: edge ? dx * 0.35 : dx });
        }}
        onPointerUp={(e) => {
          const g = drag.current;
          drag.current = null;
          if (!g) return;
          const w = frame.current?.clientWidth ?? 1;
          const v = g.dx / Math.max(1, performance.now() - g.t); // px per ms
          if (g.axis === "x" && (Math.abs(g.dx) > w * 0.18 || Math.abs(v) > 0.5)) {
            go(i + (g.dx < 0 ? 1 : -1));
          } else if (g.axis === "x") {
            gsap.to(track.current, { x: 0, duration: d(0.4), ease: "expo.out" });
          } else if (!g.axis && cur.type === "image" && draggable(e.target)) {
            setLightbox(images.indexOf(cur));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          gsap.to(track.current, { x: 0, duration: d(0.3) });
        }}
      >
        <div ref={track} className="flex size-full will-change-transform">
          {items.map((m, k) => (
            <div key={m.url + k} className="relative size-full shrink-0" aria-hidden={k !== i}>
              {Math.abs(k - i) <= 1 || k === 0 || (i === 0 && k === n - 1) ? (
                <Slide m={m} title={title} first={k === 0} onPlay={setPlaying} onOpen3D={() => setModel(m)} cover={!!ratio && m.type === "image"} />
              ) : null}
            </div>
          ))}
        </div>

        {n > 1 && (
          <>
            <button
              data-nodrag
              onClick={() => go(i - 1)}
              aria-label="Previous"
              className="btn-secondary absolute top-1/2 left-3 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-float transition-opacity group-hover/gal:opacity-100 md:inline-flex"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              data-nodrag
              onClick={() => go(i + 1)}
              aria-label="Next"
              className="btn-secondary absolute top-1/2 right-3 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-float transition-opacity group-hover/gal:opacity-100 md:inline-flex"
            >
              <ChevronRight className="size-4" />
            </button>
            {/* dots: the active one stretches and fills as the autoplay timer runs */}
            <div data-nodrag className="absolute inset-x-0 bottom-3 flex justify-center">
              {n <= 14 ? (
                <span className="flex items-center gap-1.5 rounded-full bg-black/35 px-2 py-1.5 backdrop-blur-sm">
                  {items.map((_, k) => (
                    <button
                      key={k}
                      onClick={() => go(k)}
                      aria-label={`Go to ${k + 1}`}
                      className={cx("relative h-1.5 overflow-hidden rounded-full transition-all duration-300", k === i ? "w-6 bg-white/40" : "w-1.5 bg-white/60 hover:bg-white")}
                    >
                      {k === i && <span ref={fill} className="absolute inset-0 origin-left scale-x-0 rounded-full bg-white" />}
                    </button>
                  ))}
                </span>
              ) : (
                <span className="tnum rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white">
                  {i + 1} / {n}
                  <span ref={fill} className="hidden" />
                </span>
              )}
            </div>
          </>
        )}
        {cur.type === "model_3d" && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white">
            <Box className="size-3" /> 3D
          </span>
        )}
        {cur.type === "image" && (
          <span className="pointer-events-none absolute top-3 right-3 hidden rounded-md bg-black/45 px-2 py-0.5 text-[11px] text-white opacity-0 transition-opacity group-hover/gal:opacity-100 md:block">
            Click to zoom
          </span>
        )}
      </div>

      {n > 1 && (
        <div ref={thumbs} className="flex gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((m, k) => {
            const poster = m.type === "image" ? m.url : m.poster;
            return (
              <button
                key={m.url + k}
                onClick={() => go(k)}
                aria-label={`Show ${m.type === "model_3d" ? "3D model" : m.type.includes("video") ? "video" : "photo"} ${k + 1}`}
                aria-current={k === i}
                className={cx(
                  "relative size-14 shrink-0 overflow-hidden rounded-lg bg-white transition-all duration-200 sm:size-[68px]",
                  k === i ? "shadow-[inset_0_0_0_2px_var(--ink)]" : "opacity-70 shadow-[inset_0_0_0_1px_var(--line)] hover:opacity-100",
                )}
              >
                {poster ? (
                  <img src={sized(poster, 160)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-contain p-1" />
                ) : (
                  <span className="flex size-full items-center justify-center text-[10px] text-ink-3 uppercase">{m.type}</span>
                )}
                {m.type !== "image" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                    {m.type === "model_3d" ? <Box className="size-5 text-white" /> : <Play className="ml-0.5 size-5 fill-white text-white" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
        {summary.images > 0 && <span>{summary.images} photo{summary.images === 1 ? "" : "s"}</span>}
        {summary.videos > 0 && (
          <span className="inline-flex items-center gap-1">
            <Play className="size-3" /> {summary.videos} video{summary.videos === 1 ? "" : "s"}
          </span>
        )}
        {summary.models > 0 && (
          <button onClick={() => setModel(items.find((m) => m.type === "model_3d") ?? null)} className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink">
            <Box className="size-3" /> 3D model · view in your space
          </button>
        )}
      </p>

      {model && <ModelViewerModal media={model} title={title} onClose={() => setModel(null)} />}
      {lightbox !== null && images.length > 0 && <Lightbox images={images} start={Math.max(0, lightbox)} title={title} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* ----------------------------------------------------------- price check */

type Verdict = { tone: "good" | "fair" | "high"; label: string; detail: string };

/** Compare this item's best price with the typical (median) price of similar live listings. */
function priceVerdict(value: number | null, typical: number | null, currency: string): Verdict | null {
  if (value == null || typical == null || typical <= 0) return null;
  const pct = (value - typical) / typical;
  const diff = money(Math.abs(value - typical), false, currency);
  if (pct <= -0.08) return { tone: "good", label: "Good price", detail: `${Math.round(-pct * 100)}% below typical · ${diff} less` };
  if (pct >= 0.08) return { tone: "high", label: "Higher than usual", detail: `${Math.round(pct * 100)}% above typical · ${diff} more` };
  return { tone: "fair", label: "Typical price", detail: `Within ${Math.max(1, Math.round(Math.abs(pct) * 100))}% of similar items` };
}

const VERDICT_STYLE: Record<Verdict["tone"], { pill: string; dot: string; icon: typeof TrendingDown }> = {
  good: { pill: "bg-safe-soft text-safe shadow-[inset_0_0_0_1px_var(--safe-line)]", dot: "bg-safe", icon: TrendingDown },
  fair: { pill: "bg-surface-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]", dot: "bg-ink", icon: Minus },
  high: { pill: "bg-warn-soft text-warn shadow-[inset_0_0_0_1px_var(--warn-line)]", dot: "bg-warn", icon: TrendingUp },
};

/** Lowest → highest similar price, with "typical" marked and this item's price sliding into place. */
function PriceRange({ low, high, typical, value, currency, tone, size = "md" }: { low: number; high: number; typical: number | null; value: number; currency: string; tone: Verdict["tone"]; size?: "sm" | "md" }) {
  const ref = useRef<HTMLDivElement>(null);
  const min = Math.min(low, value);
  const max = Math.max(high, value);
  const pos = (v: number) => (max - min < 0.01 ? 50 : ((v - min) / (max - min)) * 100);
  useGSAP(
    () => {
      gsap.fromTo("[data-marker]", { left: "0%" }, { left: `${pos(value)}%`, duration: d(1.1), ease: "power3.out", delay: 0.2 });
    },
    { scope: ref, dependencies: [value, min, max] },
  );
  const big = size === "md";
  return (
    <div ref={ref} className={cx("relative", big ? "pt-7 pb-6" : "pt-1 pb-4")}>
      <div className={cx("relative rounded-full bg-[linear-gradient(90deg,var(--safe-soft),var(--surface-2)_50%,var(--warn-soft))] shadow-[inset_0_0_0_1px_var(--line)]", big ? "h-2.5" : "h-1.5")}>
        {typical != null && (
          <span className="absolute top-1/2 h-[180%] w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3" style={{ left: `${pos(typical)}%` }} title={`Typical: ${money(typical, false, currency)}`} />
        )}
        <span data-marker className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(value)}%` }}>
          <span className={cx("block rounded-full ring-[3px] ring-surface", VERDICT_STYLE[tone].dot, big ? "size-4" : "size-3")} />
          {big && (
            <span
              className={cx(
                "tnum absolute bottom-[calc(100%+8px)] rounded-md bg-ink px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink-inverse",
                pos(value) < 15 ? "left-0 -translate-x-2" : pos(value) > 85 ? "right-0 translate-x-2" : "left-1/2 -translate-x-1/2",
              )}
            >
              This item {money(value, false, currency)}
            </span>
          )}
        </span>
      </div>
      <div className={cx("tnum absolute inset-x-0 flex justify-between text-ink-3", big ? "bottom-0 text-xs" : "bottom-0 text-[10px]")}>
        <span>{big ? "Lowest " : ""}{money(low, false, currency)}</span>
        {big && typical != null && pos(typical) > 26 && pos(typical) < 74 && (
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(typical)}%` }}>
            Typical {money(typical, false, currency)}
          </span>
        )}
        <span>{big ? "Highest " : ""}{money(high, false, currency)}</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- price chart */

interface Dot {
  key: string;
  label: string;
  sub: string;
  price: number;
  self: boolean;
}

/**
 * Where this product's store prices sit among similar listings, right now.
 * Shop MCP has no price history, so this is a snapshot comparison, not a trend.
 */
function PriceChart({ dots, currency }: { dots: Dot[]; currency: string }) {
  const [hover, setHover] = useState<Dot | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const prices = dots.map((x) => x.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = (hi - lo) * 0.08 || Math.max(1, hi * 0.1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const x = (v: number) => ((v - min) / (max - min || 1)) * 100;
  const ticks = useMemo(() => {
    const step = niceStep((max - min) / 4);
    const out: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }, [min, max]);
  const similar = dots.filter((x) => !x.self).map((x) => x.price).sort((a, b) => a - b);
  const median = similar.length ? similar[Math.floor(similar.length / 2)] : null;

  useGSAP(
    () => {
      gsap.from("[data-dot]", { scale: 0, duration: d(0.4), stagger: 0.02, ease: "back.out(2)" });
    },
    { scope: root, dependencies: [dots.length] },
  );

  const lane = (self: boolean) => (
    <div className="relative h-9">
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      {dots
        .filter((x) => x.self === self)
        .map((dot) => (
          <button
            key={dot.key}
            data-dot
            onMouseEnter={() => setHover(dot)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(dot)}
            onBlur={() => setHover(null)}
            aria-label={`${dot.label}: ${money(dot.price, false, currency)}`}
            className="group absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${x(dot.price)}%` }}
          >
            <span
              className={cx(
                "block size-2.5 rounded-full ring-2 ring-surface transition-transform group-hover:scale-150 group-focus-visible:scale-150",
                self ? "bg-ink" : "border-[1.5px] border-ink-3 bg-surface",
              )}
            />
          </button>
        ))}
    </div>
  );

  return (
    <div ref={root} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-ink" /> This item, by store
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-[1.5px] border-ink-3" /> Similar items
        </span>
        {median != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-px bg-ink-3" /> Typical similar price
          </span>
        )}
      </div>

      <div className="relative">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[110px_minmax(0,1fr)]">
          <span className="text-xs text-ink-2">This item</span>
          {lane(true)}
          <span className="text-xs text-ink-2">Similar</span>
          <div className="relative">
            {median != null && <div className="absolute -top-9 bottom-0 w-px bg-ink-3/60" style={{ left: `${x(median)}%` }} />}
            {lane(false)}
          </div>
          <span />
          <div className="relative mt-1 h-4">
            {ticks.map((t) => (
              <span key={t} className="tnum absolute -translate-x-1/2 text-[11px] text-ink-3" style={{ left: `${x(t)}%` }}>
                {money(t, t >= 100, currency)}
              </span>
            ))}
          </div>
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-ink-inverse shadow-float"
            style={{ left: `calc(${(window.innerWidth < 640 ? 88 : 110) + 12}px + (100% - ${(window.innerWidth < 640 ? 88 : 110) + 12}px) * ${x(hover.price) / 100})` }}
          >
            <span className="font-semibold">{money(hover.price, false, currency)}</span> · {hover.label}
            <span className="block opacity-70">{hover.sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

function SimilarTile({ s, onOpen }: { s: CatalogProduct; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="card group flex h-full w-full flex-col overflow-hidden text-left">
      <div className="aspect-square w-full border-b border-line">
        <ProductThumb product={s} active={hover} className="rounded-none! shadow-none!" />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <p className="line-clamp-2 text-[13px] leading-snug font-medium">{s.title}</p>
        <p className="truncate text-xs text-ink-3">{s.shopName ?? s.vendor}</p>
        <p className="tnum mt-auto pt-1.5 text-[14px] font-semibold">{money(s.price, false, s.currency)}</p>
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------- page */

/** The seller's description, split into a paragraph, a bullet list, and any "Fulfillment note:" fine print (folded away like a real store's shipping details). */
function splitDescription(text: string | null, title: string): { body: string; bullets: string[]; fine: string[] } {
  const lines = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const fine = lines.filter((l) => /^fulfillment note:/i.test(l)).map((l) => l.replace(/^fulfillment note:\s*/i, ""));
  const rest = lines.filter((l) => !/^fulfillment note:/i.test(l) && l.toLowerCase() !== title.toLowerCase());
  return { body: rest.filter((l) => !l.startsWith("- ")).join("\n"), bullets: rest.filter((l) => l.startsWith("- ")).map((l) => l.slice(2)), fine };
}

function WarehouseProductPage({ product: initial, cart, onBack, onAskAssistant }: { product: CatalogProduct; cart: Cart; onBack: () => void; onAskAssistant: (ref: ProductRef) => void }) {
  // the listing as shoppers see it now: its stars and seller trust change when a check catches something
  const [product, setProduct] = useState(initial);
  const galleryRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const checker = useCartChecker(cart, () => flyToCart(galleryRef.current));
  const [variantId, setVariantId] = useState(product.offers[0]?.variantId ?? product.variantId);
  const offer = product.offers.find((o) => o.variantId === variantId) ?? product.offers[0];
  const optionName = product.options[0]?.name;
  const price = offer?.price ?? product.price;
  const result = checker.results[product.id];
  const checking = result?.phase === "checking";
  const held = result?.phase === "held" || result?.phase === "error";
  const elapsed = useElapsed(checking);
  const settled = !!result && !checking && (result.phase === "approved" || result.state.guarded.finished);
  useEffect(() => {
    if (!settled) return;
    let live = true;
    // the incident is written as the run closes; read the listing back a moment later
    const t = window.setTimeout(() => {
      getProduct(initial.id).then((r) => live && r.product && setProduct({ ...r.product, source: initial.source })).catch(() => undefined);
    }, 800);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [settled, initial.id, initial.source]);
  const { body, bullets, fine } = splitDescription(product.description, product.title);
  const flagged = isFlagged(product);
  const t = product.trust;

  // Show the review as soon as there is something to read: the live check, then the verdict.
  useEffect(() => {
    if (result) reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [result?.phase === "held" || result?.phase === "error" ? "held" : result?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const addToCart = () => checker.check({ ...product, variantId, price });

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6 sm:gap-8">
      <nav className="flex items-center gap-2 text-sm text-ink-3" aria-label="Breadcrumb">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Back
        </button>
        <span>/</span>
        <span className="truncate">{product.title}</span>
      </nav>

      {/* gallery stays in view on the left while the right scrolls */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-10 xl:gap-14">
        <div ref={galleryRef} className="lg:sticky lg:top-[72px]">
          <Gallery wide media={product.media.filter((m) => m.type !== "audio")} title={product.title} fallback={product} />
          {product.media.filter((m) => m.type === "audio").map((m) => (
            <audio key={m.url} src={m.url} controls preload="metadata" aria-label="Product audio" className="mt-3 w-full" />
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <TrustNotice p={product} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {product.type && <Chip mono={false}>{product.type}</Chip>}
            {product.rating && <Stars value={product.rating.value} count={product.rating.count} size="md" />}
          </div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">{product.title}</h1>
          <p className="tnum text-[28px] font-semibold tracking-tight">{money(price, false, product.currency)}</p>

          {product.offers.length > 1 && (
            <div>
              <p className="label mb-1.5">{optionName ?? "Option"}</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={optionName ?? "Option"}>
                {product.offers.map((o) => {
                  const on = o.variantId === variantId;
                  const delta = (o.price ?? 0) - (product.offers[0]?.price ?? 0);
                  return (
                    <button
                      key={o.variantId}
                      role="radio"
                      aria-checked={on}
                      onClick={() => setVariantId(o.variantId)}
                      className={cx("inline-flex h-10 min-w-12 items-center justify-center gap-1.5 rounded-lg border px-3.5 text-[14px] font-medium transition-colors", on ? "border-ink bg-ink text-ink-inverse" : "border-line-strong bg-surface text-ink hover:border-ink-3")}
                    >
                      {o.title}
                      {delta > 0 && <span className={cx("tnum text-xs", on ? "opacity-80" : "text-ink-3")}>+{money(delta, false, product.currency)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {held ? (
              <Button variant="secondary" size="lg" onClick={addToCart} icon={<Plus className="size-4" />} className="w-full sm:w-auto">
                Check again
              </Button>
            ) : (
              <Button variant="primary" size="lg" disabled={checking} onClick={addToCart} icon={checking ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} className="w-full sm:w-auto sm:min-w-44">
                {checking ? "Checking…" : cart.qtyOf(product.id) ? "Add another" : "Add to cart"}
              </Button>
            )}
            <Button variant="secondary" size="lg" onClick={() => onAskAssistant(refFromProduct({ ...product, variantId, price }))} icon={<Bot className="size-4" />} className="w-full sm:w-auto">
              Ask the assistant to buy it
            </Button>
          </div>

          <div role="status" aria-live="polite" className="min-h-6">
            {checking && <p className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" /> {currentActivity(result.state, listingFacts(product))}… {elapsed}s</p>}
            {result?.phase === "approved" && <p className="flex items-center gap-2 text-sm font-medium text-safe"><Check className="size-4" /> Approved · added to your cart</p>}
            {held && <p className="text-sm font-medium text-danger">Held by Safe Checkout · nothing was added. The review is just below.</p>}
            {held && result?.message && <p className="text-sm text-ink-2">{result.message}</p>}
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 text-[13px]">
            <div>
              <dt className="label">Sold by</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium"><Store className="size-4 text-ink-3" />{product.shopName ?? "Local store"}</dd>
            </div>
            <div>
              <dt className="label">Seller trust</dt>
              <dd className="mt-1">{t ? <TrustMeter value={t.merchantTrust} status={t.merchantStatus} /> : "—"}</dd>
            </div>
            <div>
              <dt className="label">Shipping</dt>
              <dd className="mt-1 text-ink-2">No payment is taken here</dd>
            </div>
            <div>
              <dt className="label">Checked by</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-ink-2"><ShieldCheck className="size-4 text-safe" /> Safe Checkout</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* the check and its result, full width so nothing is squeezed into a column */}
      {result && (
        <section ref={reviewRef} aria-label="Safe Checkout review" className="flex scroll-mt-20 flex-col gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Safe Checkout review</h2>
          {checking && !held ? (
            <CheckProgress state={result.state} product={product} running className="w-full max-w-2xl" />
          ) : result.phase === "approved" ? (
            <div className="card flex items-center gap-3 p-5">
              <ShieldCheck className="size-6 shrink-0 text-safe" />
              <div>
                <p className="text-[15px] font-medium">Nothing suspicious found</p>
                <p className="text-sm text-ink-3">The photos, description and order all matched, so it went into your cart.</p>
              </div>
            </div>
          ) : (
            <>
              {result.state.guarded.finished && result.phase === "held" && <ReportedNotice productId={product.id} />}
              {!result.state.guarded.finished && result.phase === "held" && <CheckProgress state={result.state} product={product} running={false} compact className="w-full max-w-2xl" />}
              <FraudCard className="w-full" card={result.state.fraudCard} verdict={result.state.verdict} status={result.state.guarded.status} attempted={result.state.guarded.attempted} evidence={result.state.guarded.evidence} finished={result.state.guarded.finished} />
            </>
          )}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="card p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold tracking-tight">About this item</h2>
          {body && <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{body}</p>}
          {bullets.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[14px] text-ink-2 sm:grid-cols-2">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-safe" />{b}</li>
              ))}
            </ul>
          )}
          {fine.length > 0 && (
            <details className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
              <summary className="cursor-pointer font-medium text-ink">Fulfillment details</summary>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {fine.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <aside className="card flex flex-col gap-3 p-5 sm:p-6" aria-label="About the seller">
          <h2 className="text-[17px] font-semibold tracking-tight">About the seller</h2>
          <p className="flex items-center gap-2 text-[15px] font-medium"><Store className="size-4 text-ink-3" />{product.shopName ?? "Local store"}</p>
          {t && <TrustMeter value={t.merchantTrust} status={t.merchantStatus} />}
          <p className="text-[13px] leading-relaxed text-ink-3">
            {flagged
              ? "Safe Checkout has stopped listings from this seller. Take extra care, or choose another store."
              : "Every item from this store is checked by Safe Checkout when it is added to your cart."}
          </p>
        </aside>
      </section>
    </div>
  );
}

export function ProductPage({
  id,
  seed,
  cart,
  onBack,
  onOpen,
  onAskAssistant,
}: {
  id: string;
  seed?: CatalogProduct | null;
  cart: Cart;
  onBack: () => void;
  onOpen: (p: CatalogProduct) => void;
  onAskAssistant: (ref: ProductRef) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [product, setProduct] = useState<CatalogProduct | null>(seed ?? null);
  const [loading, setLoading] = useState(true);
  const [similar, setSimilar] = useState<CatalogProduct[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSimilar(null);
    getProduct(id).then(({ product: p }) => {
      if (!alive) return;
      if (p) setProduct(p);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!product || product.source === "warehouse") return;
    const ctrl = new AbortController();
    const fallbackQuery = [product.type, similarQuery(product.title)].filter(Boolean).join(" ") || product.title;
    similarProducts(product.id, { limit: 16, signal: ctrl.signal, fallbackQuery })
      .then((items) => setSimilar(items.slice(0, 12)))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [product?.id, product?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useGSAP(
    () => {
      gsap.from("[data-sec]", { y: 14, opacity: 0, stagger: 0.06, duration: d(0.5), ease: "power3.out" });
    },
    { scope: root, dependencies: [product?.id] },
  );

  if (!product) {
    return (
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="card flex min-h-[320px] items-center justify-center text-sm text-ink-3">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading product…
            </span>
          ) : (
            "This product couldn’t be loaded."
          )}
        </div>
      </div>
    );
  }

  if (product.source === "warehouse") return <WarehouseProductPage key={product.id} product={product} cart={cart} onBack={onBack} onAskAssistant={onAskAssistant} />;

  const p = product;
  const offers = [...p.offers].sort((a, b) => (a.available === false ? 1 : 0) - (b.available === false ? 1 : 0) || (a.price ?? Infinity) - (b.price ?? Infinity));
  const best = offers.find((o) => o.available !== false) ?? offers[0] ?? null;
  const prices = offers.map((o) => o.price).filter((x): x is number => x != null);
  const lo = prices.length ? Math.min(...prices) : p.price;
  const hi = prices.length ? Math.max(...prices) : (p.priceMax ?? p.price);
  const stores = new Set(offers.map((o) => o.seller.domain ?? o.seller.name)).size;
  const currency = best?.currency ?? p.currency;

  const dots: Dot[] = [
    ...offers.filter((o) => o.price != null).map((o) => ({ key: o.variantId, label: o.seller.name ?? "Store", sub: o.available === false ? "sold out" : (o.condition[0] ?? "available"), price: o.price!, self: true })),
    ...(similar ?? []).filter((s) => s.price != null && s.currency === currency).map((s) => ({ key: s.id, label: s.title.length > 40 ? `${s.title.slice(0, 40)}…` : s.title, sub: s.shopName ?? "", price: s.price!, self: false })),
  ];
  if (!offers.length && p.price != null) dots.push({ key: p.id, label: p.shopName ?? "Store", sub: "", price: p.price, self: true });

  const simPrices = (similar ?? []).filter((s) => s.currency === currency).map((s) => s.price).filter((x): x is number => x != null).sort((a, b) => a - b);
  const typical = simPrices.length ? simPrices[Math.floor(simPrices.length / 2)] : null;
  const bestPrice = best?.price ?? p.price;
  const verdict = priceVerdict(bestPrice, typical, currency);
  const rangeLow = simPrices.length ? Math.min(simPrices[0], bestPrice ?? simPrices[0]) : null;
  const rangeHigh = simPrices.length ? Math.max(simPrices[simPrices.length - 1], bestPrice ?? 0) : null;
  const cheapestId = offers.filter((o) => o.price != null && o.available !== false).sort((a, b) => a.price! - b.price!)[0]?.variantId;
  const toPriceCheck = () => document.getElementById("price-check")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const addOffer = (o: Offer | null, from?: Element | null) => {
    cart.add(o ? offerAsProduct(p, o) : p);
    flyToCart(from ?? galleryRef.current);
    setAdded(o?.variantId ?? p.id);
    window.setTimeout(() => setAdded(null), 1400);
  };

  return (
    <div ref={root} className="mx-auto flex w-full max-w-[1800px] flex-col gap-6 sm:gap-8">
      {/* breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-ink-3" aria-label="Breadcrumb">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Back
        </button>
        <span>/</span>
        <span className="truncate">{p.title}</span>
        {loading && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      </nav>

      {/* hero */}
      <section data-sec className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10 2xl:gap-14 short:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] short:gap-5">
        <div ref={galleryRef} className="lg:sticky lg:top-[72px] lg:self-start">
          <Gallery media={p.media} title={p.title} fallback={p} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <p className="text-sm text-ink-3">{p.vendor ?? best?.seller.name ?? p.shopName}</p>
            <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">{p.title}</h1>
            {p.rating && (
              <div className="mt-2">
                <Stars value={p.rating.value} count={p.rating.count} size="md" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tnum text-[28px] font-semibold tracking-tight">
              {lo != null && hi != null && hi - lo > 0.009 ? `${money(lo, false, currency)} – ${money(hi, false, currency)}` : money(lo, false, currency)}
            </span>
            {stores > 1 && <span className="text-sm text-ink-2">from {stores} stores</span>}
            {best?.available === false && <Chip tone="danger">Sold out</Chip>}
          </div>

          {/* price check, at a glance */}
          {verdict && bestPrice != null && rangeLow != null && rangeHigh != null ? (
            <button onClick={toPriceCheck} className="group flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong">
              <span className="flex flex-wrap items-center gap-2">
                {(() => {
                  const V = VERDICT_STYLE[verdict.tone];
                  return (
                    <span className={cx("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold", V.pill)}>
                      <V.icon className="size-4" /> {verdict.label}
                    </span>
                  );
                })()}
                <span className="text-[13px] text-ink-2">{verdict.detail}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-3 group-hover:text-ink">
                  Compare <ArrowDown className="size-3.5 transition-transform group-hover:translate-y-0.5" />
                </span>
              </span>
              <PriceRange low={rangeLow} high={rangeHigh} typical={typical} value={bestPrice} currency={currency} tone={verdict.tone} size="sm" />
            </button>
          ) : similar === null ? (
            <div className="h-[74px] animate-pulse rounded-xl bg-surface-2" aria-label="Checking prices" />
          ) : null}

          {p.highlights.length > 0 && <p className="text-[15px] leading-relaxed text-ink-2">{p.highlights[0]}</p>}

          {p.options.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {p.options.map((o) => (
                <div key={o.name}>
                  <p className="text-[13px] font-medium">{o.name}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {o.values.map((v) => (
                      <span key={v} className="rounded-lg border border-line-strong px-2.5 py-1 text-[13px] text-ink-2">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* best offer */}
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label">{offers.length > 1 ? "Best price" : "Sold by"}</p>
                <p className="mt-1 truncate text-[15px] font-medium">{best?.seller.name ?? p.shopName ?? "Shopify store"}</p>
                <p className="text-xs text-ink-3">
                  {best?.condition.length ? best.condition.join(", ") : "new"}
                  {best?.available === false ? " · sold out" : " · in stock"}
                </p>
              </div>
              <span className="tnum text-xl font-semibold">{money(best?.price ?? p.price, false, currency)}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" size="lg" className="w-full sm:w-auto sm:flex-1" disabled={best?.available === false} onClick={() => addOffer(best)} icon={added === (best?.variantId ?? p.id) ? <Check className="size-4" /> : <Plus className="size-4" />}>
                {added === (best?.variantId ?? p.id) ? "Added" : "Add to cart"}
              </Button>
              {(best?.checkoutUrl ?? best?.url ?? p.url) && (
                <a
                  href={(best?.checkoutUrl ?? best?.url ?? p.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-[14px] font-medium"
                >
                  Buy at store <ArrowUpRight className="size-4" />
                </a>
              )}
            </div>
            <Button variant="ghost" onClick={() => onAskAssistant(refFromProduct(best ? offerAsProduct(p, best) : p))} icon={<Bot className="size-4" />}>
              Have the assistant buy this
            </Button>
          </div>
        </div>
      </section>

      {/* prices */}
      <section id="price-check" data-sec className="card scroll-mt-20 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold tracking-tight">Is this a good price?</h2>
          <span className="text-xs text-ink-3">Today’s live prices across stores and similar items</span>
        </div>
        {!verdict && <p className="mt-1 text-sm text-ink-2">{similar === null ? "Looking up similar items…" : "Prices from each store selling this item."}</p>}
        {verdict && bestPrice != null && rangeLow != null && rangeHigh != null && (
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-10">
            {(() => {
              const V = VERDICT_STYLE[verdict.tone];
              return (
                <div className="flex items-center gap-3">
                  <span className={cx("flex size-12 items-center justify-center rounded-2xl", V.pill)}>
                    <V.icon className="size-6" />
                  </span>
                  <div>
                    <p className="text-xl font-semibold tracking-tight">{verdict.label}</p>
                    <p className="text-sm text-ink-2">{verdict.detail}</p>
                  </div>
                </div>
              );
            })()}
            <PriceRange low={rangeLow} high={rangeHigh} typical={typical} value={bestPrice} currency={currency} tone={verdict.tone} />
          </div>
        )}
        {dots.length > 1 && (
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 text-[13px] font-medium">Every listing</p>
            <PriceChart dots={dots} currency={currency} />
          </div>
        )}

        {offers.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Stores selling {p.title}</caption>
              <thead>
                <tr className="border-b border-line">
                  {["Store", "Price", "Availability", "Rating", ""].map((h) => (
                    <th key={h} className="label py-2.5 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const policies = o.seller.links.filter((l) => /polic|terms|refund|shipping/i.test(l.type));
                  return (
                    <tr key={o.variantId} className="border-b border-line last:border-0">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2.5">
                          {o.image ? (
                            <img src={sized(o.image, 96)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-9 rounded-md object-cover shadow-[inset_0_0_0_1px_var(--line)]" />
                          ) : (
                            <Store className="size-4 text-ink-3" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{o.seller.name ?? o.seller.domain}</p>
                            {policies.length > 0 && (
                              <p className="flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                                {policies.slice(0, 3).map((l) => (
                                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="capitalize hover:text-ink hover:underline">
                                    {l.type.replace(/_/g, " ")}
                                  </a>
                                ))}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="tnum py-3 pr-3 font-semibold whitespace-nowrap">
                        {money(o.price, false, o.currency)}
                        {o.variantId === cheapestId && offers.length > 1 && (
                          <span className="ml-2 rounded-full bg-safe-soft px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-safe">Best price</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {o.available === false ? <span className="text-danger">Sold out</span> : <span className="text-ink-2">In stock</span>}
                        {o.condition.length > 0 && <span className="text-ink-3"> · {o.condition.join(", ")}</span>}
                      </td>
                      <td className="py-3 pr-3">{o.rating ? <Stars value={o.rating.value} count={o.rating.count} /> : <span className="text-ink-3">—</span>}</td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => addOffer(o)}
                            disabled={o.available === false}
                            className="btn-secondary inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold disabled:opacity-40"
                          >
                            {added === o.variantId ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                            {added === o.variantId ? "Added" : "Add"}
                          </button>
                          {(o.checkoutUrl ?? o.url) && (
                            <a href={(o.checkoutUrl ?? o.url)!} target="_blank" rel="noopener noreferrer" aria-label={`Buy at ${o.seller.name}`} className="btn-secondary inline-flex size-8 items-center justify-center rounded-lg">
                              <ArrowUpRight className="size-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* about */}
      {(p.description || p.features.length > 0) && (
        <section data-sec className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {p.description && (
            <div className="card p-5 sm:p-6">
              <h2 className="text-[17px] font-semibold tracking-tight">About this item</h2>
              <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{p.description}</p>
            </div>
          )}
          {p.features.length > 0 && (
            <div className="card p-5 sm:p-6">
              <h2 className="text-[17px] font-semibold tracking-tight">Features</h2>
              <ul className="mt-3 flex flex-col gap-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                    <Check className="mt-1 size-3.5 shrink-0 text-safe" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* similar */}
      <section data-sec className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Similar products</h2>
        {similar === null ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="card aspect-[4/5] animate-pulse" />
            ))}
          </div>
        ) : similar.length ? (
          <AutoRail label="Similar products" speed={26}>
            {similar.slice(0, 12).map((s) => (
              <SimilarTile key={s.id} s={s} onOpen={() => onOpen(s)} />
            ))}
          </AutoRail>
        ) : (
          <p className="text-sm text-ink-3">No similar products found.</p>
        )}
      </section>

      {/* everything the API returned */}
      <section data-sec className="card p-5 sm:p-6">
        <button onClick={() => setShowRaw((s) => !s)} className="flex w-full items-center justify-between gap-3 text-left">
          <span>
            <span className="block text-[15px] font-semibold">All product data</span>
            <span className="block text-xs text-ink-3">
              Everything Shopify returned for this item
            </span>
          </span>
          <ChevronDown className={cx("size-4 shrink-0 transition-transform", showRaw && "rotate-180")} />
        </button>
        {showRaw && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <span className="truncate">{p.id}</span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(p.id);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }}
                aria-label="Copy product ID"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink"
              >
                {copied ? <Check className="size-3.5 text-safe" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <pre className="thin-scroll max-h-[480px] overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify(p.raw, null, 2)}</pre>
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-xs text-ink-3">
        <ShieldCheck className="size-3.5" /> Prices and stock come straight from each store and can change.
      </p>
    </div>
  );
}
