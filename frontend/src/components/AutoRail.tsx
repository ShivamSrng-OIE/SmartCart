import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { reducedMotion } from "../lib/motion";
import { cx } from "./ui";

/**
 * A row of cards that glides sideways on its own and loops seamlessly.
 * - eases to a stop on hover / focus / touch and eases back into motion afterwards
 * - drag with the mouse (desktop) or swipe (touch); arrows page by ~a screen
 * - goes idle when off screen or when the tab is hidden; never auto-moves with reduced motion
 * Items render twice so the loop has no seam; the copy is hidden from assistive tech.
 */
export function AutoRail({
  children,
  // Widths in cqw = % of the visible rail (the scroller is a size container), never of the moving track.
  itemClassName = "w-[42cqw] sm:w-[30.5cqw] lg:w-[23.4cqw] 2xl:w-[18.8cqw] min-[1900px]:w-[15.7cqw]",
  speed = 28,
  label,
  className,
}: {
  children: ReactNode;
  itemClassName?: string;
  /** pixels per second at full speed */
  speed?: number;
  label: string;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstCopy = useRef<HTMLDivElement>(null);
  const held = useRef(false); // hover / focus / touch
  const resumeAt = useRef(0);
  const visible = useRef(true);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [canLoop, setCanLoop] = useState(false);
  const [dragging, setDragging] = useState(false);
  const items = Children.toArray(children);

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
    let v = 0; // current velocity, eased toward the target so stops and starts feel soft
    let carry = 0;
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const copyWidth = firstCopy.current?.scrollWidth ?? 0;
      const target = !held.current && !drag.current && now > resumeAt.current && visible.current && !document.hidden ? speed : 0;
      v += (target - v) * Math.min(1, dt / 220);
      if (copyWidth && v > 0.5) {
        carry += (v * dt) / 1000;
        const step = Math.floor(carry);
        if (step) {
          carry -= step;
          el.scrollLeft += step;
        }
      }
      if (copyWidth && el.scrollLeft >= copyWidth) el.scrollLeft -= copyWidth; // seamless wrap
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [canLoop, speed]);

  const hold = (ms = 2500) => {
    resumeAt.current = performance.now() + ms;
  };
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    hold(4000);
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  // Mouse drag (touch already scrolls natively). A drag never triggers the card's click.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !scroller.current) return;
    drag.current = { x: e.clientX, left: scroller.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = scroller.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) {
      const copyWidth = firstCopy.current?.scrollWidth ?? 0;
      let left = d.left - dx;
      if (canLoop && copyWidth) left = ((left % copyWidth) + copyWidth) % copyWidth;
      el.scrollLeft = left;
    }
  };
  const endDrag = () => {
    if (drag.current?.moved) hold(3000);
    drag.current = null;
    window.setTimeout(() => setDragging(false), 0);
  };

  const card = (child: ReactNode, i: number) => (
    <div key={i} className={cx("shrink-0", itemClassName)}>
      {child}
    </div>
  );

  return (
    <div className={cx("group/rail relative", className)} role="region" aria-roledescription="carousel" aria-label={label}>
      <div
        ref={scroller}
        className={cx(
          "@container -mx-1 flex overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          canLoop && "[mask-image:linear-gradient(90deg,transparent,#000_3%,#000_97%,transparent)]",
          dragging ? "cursor-grabbing select-none" : canLoop && "md:cursor-grab",
        )}
        onMouseEnter={() => (held.current = true)}
        onMouseLeave={() => {
          held.current = false;
          endDrag();
          hold(900);
        }}
        onFocusCapture={() => (held.current = true)}
        onBlurCapture={() => (held.current = false)}
        onTouchStart={() => (held.current = true)}
        onTouchEnd={() => {
          held.current = false;
          hold(2500);
        }}
        onWheel={() => hold(2500)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onClickCapture={(e) => {
          if (dragging) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        <div ref={firstCopy} className="flex shrink-0 gap-2.5 pr-2.5 sm:gap-3 sm:pr-3">
          {items.map(card)}
        </div>
        {canLoop && (
          <div className="flex shrink-0 gap-2.5 pr-2.5 sm:gap-3 sm:pr-3" aria-hidden inert>
            {items.map(card)}
          </div>
        )}
      </div>

      {canLoop && (
        <>
          <button
            onClick={() => page(-1)}
            aria-label="Scroll left"
            className="btn-secondary absolute top-[36%] left-1 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-float transition-[opacity,transform] duration-200 group-hover/rail:opacity-100 hover:scale-105 md:inline-flex"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => page(1)}
            aria-label="Scroll right"
            className="btn-secondary absolute top-[36%] right-1 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-float transition-[opacity,transform] duration-200 group-hover/rail:opacity-100 hover:scale-105 md:inline-flex"
          >
            <ChevronRight className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
