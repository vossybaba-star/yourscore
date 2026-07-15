"use client";

/**
 * Matchweek → Live Quiz → "how fans did" stat tiles. Tweet-shaped cards: a real
 * question, the answer, and how the crowd split on it. Social proof that the
 * game is being played, and a nudge that you might do better.
 *
 * Horizontal carousel so a handful of highlights sit in a glance, not a stack.
 */

import { useEffect, useState } from "react";
import { angleFor, type QuizHighlight } from "@/lib/pl/highlights";

const TEAL = "#00d8c0";
const WARN = "#e0a34a";

export function QuizStatTiles() {
  const [items, setItems] = useState<QuizHighlight[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/pl/quiz-highlights")
      .then((r) => r.json())
      .then((j) => { if (live) { setItems(j.doc?.items ?? []); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  if (!loaded || items.length === 0) return null; // self-hide

  return (
    <div className="pt-5">
      <div className="max-w-lg mx-auto px-4 mb-2.5">
        <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>HOW FANS DID</span>
      </div>

      <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x" style={{ scrollbarWidth: "none" }}>
        {items.map((h) => {
          const angle = angleFor(h.correctPct);
          const accent = angle.tone === "good" ? TEAL : WARN;
          return (
            <div key={h.id}
              className="flex-shrink-0 snap-start rounded-2xl p-4 flex flex-col"
              style={{ width: 264, background: "#141b18", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="font-body text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: `${accent}1e`, color: accent, border: `1px solid ${accent}44` }}>
                  {angle.label}
                </span>
                {h.fixture && <span className="font-body text-[11px] truncate" style={{ color: "#586058" }}>{h.fixture}</span>}
              </div>

              <p className="font-body text-sm text-white leading-snug mb-3">{h.question}</p>

              {/* the split */}
              <div className="mt-auto">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-display text-2xl" style={{ color: accent }}>{Math.round(h.correctPct)}%</span>
                  <span className="font-body text-[11px]" style={{ color: "#8a948f" }}>got it right</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div style={{ width: `${Math.max(3, Math.min(100, h.correctPct))}%`, height: "100%", background: accent }} />
                </div>
                <p className="font-body text-[11px] mt-2" style={{ color: "#8a948f" }}>
                  Answer: <span className="text-white">{h.answer}</span> · {h.sampleSize.toLocaleString()} played
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
