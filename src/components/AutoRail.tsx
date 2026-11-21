import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { reducedMotion } from "../lib/motion";
import { cx } from "./ui";

/**
 * A row of cards that glides sideways on its own and loops seamlessly.
 * - pauses on hover, keyboard focus, touch or manual scrolling, and resumes 2.5 s later
 * - goes idle when off screen or when the tab is hidden (no work you can't see)
 * - never auto-moves for people who prefer reduced motion
 * Items are rendered twice so the loop has no visible seam; the copy is hidden from assistive tech.
 */
export function AutoRail({
  children,
  itemClassName = "w-[46%] sm:w-[31.5%] lg:w-[24%] 2xl:w-[19.3%] min-[1900px]:w-[16.1%]",
  speed = 28,
  label,
  className,
}: {
  children: ReactNode;
  itemClassName?: string;
  /** pixels per second */
  speed?: number;
  label: string;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstCopy = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const resumeAt = useRef(0);
  const visible = useRef(true);
  const [canLoop, setCanLoop] = useState(false);
  const items = Children.toArray(children);

  // Loop only when the content is wider than the rail.
  useEffect(() => {
    const el = scroller.current;
    const copy = firstCopy.current;
    if (!el || !copy) return;
    const check = () => setCanLoop(copy.scrollWidth > el.clientWidth + 8);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    ro.observe(copy);
    return () => ro.disconnect();
  }, [items.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !canLoop || reducedMotion()) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting), { threshold: 0.05 });
    io.observe(el);

    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const copyWidth = firstCopy.current?.scrollWidth ?? 0;
      if (!paused.current && now > resumeAt.current && visible.current && !document.hidden && copyWidth) {
        carry += (speed * dt) / 1000;
        const step = Math.floor(carry);
        if (step) {
          carry -= step;
          el.scrollLeft += step;
        }
        if (el.scrollLeft >= copyWidth) el.scrollLeft -= copyWidth; // seamless wrap
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [canLoop, speed]);

  const hold = () => {
    resumeAt.current = performance.now() + 2500;
  };
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    hold();
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <div className={cx("group/rail relative", className)} role="region" aria-roledescription="carousel" aria-label={label}>
      <div
        ref={scroller}
        className="thin-scroll -mx-1 flex overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => {
          paused.current = false;
          hold();
        }}
        onFocusCapture={() => (paused.current = true)}
        onBlurCapture={() => (paused.current = false)}
        onTouchStart={() => (paused.current = true)}
        onTouchEnd={() => {
          paused.current = false;
          hold();
        }}
        onWheel={hold}
      >
        <div ref={firstCopy} className="flex shrink-0 gap-2.5 pr-2.5 sm:gap-3 sm:pr-3">
          {items.map((child, i) => (
            <div key={i} className={cx("shrink-0", itemClassName)}>
              {child}
            </div>
          ))}
        </div>
        {canLoop && (
          <div className="flex shrink-0 gap-2.5 pr-2.5 sm:gap-3 sm:pr-3" aria-hidden inert>
            {items.map((child, i) => (
              <div key={i} className={cx("shrink-0", itemClassName)}>
                {child}
              </div>
            ))}
          </div>
        )}
      </div>

      {canLoop && (
        <>
          <button
            onClick={() => page(-1)}
            aria-label="Scroll left"
            className="btn-secondary absolute top-[38%] -left-2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-float transition-opacity group-hover/rail:opacity-100 md:inline-flex"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => page(1)}
            aria-label="Scroll right"
            className="btn-secondary absolute top-[38%] -right-2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-float transition-opacity group-hover/rail:opacity-100 md:inline-flex"
          >
            <ChevronRight className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
