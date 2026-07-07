"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Two app-wide touch/navigation affordances, mounted once in the root layout:
 *
 * 1. TAP GUARD — founder (Jul 7): "the app is really sensitive as I'm
 *    scrolling, it accidentally clicks into different areas". A capture-phase
 *    click filter swallows the two phantom-tap cases scrolling produces:
 *      • the finger MOVED during the touch (browser tap-slop is ~10px, which
 *        lets slow scroll-drags through as clicks — we tighten to 8px), and
 *      • the tap landed while the page was still scrolling (momentum): the
 *        tap's job was to stop the scroll, not to open whatever slid under it.
 *
 * 2. NAV PROGRESS — a thin teal bar at the very top that appears the moment
 *    an internal link is tapped and disappears when the route changes, so a
 *    navigation is acknowledged INSTANTLY even when the next screen takes a
 *    beat to load.
 */

const MOVE_SLOP_PX = 8;
const SCROLL_QUIET_MS = 100;

export function TouchGuards() {
  const pathname = usePathname();
  const [navigating, setNavigating] = useState(false);

  // Route changed — the destination rendered; drop the bar.
  useEffect(() => { setNavigating(false); }, [pathname]);

  useEffect(() => {
    let startX = 0, startY = 0, moved = 0, lastScroll = 0, touchActive = false;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX; startY = t.clientY; moved = 0; touchActive = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      moved = Math.max(moved, Math.hypot(t.clientX - startX, t.clientY - startY));
    };
    // capture:true so scrolls inside nested containers (horizontal rails,
    // sheets) count too — `scroll` doesn't bubble.
    const onScroll = () => { lastScroll = performance.now(); };

    const onClick = (e: MouseEvent) => {
      const scrolling = performance.now() - lastScroll < SCROLL_QUIET_MS;
      // The browser drops touchmove events entirely below its own ~15px slop,
      // so ALSO measure touchstart → click distance (the click carries the
      // touchend coordinates). Touch clicks only — mouse clicks skip this.
      const clickDrift = touchActive ? Math.hypot(e.clientX - startX, e.clientY - startY) : 0;
      touchActive = false;
      if (moved > MOVE_SLOP_PX || clickDrift > MOVE_SLOP_PX || scrolling) {
        e.preventDefault();
        e.stopPropagation();
        moved = 0;
        return;
      }
      // Legit tap on an internal link → acknowledge the navigation instantly.
      const a = (e.target as Element | null)?.closest?.('a[href^="/"]');
      if (a && !e.defaultPrevented) setNavigating(true);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true } as EventListenerOptions);
      document.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
    };
  }, []);

  // Failsafe: never leave the bar up (external links, cancelled navs).
  useEffect(() => {
    if (!navigating) return;
    const t = setTimeout(() => setNavigating(false), 8000);
    return () => clearTimeout(t);
  }, [navigating]);

  if (!navigating) return null;
  return (
    <div aria-hidden className="fixed top-0 left-0 right-0 z-[100] pointer-events-none" style={{ height: 3 }}>
      <div
        style={{
          height: "100%",
          background: "linear-gradient(90deg, #00d8c0, #aeea00)",
          boxShadow: "0 0 8px rgba(0,216,192,0.8)",
          transformOrigin: "left",
          animation: "ys-nav-progress 1.2s cubic-bezier(0.2, 0.6, 0.3, 1) forwards",
        }}
      />
      <style>{`@keyframes ys-nav-progress { from { transform: scaleX(0.08); } 60% { transform: scaleX(0.7); } to { transform: scaleX(0.92); } }`}</style>
    </div>
  );
}
