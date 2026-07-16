"use client";

/**
 * Matchweek → Live Quiz → "Your next live quiz".
 *
 * A full-width tile for the ONE fixture that actually earns the viewer points:
 * their own club's next match (own-club scoring rule — see lib/clubs/table.ts).
 * The carousel below shows every upcoming quiz; this pulls out the one that's
 * theirs, so a fan never has to hunt the rail for their own game.
 *
 * Self-hides when we don't know their club, or their club has no upcoming
 * fixture synced — never an empty box.
 */

import { useEffect, useMemo, useState } from "react";
import { useViewerClub } from "@/components/clubs/useClubData";
import { Crest } from "@/components/clubs/Crest";

const TEAL = "#00d8c0";

interface Fixture { home: string; away: string; kickoff: string; state: string }
interface Gameweek { round: string; kickoffFirst: string; fixtures: Fixture[] }

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short" });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

export function NextClubQuiz() {
  const club = useViewerClub();
  const [gws, setGws] = useState<Gameweek[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/halftime/upcoming")
      .then((r) => r.json())
      .then((j) => { if (live) { setGws(j.gameweeks ?? []); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  // The soonest upcoming fixture their club is in. /api/halftime/upcoming already
  // returns gameweeks in kickoff order with fixtures sorted inside, so the first
  // match down the list is the next one.
  const next = useMemo(() => {
    if (!club) return null;
    for (const gw of gws) {
      for (const fx of gw.fixtures) {
        if (fx.home === club || fx.away === club) return { fx, round: gw.round };
      }
    }
    return null;
  }, [club, gws]);

  if (!loaded || !club || !next) return null;

  const { fx, round } = next;
  const opponent = fx.home === club ? fx.away : fx.home;
  const atHome = fx.home === club;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="mb-2.5">
        <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>YOUR NEXT LIVE QUIZ</span>
      </div>

      <div className="rounded-2xl p-4"
        style={{
          background: "linear-gradient(150deg, rgba(0,216,192,0.1), rgba(0,216,192,0.02))",
          border: "1px solid rgba(0,216,192,0.28)",
        }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-body text-[10px] px-2 py-0.5 rounded-full"
            style={{ background: "rgba(0,216,192,0.12)", color: TEAL, border: "1px solid rgba(0,216,192,0.25)" }}>
            GW {round} · {atHome ? "HOME" : "AWAY"}
          </span>
          <span className="font-body text-xs" style={{ color: "#8a948f" }}>{dayLabel(fx.kickoff)}</span>
        </div>

        {/* The fixture, their club first — this tile is read from their side. */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Crest name={club} size={38} />
            <span className="font-display text-lg text-white truncate">{club}</span>
          </div>
          <span className="font-body text-xs flex-shrink-0" style={{ color: "#586058" }}>v</span>
          <div className="flex items-center gap-2.5 min-w-0 justify-end">
            <span className="font-body text-sm truncate" style={{ color: "#c4ccc6" }}>{opponent}</span>
            <Crest name={opponent} size={30} />
          </div>
        </div>

        <div className="mt-3.5 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="font-body text-xs" style={{ color: "#8a948f" }}>
            Drops at half time · {timeLabel(fx.kickoff)} kick-off
          </p>
          <p className="font-body text-xs mt-1" style={{ color: "#586058" }}>
            This is the one that scores for {club} in the fan table.
          </p>
        </div>
      </div>
    </div>
  );
}
