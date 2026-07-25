"use client";

/**
 * Home dashboard spotlight for the live Gameday pack. Mirrors the
 * Dashboard.tsx "RESUME YOUR RUN" wcRun banner (same shape/classes) so it
 * reads as part of the same takeover-priority-CTA family, not a bolt-on.
 *
 * Self-fetching (useGamedayToday) so mounting this needed zero changes to
 * the server-built DashboardData contract — see Dashboard.tsx.
 *
 * Every row from /api/gameday/today is already published and playable — the
 * pivot's whole point is that there is no more "kicks off at X, drops at
 * half time" pending state to render here (§0.1). Never claim live-match
 * play-along (CLAUDE.md locked rule): the copy names the fixture and its
 * kickoff time, nothing more.
 */

import Link from "next/link";
import { useGamedayToday, kickoffLabel, packHref, type GamedayFixture } from "@/components/halftime/useGamedayToday";

const TEAL = "#00d8c0";

/** Soonest kickoff first — the pack most urgent to play before its fixture. */
function pickFixture(fixtures: GamedayFixture[]): GamedayFixture | null {
  if (fixtures.length === 0) return null;
  return [...fixtures].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))[0];
}

export function GamedayCard() {
  const { fixtures, loaded } = useGamedayToday();
  if (!loaded) return null;

  const f = pickFixture(fixtures);
  if (!f) return null;

  const href = packHref(f) ?? "/matchweek";

  return (
    <Link
      href={href}
      className="d-2 flex items-center justify-between rounded-2xl px-4 py-3.5 transition-transform active:scale-[0.99]"
      style={{ background: "linear-gradient(120deg, rgba(0,216,192,0.16), rgba(0,216,192,0.04))", border: "1px solid rgba(0,216,192,0.4)" }}
    >
      <div className="min-w-0">
        <p className="font-display text-lg text-white leading-none truncate">
          {f.home} v {f.away}
        </p>
        <p className="font-body text-xs mt-1 truncate" style={{ color: TEAL }}>
          Gameday quiz is live · kicks off {kickoffLabel(f.kickoff_at)}
        </p>
      </div>
      <span className="font-display text-xl flex-shrink-0" style={{ color: TEAL }}>→</span>
    </Link>
  );
}
