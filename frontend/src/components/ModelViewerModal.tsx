import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Download, Loader2, RotateCcw, Smartphone, X } from "lucide-react";
import { modelSources, type MediaItem } from "../catalog";
import { gsap, useGSAP, d } from "../lib/motion";
import { cx } from "./ui";

function mb(bytes: number | null | undefined) {
  return bytes ? `${(bytes / 1_048_576).toFixed(1)} MB` : null;
}

/**
 * Full-screen interactive 3D viewer for a product's model_3d media.
 * The viewer library and the model file are only downloaded when this opens.
 */
export function ModelViewerModal({ media, title, onClose }: { media: MediaItem; title: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const viewer = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false); // web component registered
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const { glb, usdz } = modelSources(media);

  useEffect(() => {
    let alive = true;
    import("@google/model-viewer")
      .then(() => alive && setReady(true))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = viewer.current;
    if (!el) return;
    const onProgress = (e: Event) => setProgress((e as CustomEvent<{ totalProgress: number }>).detail.totalProgress);
    const onError = () => setFailed(true);
    el.addEventListener("progress", onProgress);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("progress", onProgress);
      el.removeEventListener("error", onError);
    };
  }, [ready]);

  const close = () => {
    gsap.to(scrim.current, { opacity: 0, duration: d(0.18) });
    gsap.to(panel.current, { y: 24, opacity: 0, scale: 0.98, duration: d(0.22), ease: "power2.in", onComplete: onClose });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useGSAP(() => {
    gsap.fromTo(scrim.current, { opacity: 0 }, { opacity: 1, duration: d(0.25) });
    gsap.fromTo(panel.current, { y: 28, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: d(0.45), ease: "expo.out" });
  });

  const resetView = () => {
    const el = viewer.current as (HTMLElement & { cameraOrbit?: string; resetTurntableRotation?: () => void; jumpCameraToGoal?: () => void }) | null;
    if (!el) return;
    el.cameraOrbit = "auto auto auto";
    el.resetTurntableRotation?.();
    el.jumpCameraToGoal?.();
  };

  const loading = !failed && (!ready || progress < 1);

  // Portal to <body>: an animated (transformed) ancestor would otherwise trap position: fixed.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`3D view of ${title}`}>
      <div ref={scrim} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div ref={panel} className="relative flex h-[88dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-float sm:h-[82dvh] sm:rounded-2xl short:h-[96dvh]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Box className="size-4 shrink-0 text-ink-2" />
            <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={resetView} aria-label="Reset view" title="Reset view" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
              <RotateCcw className="size-4" />
            </button>
            <button onClick={close} aria-label="Close" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 bg-[radial-gradient(circle_at_50%_40%,var(--surface)_0%,var(--surface-2)_70%)]">
          {ready && glb && !failed && (
            <model-viewer
              ref={viewer}
              src={glb.url}
              ios-src={usdz?.url}
              poster={media.poster ?? undefined}
              alt={media.alt ?? title}
              camera-controls
              auto-rotate
              auto-rotate-delay="1500"
              rotation-per-second="18deg"
              shadow-intensity="1"
              exposure="1"
              touch-action="pan-y"
              interaction-prompt="auto"
              ar
              ar-modes="webxr scene-viewer quick-look"
              loading="eager"
              style={{ width: "100%", height: "100%", background: "transparent" }}
            >
              <button
                slot="ar-button"
                className="btn-primary absolute right-4 bottom-4 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold"
              >
                <Smartphone className="size-4" /> View in your space
              </button>
            </model-viewer>
          )}

          {(loading || failed) && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {media.poster && !ready && <img src={media.poster} alt="" className="absolute inset-0 m-auto max-h-[70%] max-w-[70%] object-contain opacity-60" />}
              {failed ? (
                <p className="relative rounded-lg bg-surface px-3 py-2 text-sm text-ink-2 shadow-card">This 3D model couldn’t be loaded.</p>
              ) : (
                <div className="relative flex w-56 flex-col items-center gap-2 rounded-xl bg-surface/90 px-4 py-3 shadow-card backdrop-blur">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    <Loader2 className="size-4 animate-spin" /> Loading 3D model{glb?.size ? ` · ${mb(glb.size)}` : ""}
                  </span>
                  <span className="h-1 w-full overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-ink-3">
          <span>Drag to rotate · scroll or pinch to zoom · right-drag to pan</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {[glb && { ...glb, label: "GLB" }, usdz && { ...usdz, label: "USDZ (iPhone AR)" }].filter(Boolean).map((s) => {
              const x = s as { url: string; size: number | null; label: string };
              return (
                <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className={cx("inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-ink-2 hover:border-line-strong hover:text-ink")}>
                  <Download className="size-3" /> {x.label}
                  {x.size ? <span className="text-ink-3">· {mb(x.size)}</span> : null}
                </a>
              );
            })}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
