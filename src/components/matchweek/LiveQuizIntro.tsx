"use client";

/**
 * Matchweek → Live Quiz → the headline tile at the top of the section.
 *
 * Three swipeable pages, three headlines — what this IS, in the time it takes to
 * glance. It replaced a numbered "how it works" explainer: nobody reads a
 * three-step tutorial on a football app, but everybody reads a headline, and the
 * dots invite the swipe that delivers the next one.
 *
 * Snap-scrolled (not auto-advancing) — a carousel that moves on its own steals
 * the sentence you were halfway through.
 */

import { useRef, useState } from "react";

const TEAL = "#00d8c0";

const PAGES = [
  { eyebrow: "HALF TIME", headline: "A quiz at every half time", line: "The real whistle blows, your pack drops. One for every fixture." },
  { eyebrow: "PREDICT", headline: "Call the second half", line: "One pick before it restarts. Graded at full time." },
  { eyebrow: "YOUR CLUB", headline: "Play for your club", line: "Every fan's score counts. Best average tops the table." },
];

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
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(150deg, rgba(0,216,192,0.08), rgba(0,216,192,0.02))", border: "1px solid rgba(0,216,192,0.2)" }}>
        <div ref={scroller} onScroll={onScroll}
          className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {PAGES.map((p) => (
            <div key={p.eyebrow} className="w-full flex-shrink-0 snap-center px-5 pt-5 pb-4" style={{ minHeight: 132 }}>
              <p className="font-display text-[10px] tracking-widest mb-2" style={{ color: TEAL }}>{p.eyebrow}</p>
              <p className="font-display text-xl text-white leading-tight">{p.headline}</p>
              <p className="font-body text-sm mt-1.5" style={{ color: "#8a948f" }}>{p.line}</p>
            </div>
          ))}
        </div>

        {/* Dots — tappable, so it works without a swipe on desktop too. The DOT
            is 6px but the BUTTON is padded out to a real finger-sized target;
            a 6px tap target is a miss on a phone. */}
        <div className="flex justify-center pb-2">
          {PAGES.map((p, i) => (
            <button key={p.eyebrow} onClick={() => go(i)} aria-label={`Go to ${p.headline}`}
              className="flex items-center justify-center" style={{ width: 26, height: 26 }}>
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
