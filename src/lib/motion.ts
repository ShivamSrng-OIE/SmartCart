import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

gsap.defaults({ ease: "power3.out", duration: 0.5 });

/** One house easing set so every animation feels like the same instrument. */
export const EASE = {
  out: "power3.out",
  snap: "expo.out",
  inOut: "power2.inOut",
  spring: "back.out(1.6)",
};

export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Duration helper that collapses to ~0 when the user prefers reduced motion. */
export const d = (seconds: number) => (reducedMotion() ? 0.001 : seconds);

/** Tween a number into an element's textContent without React re-renders. */
export function countTo(
  el: HTMLElement | null,
  to: number,
  format: (n: number) => string,
  opts: { from?: number; duration?: number; delay?: number } = {},
) {
  if (!el) return;
  const state = { v: opts.from ?? 0 };
  if (reducedMotion()) {
    el.textContent = format(to);
    return;
  }
  return gsap.to(state, {
    v: to,
    duration: opts.duration ?? 1.1,
    delay: opts.delay ?? 0,
    ease: "power2.out",
    onUpdate: () => {
      el.textContent = format(state.v);
    },
  });
}

/** The first cart target that is actually on screen (header button, cart panel, or floating cart). */
function visibleCartTarget(): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-cart-target]"));
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }) ?? null;
}

/**
 * Fly a snapshot of `source` (usually a product image) into the cart along a short arc,
 * then pop the cart badge. One fixed-position element, transforms only.
 */
export function flyToCart(source: Element | null | undefined) {
  const target = visibleCartTarget();
  const bump = () => {
    document.querySelectorAll<HTMLElement>("[data-cart-badge]").forEach((b) =>
      gsap.fromTo(b, { scale: 1.6 }, { scale: 1, duration: d(0.5), ease: "elastic.out(1.1, 0.45)" }),
    );
    if (target) gsap.fromTo(target, { rotate: -8 }, { rotate: 0, duration: d(0.5), ease: "elastic.out(1.2, 0.4)" });
  };
  if (!source || !target || reducedMotion()) return bump();

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const img = source.querySelector("img") as HTMLImageElement | null;
  const size = Math.min(from.width, from.height, 140);

  const ghost = document.createElement("div");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left + from.width / 2 - size / 2}px`,
    top: `${from.top + from.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "14px",
    background: img?.currentSrc ? `#fff url("${img.currentSrc}") center/contain no-repeat` : "var(--surface-2)",
    boxShadow: "0 12px 30px -10px rgb(0 0 0 / 0.45)",
    zIndex: "9999",
    pointerEvents: "none",
    willChange: "transform, opacity",
  });
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const tl = gsap.timeline({ onComplete: () => (ghost.remove(), bump()) });
  tl.to(ghost, { scale: 1.08, duration: 0.12, ease: "power2.out" })
    .to(ghost, { x: dx, duration: 0.62, ease: "power2.inOut" }, ">")
    .to(ghost, { y: dy, duration: 0.62, ease: "back.in(1.4)" }, "<")
    .to(ghost, { scale: 0.18, borderRadius: "50%", duration: 0.62, ease: "power2.in" }, "<")
    .to(ghost, { opacity: 0, duration: 0.12 }, "-=0.1");
}

export { gsap, useGSAP };
