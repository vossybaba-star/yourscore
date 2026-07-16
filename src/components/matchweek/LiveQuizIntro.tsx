"use client";

/**
 * Matchweek → Live Quiz → the headline tile at the top of the section.
 *
 * Two swipeable pages, two headlines — what this IS, in the time it takes to
 * glance. It replaced a numbered "how it works" explainer: nobody reads a
 * three-step tutorial on a football app, but everybody reads a headline.
 *
 * The PREDICT page was deliberately dropped (founder, 2026-07-16): calling the
 * second half isn't something we market — it's ours, for content. The feature
 * stays; it just doesn't get a headline.
 *
 * Snap-scrolled (not auto-advancing) — a carousel that moves on its own steals
 * the sentence you were halfway through.
 */

import { useRef, useState } from "react";

const TEAL = "#00d8c0";

/**
 * Line breaks are AUTHORED, not left to wrapping. At this size the break is part
 * of the typography — "Half time. / Your time." lands; "Half time. Your / time."
 * doesn't. Splitting also lets the type run much bigger than a single line could.
 */
const PAGES = [
  {
    eyebrow: "HALF TIME",
    lines: ["Half time.", "Your time."],
    line: "A quiz for every fixture, the moment the real whistle blows.",
    art: "ball" as const,
  },
  {
    eyebrow: "YOUR CLUB",
    lines: ["Play for", "the badge."],
    line: "Your score joins every other fan's. Best average tops the table.",
    art: "badge" as const,
  },
];

/** Football, in line art. Cropped by the tile edge so it reads as texture, not clipart. */
function BallArt() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true"
      style={{ position: "absolute", right: -26, bottom: -30, width: 180, height: 180, opacity: 0.1, pointerEvents: "none" }}>
      <circle cx="50" cy="50" r="44" fill="none" stroke={TEAL} strokeWidth="2.5" />
      <polygon points="50,36 63.3,45.7 58.2,61.3 41.8,61.3 36.7,45.7" fill="none" stroke={TEAL} strokeWidth="2.5" />
      <g stroke={TEAL} strokeWidth="2.5">
        <line x1="50" y1="36" x2="50" y2="6" />
        <line x1="63.3" y1="45.7" x2="91.8" y2="36.4" />
        <line x1="58.2" y1="61.3" x2="75.9" y2="85.6" />
        <line x1="41.8" y1="61.3" x2="24.1" y2="85.6" />
        <line x1="36.7" y1="45.7" x2="8.2" y2="36.4" />
      </g>
    </svg>
  );
}

/** Club badge, in line art. */
function BadgeArt() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true"
      style={{ position: "absolute", right: -18, bottom: -26, width: 168, height: 168, opacity: 0.1, pointerEvents: "none" }}>
      <path d="M50,8 L88,22 V52 C88,74 70,88 50,94 C30,88 12,74 12,52 V22 Z"
        fill="none" stroke={TEAL} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M12,40 H88" stroke={TEAL} strokeWidth="2.5" />
      <path d="M50,40 V94" stroke={TEAL} strokeWidth="2.5" />
    </svg>
  );
}

export function LiveQuizIntro() {
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    // Round to the nearest page — mid-swipe positions shouldn't flicker the dot.
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== page) setPage(i);
  }

  function go(i: number) {
    const el = scroller.current;
    if (!el) return;
    setPage(i);
    /**
     * behavior:"auto" (instant), NOT "smooth" — deliberate, and measured.
     * Two things break a programmatic smooth scroll here:
     *  1. scroll-snap-type: mandatory CANCELS it — smooth left scrollLeft at 0
     *     where auto reached 341.
     *  2. Mid-animation scroll positions round back to the previous page, so
     *     onScroll would fire setPage(0) straight over this setPage(1) and the
     *     dot would snap back while the content sat still.
     * Tapping a dot is a jump-to, not a journey; the swipe gesture still
     * animates natively, which is the interaction that actually wants motion.
     */
    el.scrollTo({ left: i * el.clientWidth, behavior: "auto" });
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(150deg, rgba(0,216,192,0.09), rgba(0,216,192,0.02))", border: "1px solid rgba(0,216,192,0.2)" }}>
        <div ref={scroller} onScroll={onScroll}
          className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {PAGES.map((p) => (
            <div key={p.eyebrow} className="w-full flex-shrink-0 snap-center relative overflow-hidden px-5 pt-4 pb-3.5">
              {p.art === "ball" ? <BallArt /> : <BadgeArt />}

              {/* Text sits above the art. */}
              <div className="relative">
                <p className="font-display text-[10px] tracking-widest mb-1.5" style={{ color: TEAL }}>{p.eyebrow}</p>
                {/* The headline IS the tile — no dead space above or below it. */}
                <p className="font-display text-white" style={{ fontSize: 46, lineHeight: 0.9, letterSpacing: "-0.015em" }}>
                  {p.lines.map((l) => <span key={l} className="block">{l}</span>)}
                </p>
                <p className="font-body text-xs mt-2.5 max-w-[78%]" style={{ color: "#8a948f" }}>{p.line}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Dots — tappable, so it works without a swipe on desktop too. The DOT
            is 6px but the BUTTON is padded out to a real finger-sized target;
            a 6px tap target is a miss on a phone. */}
        <div className="flex justify-center pb-1.5">
          {PAGES.map((p, i) => (
            <button key={p.eyebrow} onClick={() => go(i)} aria-label={`Go to ${p.lines.join(" ")}`}
              className="flex items-center justify-center" style={{ width: 26, height: 22 }}>
              <span className="block rounded-full transition-all"
                style={{
                  width: i === page ? 18 : 6, height: 6,
                  background: i === page ? TEAL : "rgba(255,255,255,0.2)",
                }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
