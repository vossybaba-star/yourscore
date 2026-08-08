"use client";
/** The Table screen — Season and This-month, with a title-race summary above the
 *  full table. Tapping a member opens the shared MemberActionSheet (Phase 1B),
 *  their completed round rendered inside it as the stats section. */
import { useState } from "react";
import { Card, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { LeagueTableRows } from "./LeagueTableRows";
import { MemberActionSheet, type MemberActionMember } from "@/components/fantasy/MemberActionSheet";
import { useUser } from "@/hooks/useUser";
import type { LeagueDetail, LeagueRow } from "./types";
import { nameOf } from "./types";

export function LeagueTableView({ detail, code }: { detail: LeagueDetail; code: string }) {
  const { user } = useUser();
  const [tab, setTab] = useState<"season" | "month">("season");
  const [selected, setSelected] = useState<MemberActionMember | null>(null);

  const { season, month, lastMonth, league } = detail;
  const rows = tab === "season" ? season : month.rows;
  const scored = rows.some((r) => r.played > 0);
  const leader = rows[0] ?? null;
  const you = rows.find((r) => r.isMe) ?? null;
  const gap = you && leader && !you.isMe ? leader.points - you.points : null;

  const openMember = (r: LeagueRow) => {
    if (!league.isMember) return;
    setSelected({ userId: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl, rank: r.rank, points: r.played ? r.points : undefined });
  };

  return (
    <div>
      {/* Members button removed (founder 8 Aug) — the full member list lives on
          the Hub's MEMBERS preview. */}
      {/* Season / This month */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["season", "month"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "9px 4px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: tab === t ? tint(TEAL, "22") : PANEL, color: tab === t ? TEAL : MUTED,
            border: `1px solid ${tab === t ? tint(TEAL, "66") : LINE}`,
          }}>{t === "season" ? "Season" : "This month"}</button>
        ))}
      </div>

      {/* Summary card */}
      {tab === "season" ? (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>TITLE RACE</div>
          {scored && leader ? (
            <>
              <div style={{ fontSize: 14, color: INK }}>
                <b style={{ color: GOLD }}>{nameOf(leader)}</b> leads on <b>{leader.points}</b> pts.
              </div>
              {you && gap !== null && (
                <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
                  You&apos;re {ordinal(you.rank)}{gap === 0 ? ", level with the leader." : `, ${gap} pts behind.`}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>No scores yet. The season table builds gameweek by gameweek.</div>
          )}
        </Card>
      ) : (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: GOLD, marginBottom: 6 }}>{month.label.toUpperCase()} COMPETITION</div>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            Every gameweek in {month.label} feeds one table. It resets next month.
          </p>
          {lastMonth && (
            <p style={{ fontSize: 12.5, color: MUTED, margin: "8px 0 0" }}>
              {lastMonth.label} winner: <b style={{ color: GOLD }}>{nameOf(lastMonth.winner)}</b> · {lastMonth.winner.points} pts
            </p>
          )}
        </Card>
      )}

      <LeagueTableRows rows={rows} onPeek={league.isMember ? openMember : undefined}
        emptyLabel={tab === "month" ? "No scores this month yet." : "No members yet."} />

      {selected && (
        <MemberActionSheet
          member={selected}
          context="league"
          leagueCode={code}
          viewerId={user?.id ?? null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
