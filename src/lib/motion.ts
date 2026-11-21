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

export { gsap, useGSAP };
