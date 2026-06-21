"use client";

/**
 * WcEditionStrip — the World Cup Mastermind "are you up to date?" scroller on the WC tab.
 *
 * A horizontal row of date chips, one per ranked edition (oldest → today, auto-scrolled to
 * today). Each chip reflects THIS user's state for that day:
 *   • today, open      → tap to play today's ranked run
 *   • past, not played → tap to CATCH UP (play that edition; it still counts)
 *   • played           → tap to peek that day's result inline (quiz · outcome · W-D-L)
 *   • used (locked, no finished run) → dimmed, not playable
 * A summary line above tells them at a glance whether they're caught up or owe some days.
 *
 * It replaces the standalone /38-0/wc/catch-up page. Data comes from /api/draft/wc/draft
 * (action:"status" → editions[]). Catch-up / play are delegated to the parent (which owns
 * the draft flow); peeking is local state.
 */

import { useEffect, useRef, useState } from "react";

export type EditionCell = {
  date: string; isToday: boolean; played: boolean; available: boolean;
  runId: string | null; quizCorrect: number | null; quizTotal: number | null;
  status: string | null; stage: string | null; wdl: { w: number; d: number; l: number } | null;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STAGE_LABEL: Record<string, string> = {
  group: "Group", ko: "Knockouts", playoff: "Play-off", qf: "Quarter-final", sf: "Semi-final", final: "Final",
};

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return { dow: DOW[dt.getUTCDay()], day: d ?? 0, mon: MON[(m ?? 1) - 1] };
}

function resultLine(c: EditionCell): { text: string; color: string } {
  const stage = c.stage ? STAGE_LABEL[c.stage] ?? c.stage : "";
  if (c.status === "champion") return { text: "🏆 World Champions", color: "#ffb800" };
  if (c.status === "eliminated") return { text: `Out — ${stage}`, color: "#ff6b78" };
  return { text: `In progress — ${stage}`, color: "#aeea00" };
}

export function WcEditionStrip({
  editions, onPlayToday, onCatchUp, onViewRun,
}: {
  editions: EditionCell[];
  onPlayToday: () => void;
  onCatchUp: (date: string) => void;
  onViewRun: (runId: string) => void;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Land on today (right end) so the most recent edition is in view first.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [editions.length]);

  if (!editions.length) return null;

  const missed = editions.filter((e) => !e.isToday && e.available).length;
  const open = editions.find((e) => e.date === openDate) ?? null;

  function tap(c: EditionCell) {
    if (c.played) { setOpenDate(openDate === c.date ? null : c.date); return; }
    if (c.isToday && c.available) { onPlayToday(); return; }
    if (c.available) { onCatchUp(c.date); return; }
    // used (locked, no finished run) — nothing to do
  }

  return (
    <div className="mb-5">
      {/* Catch-up chips gently pulse so missed days draw the eye. */}
      <style>{`@keyframes wcCatchupFlash{0%,100%{background-color:#0e1611;box-shadow:0 0 0 0 rgba(255,184,0,0)}50%{background-color:#1b1408;box-shadow:0 0 14px 0 rgba(255,184,0,0.4)}}.wc-catchup-flash{animation:wcCatchupFlash 1.6s ease-in-out infinite}`}</style>
      {/* subheading + up-to-date status */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-display tracking-wide" style={{ fontSize: 15, color: "#ffb800" }}>YOUR RANKED WORLD CUP</span>
        <span className="flex-1" />
        {missed === 0 ? (
          <span className="font-body flex items-center gap-1" style={{ fontSize: 12, color: "#aeea00" }}>
            <span>✓</span> All caught up
          </span>
        ) : (
          <span className="font-body" style={{ fontSize: 12, color: "#ffd27a" }}>
            {missed} {missed === 1 ? "day" : "days"} to catch up
          </span>
        )}
      </div>

      {/* the scroller */}
      <div ref={scroller} className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
        {editions.map((c) => {
          const p = parts(c.date);
          const isOpen = openDate === c.date;
          const win = c.status === "champion";
          // visual state
          const border = c.isToday ? "rgba(255,184,0,0.7)"
            : c.played ? (win ? "rgba(255,184,0,0.55)" : "rgba(174,234,0,0.5)")
            : c.available ? "rgba(255,210,122,0.55)"
            : "rgba(255,255,255,0.1)";
          const dashed = !c.played && c.available && !c.isToday;
          const tag = c.played ? (win ? "🏆" : "✓")
            : c.isToday ? (c.available ? "PLAY" : "USED")
            : c.available ? "CATCH UP" : "USED";
          const tagColor = c.played ? (win ? "#ffb800" : "#aeea00")
            : c.available ? (c.isToday ? "#1a1300" : "#ffd27a") : "#5f6b62";
          const dim = !c.played && !c.available;
          return (
            <button key={c.date} onClick={() => tap(c)}
              className={`flex flex-col items-center rounded-2xl active:scale-[0.97] transition-transform flex-shrink-0${dashed ? " wc-catchup-flash" : ""}`}
              style={{
                width: 72, padding: "10px 6px",
                // catch-up chips let the flash keyframe drive their background; others are static
                background: c.isToday && c.available ? "#ffb800" : dashed ? undefined : "#0e1611",
                border: `1px ${dashed ? "dashed" : "solid"} ${border}`,
                opacity: dim ? 0.45 : 1,
                outline: isOpen ? "2px solid rgba(174,234,0,0.6)" : "none",
              }}>
              <span className="font-body" style={{ fontSize: 10, letterSpacing: 0.5, color: c.isToday && c.available ? "#5a4500" : "#8a948f" }}>
                {c.isToday ? "TODAY" : p.dow}
              </span>
              <span className="font-display" style={{ fontSize: 22, lineHeight: 1.1, color: c.isToday && c.available ? "#1a1300" : "#fff" }}>{p.day}</span>
              <span className="font-body" style={{ fontSize: 10, color: c.isToday && c.available ? "#5a4500" : "#8a948f" }}>{p.mon}</span>
              <span className="font-display rounded-full px-1.5 mt-1" style={{ fontSize: 9, letterSpacing: 0.3, color: tagColor, background: c.played || (c.isToday && c.available) ? "transparent" : "rgba(255,255,255,0.04)" }}>{tag}</span>
            </button>
          );
        })}
      </div>

      {/* inline stat peek for a played day */}
      {open && open.played && (() => {
        const p = parts(open.date);
        const r = resultLine(open);
        return (
          <div className="mt-2 rounded-2xl p-3" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-display tracking-wide" style={{ fontSize: 14, color: "#fff" }}>{p.dow} {open.date.split("-")[2]} {p.mon}</span>
              <span className="font-body" style={{ fontSize: 12, color: r.color }}>{r.text}</span>
            </div>
            <div className="flex items-center gap-2">
              {open.quizTotal ? (
                <Stat label="🧠 QUIZ" value={`${open.quizCorrect ?? 0}/${open.quizTotal}`} />
              ) : null}
              {open.wdl ? (
                <Stat label="RECORD" value={`${open.wdl.w}-${open.wdl.d}-${open.wdl.l}`} />
              ) : null}
              {open.runId ? (
                <button onClick={() => onViewRun(open.runId!)} className="ml-auto font-display tracking-wide rounded-xl px-3 py-2"
                  style={{ fontSize: 13, color: "#aeea00", background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.4)" }}>
                  View run →
                </button>
              ) : null}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
      <div className="font-body" style={{ fontSize: 9, letterSpacing: 0.5, color: "#8a948f" }}>{label}</div>
      <div className="font-display" style={{ fontSize: 16, color: "#fff" }}>{value}</div>
    </div>
  );
}
