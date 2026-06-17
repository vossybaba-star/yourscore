"use client";

import { Children, useEffect, useRef } from "react";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Horizontal swipe carousel built on native CSS scroll-snap — no dependency, and
// iOS momentum / rubber-band come for free inside the WebView. Controlled: the
// parent owns `index`; a programmatic change (dot tap / Next) scrolls to it,
// and a user swipe reports the new index back via onIndex.
export function PanelCarousel({
  index,
  onIndex,
  children,
}: {
  index: number;
  onIndex: (i: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const count = Children.count(children);

  // Drive the scroll position when the index changes externally (Next / dots).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = index * el.clientWidth;
    if (Math.abs(el.scrollLeft - left) < 2) return;
    el.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [index]);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // Report the index back only once scrolling has *settled* on a snap point.
  // Reading it on every intermediate frame would round a programmatic smooth
  // scroll (0 → 375) back to 0 mid-animation and fight it — so we debounce until
  // movement stops, which reflects the final snapped panel for swipe and buttons.
  function handleScroll() {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el || el.clientWidth === 0) return;
      const i = Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth)));
      if (i !== index) onIndex(i);
    }, 90);
  }

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="flex-1 flex overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
      style={{
        scrollSnapType: "x mandatory",
        overscrollBehaviorX: "contain",
        scrollbarWidth: "none",
      }}
    >
      {Children.map(children, (child) => (
        <div className="shrink-0 basis-full w-full" style={{ scrollSnapAlign: "start" }}>
          {child}
        </div>
      ))}
    </div>
  );
}
