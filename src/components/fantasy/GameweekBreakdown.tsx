"use client";

import { useState, type CSSProperties } from "react";
import {
  Btn, Card, Crest, extrasLine, GOLD, INK, LINE, MUTED, TEAL, tint,
  type ClientPoolPlayer, type FantasyState,
} from "@/components/fantasy/shared";

type Result = NonNullable<NonNullable<FantasyState["entry"]>["result"]>;

/**
 * The point-driver table — the shared heart of the Live and Final screens,
 * lifted out of the FantasyHub monolith so each of those views lives in a file
 * you can hold in your head. Columns (MIN/G/A/CS/PTS) so you can scan WHY a
 * player scored, not just what. Teal while provisional, gold once settled.
 *
 * Pure presentation: the caller owns the data and the share/advance actions.
 */
export function GameweekBreakdown({
  result, isLive, hits, pool, nameOf, busy, notice, onShare, advance,
}: {
  result: Result;
  isLive: boolean;
  hits: number;
  pool: Map<number, ClientPoolPlayer>;
  nameOf: (id: number) => string;
  busy: boolean;
  notice: string | null;
  onShare: () => void;
  /** Demo/replay only — step to the next gameweek. */
  advance?: { label: string; onClick: () => void };
}) {
  const [fullSheet, setFullSheet] = useState(false);
  const scorers = result.breakdown.filter((b) => b.points !== 0);
  const shownRows = fullSheet ? result.breakdown : [...scorers].sort((a, b) => b.points - a.points);
  const reportedSet = new Set(result.reported ?? []);
  const toCome = result.breakdown.filter((r) => !reportedSet.has(r.id)).length;

  return (
    <Card style={{ marginBottom: 12, border: `1px solid ${isLive ? tint(TEAL, "44") : GOLD}` }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.1em", color: isLive ? TEAL : GOLD, fontWeight: 700 }}>
          {isLive ? "WHERE THE POINTS ARE COMING FROM" : "WHERE THE POINTS CAME FROM"}
        </div>
        <button onClick={() => setFullSheet((v) => !v)} className="font-body"
          style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
          {fullSheet ? "Show less" : "Show all 11"}
        </button>
      </div>
      <p style={{ fontSize: 12, color: MUTED, margin: "4px 0 10px" }}>
        {fullSheet
          ? isLive ? "Every starter, including the ones still to play." : "Every starter, including the ones who didn't play."
          : isLive
            ? `${scorers.length} of your 11 on the board${toCome ? `, ${toCome} still to play` : ""}.`
            : `${scorers.length} of your 11 scored.`}{hits > 0
          ? ` Includes −${hits * 4} for ${hits} extra transfer${hits === 1 ? "" : "s"}.`
          : ""}
      </p>
      <div style={{ overflowX: "auto", margin: "0 -4px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED }}>
              <th style={{ textAlign: "left", padding: "0 4px 6px", fontWeight: 600 }}>PLAYER</th>
              {(["MIN", "G", "A", "CS"] as const).map((h) => (
                <th key={h} style={{ textAlign: "center", padding: "0 4px 6px", fontWeight: 600 }}>{h}</th>
              ))}
              <th style={{ textAlign: "right", padding: "0 4px 6px", fontWeight: 600 }}>PTS</th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((b) => {
              const p = pool.get(b.id);
              const pos = p?.pos ?? "MID";
              const f = b.facts;
              const played = !!f && f.minutes > 0;
              const extras = extrasLine(pos, f);
              const csEligible = pos === "GK" || pos === "DEF" || pos === "MID";
              const cell: CSSProperties = {
                textAlign: "center", padding: "7px 4px", borderTop: `1px solid ${LINE}`,
                color: played ? INK : MUTED, fontVariantNumeric: "tabular-nums",
              };
              return (
                <tr key={b.id}>
                  <td style={{ padding: "7px 4px", borderTop: `1px solid ${LINE}`, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {p && <Crest club={p.club} size={16} />}
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {nameOf(b.id)}
                        {b.captain && <span style={{ color: GOLD }} title="Captain, points doubled"> ©</span>}
                        {b.subbedIn && <span style={{ color: GOLD }} title="Auto-subbed on"> ↑</span>}
                      </span>
                    </span>
                    {(extras || !played) && (
                      <span style={{
                        display: "block", fontSize: 11, marginTop: 2, paddingLeft: 22,
                        color: !played && !reportedSet.has(b.id) ? TEAL : MUTED,
                      }}>
                        {played ? extras : reportedSet.has(b.id) ? "Didn't play" : "Still to play"}
                      </span>
                    )}
                  </td>
                  <td style={cell}>{played ? f!.minutes : "–"}</td>
                  <td style={{ ...cell, color: played && f!.goals ? GOLD : cell.color, fontWeight: played && f!.goals ? 700 : 400 }}>
                    {played ? (f!.goals || "–") : "–"}
                  </td>
                  <td style={{ ...cell, color: played && f!.assists ? GOLD : cell.color, fontWeight: played && f!.assists ? 700 : 400 }}>
                    {played ? (f!.assists || "–") : "–"}
                  </td>
                  <td style={cell}>{played && csEligible ? (f!.cleanSheet ? "✓" : "–") : "–"}</td>
                  <td style={{
                    textAlign: "right", padding: "7px 4px", borderTop: `1px solid ${LINE}`,
                    fontWeight: 700, fontVariantNumeric: "tabular-nums", color: b.points >= 10 ? GOLD : INK,
                  }}>{b.points}</td>
                </tr>
              );
            })}
            {hits > 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "7px 4px", borderTop: `1px solid ${LINE}`, color: "#E08A6B", fontSize: 12.5 }}>
                  {hits} extra transfer{hits === 1 ? "" : "s"}
                </td>
                <td style={{ textAlign: "right", padding: "7px 4px", borderTop: `1px solid ${LINE}`, color: "#E08A6B", fontWeight: 700 }}>
                  −{hits * 4}
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={5} style={{ padding: "9px 4px", borderTop: `1.5px solid ${isLive ? TEAL : GOLD}`, fontWeight: 700 }}>
                {isLive ? "So far" : "Total"}
              </td>
              <td style={{
                textAlign: "right", padding: "9px 4px", fontWeight: 700,
                borderTop: `1.5px solid ${isLive ? TEAL : GOLD}`, color: isLive ? TEAL : GOLD,
              }}>
                {result.points}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {notice && <p style={{ fontSize: 12.5, color: GOLD, margin: "10px 0 0" }}>{notice}</p>}
      {/* No share or advance while the football is still on: a shared "I got 34"
          that becomes 41 an hour later is worse than no share, and advance 403s
          in a live season anyway. */}
      {!isLive && (
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <Btn disabled={busy} onClick={onShare}>Share this gameweek</Btn>
          {advance && (
            <Btn gold disabled={busy} onClick={advance.onClick}>{busy ? "…" : advance.label}</Btn>
          )}
        </div>
      )}
    </Card>
  );
}
