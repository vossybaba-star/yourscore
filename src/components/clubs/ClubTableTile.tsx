"use client";

/**
 * Compact club-fan leaderboard TILE for the Live Quiz screen — the top three,
 * your club if it's not already up there, and a tap through to the full table.
 * The whole table used to sit inline and dominate the screen; a tile teaches the
 * shape (a ranked table of clubs by knowledge) without taking it over.
 *
 * Self-hides on no gameweek data, exactly like the full ClubTable.
 */

import Link from "next/link";
import { useClubMe, useClubTable } from "./useClubData";
import { Crest } from "./Crest";

const TEAL = "#00d8c0";

export function ClubTableTile() {
  const { data, loaded } = useClubTable();
  const { data: me } = useClubMe();

  if (!loaded || !data || !data.gw || data.standings.length === 0) return null;

  const ranked = data.standings.filter((s) => s.eligible);
  if (ranked.length === 0) return null;

  const myClub = me?.club ?? null;
  const top = ranked.slice(0, 3);
  const mineRow = myClub ? ranked.find((r) => r.club === myClub) : null;
  const mineBelow = mineRow && !top.some((r) => r.club === myClub) ? mineRow : null;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <Link href="/matchweek/leaderboard" className="block rounded-3xl overflow-hidden transition-transform active:scale-[0.99]"
        style={{ background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)", border: "1px solid rgba(0,216,192,0.18)" }}>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <div className="flex items-center gap-2">
            <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>CLUB-FAN LEADERBOARD</span>
            <span className="font-body text-[11px] px-2 py-0.5 rounded-full"
              style={{ background: "rgba(0,216,192,0.1)", color: TEAL, border: "1px solid rgba(0,216,192,0.25)" }}>
              GW {data.gw}
            </span>
          </div>
          <span className="font-body text-xs" style={{ color: TEAL }}>See full table →</span>
        </div>

        <div className="pb-2">
          {top.map((row, i) => (
            <Row key={row.club} rank={row.rank ?? 0} club={row.club} fans={row.participants} avg={row.avgScore}
              mine={row.club === myClub} first={i === 0} />
          ))}
          {mineBelow && (
            <>
              <div className="px-4 py-1 font-body text-[10px]" style={{ color: "#3d453f" }}>· · ·</div>
              <Row rank={mineBelow.rank ?? 0} club={mineBelow.club} fans={mineBelow.participants} avg={mineBelow.avgScore} mine first={false} />
            </>
          )}
        </div>
      </Link>
    </div>
  );
}

function Row({ rank, club, fans, avg, mine, first }: { rank: number; club: string; fans: number; avg: number; mine: boolean; first: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2"
      style={{ borderTop: first ? "none" : "1px solid rgba(255,255,255,0.06)", background: mine ? "rgba(0,216,192,0.08)" : "transparent" }}>
      <span className="font-display text-xs w-5 text-center flex-shrink-0" style={{ color: mine ? TEAL : "#586058" }}>{rank}</span>
      <Crest name={club} size={26} />
      <div className="min-w-0 flex-1">
        <p className="font-body text-sm font-semibold text-white truncate">
          {club}{mine && <span className="font-body text-[10px] ml-1.5" style={{ color: TEAL }}>YOU</span>}
        </p>
        <p className="font-body text-[11px]" style={{ color: "#8a948f" }}>{fans} fans</p>
      </div>
      <span className="font-display text-sm flex-shrink-0" style={{ color: mine ? TEAL : "#c4ccc6" }}>{avg.toFixed(1)}</span>
    </div>
  );
}
