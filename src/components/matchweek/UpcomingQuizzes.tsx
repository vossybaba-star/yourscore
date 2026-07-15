"use client";

/**
 * Matchweek → Live Quiz → the upcoming quizzes, as a horizontal carousel
 * (the format the halftime rail used) — one card per fixture, each a quiz that
 * drops at that match's real half-time.
 *
 * Shows the soonest gameweek's fixtures as swipeable cards, with chips to flick
 * between the gameweeks ahead. A full season shouldn't be one endless scroll;
 * a carousel keeps "what's next" glanceable.
 */

import { useEffect, useMemo, useState } from "react";
import { Crest } from "@/components/clubs/Crest";

const TEAL = "#00d8c0";

interface Fixture { home: string; away: string; kickoff: string; state: string }
interface Gameweek { round: string; kickoffFirst: string; fixtures: Fixture[] }

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

export function UpcomingQuizzes() {
  const [gws, setGws] = useState<Gameweek[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/halftime/upcoming")
      .then((r) => r.json())
      .then((j) => { if (live) { const g = j.gameweeks ?? []; setGws(g); setActive(g[0]?.round ?? null); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  const current = useMemo(() => gws.find((g) => g.round === active) ?? gws[0], [gws, active]);
  if (!loaded || gws.length === 0 || !current) return null; // self-hide, like the rail

  return (
    <div className="pt-5">
      <div className="max-w-lg mx-auto px-4 flex items-center justify-between mb-2.5">
        <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>UPCOMING QUIZZES</span>
        <span className="font-body text-xs" style={{ color: "#8a948f" }}>{current.fixtures.length} this gameweek</span>
      </div>

      {/* Gameweek switcher */}
      {gws.length > 1 && (
        <div className="max-w-lg mx-auto px-4 mb-3">
          <div className="flex gap-1.5 overflow-x-auto" style={{ paddingBottom: 2 }}>
            {gws.map((g) => {
              const on = g.round === current.round;
              return (
                <button key={g.round} onClick={() => setActive(g.round)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full font-body text-xs transition-colors"
                  style={{
                    background: on ? TEAL : "rgba(255,255,255,0.04)",
                    color: on ? "#062018" : "#8a948f",
                    border: `1px solid ${on ? TEAL : "rgba(255,255,255,0.08)"}`,
                    fontWeight: on ? 700 : 500,
                  }}>
                  GW {g.round}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The carousel */}
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
        <style>{`.hq-rail::-webkit-scrollbar{display:none}`}</style>
        {current.fixtures.map((fx, i) => (
          <div key={i}
            className="flex-shrink-0 snap-start rounded-2xl p-4 flex flex-col justify-between"
            style={{
              width: 210, minHeight: 150,
              background: "linear-gradient(150deg, rgba(0,216,192,0.08), rgba(0,216,192,0.02))",
              border: "1px solid rgba(0,216,192,0.2)",
            }}>
            <div className="flex items-center justify-between">
              <span className="font-body text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "rgba(0,216,192,0.12)", color: TEAL, border: "1px solid rgba(0,216,192,0.25)" }}>
                HT QUIZ
              </span>
              <span className="font-body text-[11px]" style={{ color: "#8a948f" }}>{dayLabel(fx.kickoff)}</span>
            </div>

            <div className="flex flex-col gap-2 py-2">
              <div className="flex items-center gap-2">
                <Crest name={fx.home} size={22} />
                <span className="font-body text-sm text-white truncate">{fx.home}</span>
              </div>
              <div className="flex items-center gap-2">
                <Crest name={fx.away} size={22} />
                <span className="font-body text-sm text-white truncate">{fx.away}</span>
              </div>
            </div>

            <span className="font-body text-[11px]" style={{ color: "#586058" }}>
              Drops at half-time · {timeLabel(fx.kickoff)} KO
            </span>
          </div>
        ))}
      </div>

      <p className="max-w-lg mx-auto px-4 font-body text-xs mt-2" style={{ color: "#586058" }}>
        A quiz drops at each match&apos;s real half-time. Play solo or against friends.
      </p>
    </div>
  );
}
