"use client";

/**
 * Matchweek → Live Quiz → the upcoming schedule.
 *
 * The gameweeks ahead and the quizzes that will drop — one per fixture, at that
 * match's real half-time. Lets a user see what's coming (and that there's a quiz
 * for THEIR club's game) before opening night, so Live Quiz isn't empty until
 * the first whistle of the season.
 *
 * The first upcoming gameweek is expanded; later ones collapse to a summary row
 * you tap to open — a full season of fixtures shouldn't be one endless scroll.
 */

import { useEffect, useState } from "react";

const TEAL = "#00d8c0";

interface Fixture { home: string; away: string; kickoff: string; state: string }
interface Gameweek { round: string; kickoffFirst: string; fixtures: Fixture[] }

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

export function GameweekSchedule() {
  const [gws, setGws] = useState<Gameweek[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/halftime/upcoming")
      .then((r) => r.json())
      .then((j) => { if (live) { const g = j.gameweeks ?? []; setGws(g); setOpen(g[0]?.round ?? null); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  if (!loaded || gws.length === 0) return null; // self-hide, like the rail

  return (
    <div className="max-w-lg mx-auto px-4 pt-5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>UPCOMING QUIZZES</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {gws.map((gw) => {
          const isOpen = open === gw.round;
          return (
            <div key={gw.round} className="rounded-2xl overflow-hidden" style={{ background: "#111814", border: "1px solid rgba(255,255,255,0.07)" }}>
              <button
                onClick={() => setOpen(isOpen ? null : gw.round)}
                className="w-full flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-body text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(0,216,192,0.1)", color: TEAL, border: "1px solid rgba(0,216,192,0.25)" }}>
                    GW {gw.round}
                  </span>
                  <span className="font-body text-xs" style={{ color: "#8a948f" }}>
                    {gw.fixtures.length} quizzes · from {dayLabel(gw.kickoffFirst)}
                  </span>
                </div>
                <span className="font-body text-sm" style={{ color: "#586058" }}>{isOpen ? "–" : "+"}</span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 flex flex-col gap-1.5">
                  {gw.fixtures.map((fx, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                      style={{ background: "rgba(255,255,255,0.03)" }}>
                      <div className="font-body text-sm text-white">
                        {fx.home} <span style={{ color: "#586058" }}>v</span> {fx.away}
                      </div>
                      <div className="text-right">
                        <div className="font-body text-xs" style={{ color: "#8a948f" }}>{dayLabel(fx.kickoff)}</div>
                        <div className="font-body text-xs" style={{ color: "#586058" }}>HT quiz · {timeLabel(fx.kickoff)} KO</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="font-body text-xs mt-2.5 px-1" style={{ color: "#586058" }}>
        A quiz drops at each match&apos;s real half-time. Play solo or against friends.
      </p>
    </div>
  );
}
