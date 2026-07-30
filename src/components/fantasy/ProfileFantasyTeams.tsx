"use client";
/**
 * A profile's fantasy squads, one gameweek at a time — tap a gameweek chip to see
 * the XI that was picked, captain and vice marked. "This week" is the live team
 * (public on submit, per the founder's call); numbered chips are the locked
 * snapshots. Points show once a gameweek is scored.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import type { BoardPlayer } from "@/lib/fantasy/board";
import type { WeeklyTeam } from "@/lib/fantasy/profileTeams";

const TEAL = "#00d8c0";
const GOLD = "#ffc233";
const MUTED = "#8a948f";

export function ProfileFantasyTeams({ teams, players }: {
  teams: WeeklyTeam[];
  players: BoardPlayer[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState(0);
  const team = teams[sel] ?? teams[0];
  const byId = new Map(players.map((p) => [p.id, p]));
  const capName = team.captain != null ? byId.get(team.captain)?.name ?? null : null;

  return (
    <div>
      <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Fantasy XI by gameweek</p>

      {/* Gameweek chips — "This week" first when the live team is showing. */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {teams.map((t, i) => {
          const active = i === sel;
          return (
            <button key={i} onClick={() => setSel(i)} style={{
              flexShrink: 0, padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
              cursor: "pointer", whiteSpace: "nowrap",
              background: active ? TEAL : "rgba(255,255,255,0.05)",
              color: active ? "#04231f" : "#c7d0cb",
              border: `1px solid ${active ? TEAL : "rgba(255,255,255,0.08)"}`,
            }}>
              {t.current ? "This week" : t.label}
            </button>
          );
        })}
      </div>

      {/* Header: which week, captain, and the gameweek total once scored. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "#e7efe9", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {team.current ? `This week · GW${team.gw}` : `Gameweek ${team.gw}`}
          {capName && <span style={{ color: MUTED }}> · (C) {capName}</span>}
        </span>
        {team.points != null && (
          <span style={{ fontSize: 13, fontWeight: 700, color: GOLD, flexShrink: 0 }}>{team.points} pts</span>
        )}
      </div>

      {/* Tap any player to open their profile as a real route, so back returns
          here to the squad (and on again to the feed). */}
      <SquadBoard
        mode="complete"
        players={players}
        xi={team.xi}
        bench={team.bench}
        captain={team.captain ?? undefined}
        vice={team.vice ?? undefined}
        onSlot={(id) => router.push(`/fantasy/players/${id}`)}
      />
      <p className="font-body" style={{ fontSize: 11.5, color: MUTED, marginTop: 8, textAlign: "center" }}>
        Tap a player to see their profile.
      </p>
    </div>
  );
}
