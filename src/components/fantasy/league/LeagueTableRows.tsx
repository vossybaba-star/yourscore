"use client";
/** The league table row list — one renderer reused by the Hub mini-table, the
 *  Table screen and a History snapshot. The current user is highlighted in TEAL
 *  (gold is reserved for stakes, competition and final results). */
import { INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import type { LeagueRow } from "./types";
import { nameOf } from "./types";

/** The rank arrow. Null (no prior gameweek) shows nothing; a held place gets a
 *  quiet dash so the column doesn't jump as rows gain and lose arrows. */
export function Movement({ m }: { m: number | null }) {
  if (m === null) return null;
  if (m === 0) return <span aria-label="held position" style={{ fontSize: 9, color: "#4b534e" }}>▬</span>;
  const up = m > 0;
  return (
    <span aria-label={`${up ? "up" : "down"} ${Math.abs(m)}`}
      style={{ fontSize: 9, color: up ? "#5fce8f" : "#E08A6B", display: "inline-flex", alignItems: "center", gap: 1 }}>
      {up ? "▲" : "▼"}{Math.abs(m) > 1 ? <span style={{ fontSize: 9, fontVariantNumeric: "tabular-nums" }}>{Math.abs(m)}</span> : null}
    </span>
  );
}

export function LeagueTableRows({
  rows, onPeek, showLastGw = true, emptyLabel = "No members yet.",
}: {
  rows: LeagueRow[];
  onPeek?: (r: LeagueRow) => void;
  /** The "+N last GW" sub-line — off in History snapshots where it's noise. */
  showLastGw?: boolean;
  emptyLabel?: string;
}) {
  if (!rows.length) return <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{emptyLabel}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.userId} onClick={() => onPeek?.(r)} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10,
          background: r.isMe ? tint(TEAL, "16") : PANEL, border: `1px solid ${r.isMe ? tint(TEAL, "66") : LINE}`,
          cursor: onPeek ? "pointer" : "default",
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3, width: 34, flexShrink: 0, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: r.rank === 1 ? "#ffc233" : MUTED, fontVariantNumeric: "tabular-nums" }}>{r.rank}</span>
            <Movement m={r.movement} />
          </span>
          <PlayerAvatar seed={r.userId} name={nameOf(r)} avatarUrl={r.avatarUrl} size={30} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {nameOf(r)}{r.isMe ? <span style={{ color: TEAL, fontWeight: 700 }}> · you</span> : ""}
          </span>
          <span style={{ textAlign: "right", flexShrink: 0 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: r.played === 0 ? MUTED : INK }}>
              {r.played === 0 ? "0" : `${r.points} pts`}
            </span>
            {showLastGw && r.lastGwPoints !== null && (
              <span style={{ display: "block", fontSize: 10.5, color: MUTED, marginTop: 1 }}>+{r.lastGwPoints} last GW</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
