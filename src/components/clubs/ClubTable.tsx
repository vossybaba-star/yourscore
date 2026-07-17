"use client";

/**
 * Club-Fan Leaderboard gameweek table. Ranked by AVERAGE halftime score per
 * participating fan (LOCKED DECISION #3 — never a raw total, or the big six
 * would just win on fanbase size every week). The 5-fan minimum was dropped
 * (founder, 2026-07-16): ONE player puts a club on the board. A club is only
 * unranked now if nobody played its game at all, and those are listed quietly
 * below — never ranked, because with no players they have no average.
 *
 * Self-hides: no gameweek data at all → renders nothing (mirrors HalftimeRail's
 * self-hide contract — never an empty box).
 */

import { useClubMe, useClubTable } from "./useClubData";
import { Crest } from "./Crest";

const TEAL = "#00d8c0";

export function ClubTable() {
  const { data, loaded } = useClubTable();
  const { data: me } = useClubMe();

  if (!loaded || !data || !data.gw || data.standings.length === 0) return null;

  const ranked = data.standings.filter((s) => s.eligible);
  // Unranked now means one thing only: nobody played this club's game.
  const noPlayers = data.standings.filter((s) => !s.eligible);
  const myClub = me?.club ?? null;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>
          CLUB-FAN LEADERBOARD
        </span>
        <span
          className="font-body text-xs px-2 py-0.5 rounded-full"
          style={{ background: "rgba(0,216,192,0.1)", color: TEAL, border: "1px solid rgba(0,216,192,0.25)" }}
        >
          GW {data.gw}
        </span>
      </div>

      {ranked.length === 0 ? (
        <p className="font-body text-xs px-1 pb-2" style={{ color: "#586058" }}>
          Not enough players yet this gameweek.
        </p>
      ) : (
        <div
          className="rounded-3xl overflow-hidden"
          style={{
            background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
            border: "1px solid rgba(0,216,192,0.18)",
          }}
        >
          {ranked.map((row, i) => {
            const mine = row.club === myClub;
            return (
              <div
                key={row.club}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                  background: mine ? "rgba(0,216,192,0.08)" : "transparent",
                }}
              >
                <span
                  className="font-display text-xs w-5 text-center flex-shrink-0"
                  style={{ color: mine ? TEAL : "#586058" }}
                >
                  {row.rank}
                </span>
                <Crest name={row.club} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-semibold text-white truncate">
                    {row.club}
                    {mine && (
                      <span className="font-body text-[10px] ml-1.5" style={{ color: TEAL }}>
                        YOU
                      </span>
                    )}
                  </p>
                  <p className="font-body text-[11px]" style={{ color: "#8a948f" }}>
                    {row.participants} fans
                  </p>
                </div>
                <span className="font-display text-sm flex-shrink-0" style={{ color: mine ? TEAL : "#c4ccc6" }}>
                  {row.avgScore.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {noPlayers.length > 0 && (
        <p className="font-body text-[11px] mt-2 px-1" style={{ color: "#586058" }}>
          Nobody played this week: {noPlayers.map((r) => r.club).join(", ")}
        </p>
      )}
    </div>
  );
}
