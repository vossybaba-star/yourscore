"use client";
/** History — the league's permanent per-gameweek memory. A list of completed
 *  gameweeks, each with a recap: winner, your finish, the derived highlights and
 *  the final table snapshot (immutable, recomputed from scored entries). */
import { useEffect, useState } from "react";
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, Sheet } from "@/components/fantasy/shared";
import { LeagueTableRows } from "./LeagueTableRows";
import type { HistoryGw, LeagueHistoryData } from "./types";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function LeagueHistoryView({ code }: { code: string }) {
  const [data, setData] = useState<LeagueHistoryData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<HistoryGw | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load history"))))
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [code]);

  if (err) return <p style={{ fontSize: 13, color: MUTED }}>{err}</p>;
  if (!data) return <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>;

  if (!data.gameweeks.length) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          No completed gameweeks yet. Once a gameweek is scored, it lands here with a recap and a final table
          you can always come back to.
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.gameweeks.map((g) => (
        <button key={g.gw} onClick={() => setOpen(g)} style={{
          textAlign: "left", cursor: "pointer", width: "100%",
          background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 13,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="font-display" style={{ fontSize: 13, fontWeight: 700, color: INK }}>Gameweek {g.gw}</span>
            <span style={{ fontSize: 10.5, letterSpacing: "0.1em", color: MUTED }}>COMPLETED</span>
          </div>
          {g.winner && (
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 5, lineHeight: 1.45 }}>
              <b style={{ color: GOLD }}>{g.winner.name}</b> won with {g.winner.points} points.
              {g.yourGwRank != null && g.yourGwPoints != null && (
                <> You finished {ordinal(g.yourGwRank)} with {g.yourGwPoints}.</>
              )}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "#43d6c0", marginTop: 6, fontWeight: 700 }}>View recap →</div>
        </button>
      ))}

      {open && (
        <Sheet onClose={() => setOpen(null)} labelledBy="recap-title">
          {/* Hero — gold for finality. */}
          <div style={{
            borderRadius: 14, padding: 16, marginBottom: 12,
            background: `linear-gradient(150deg, rgba(255,194,51,0.16), rgba(255,194,51,0.03))`,
            border: `1px solid rgba(255,194,51,0.4)`,
          }}>
            <div id="recap-title" className="font-display" style={{ fontSize: 11, letterSpacing: "0.14em", color: GOLD }}>GW{open.gw} RECAP</div>
            {open.winner && (
              <>
                <div className="font-display text-white" style={{ fontSize: 26, marginTop: 6, lineHeight: 1 }}>{open.winner.name}</div>
                <div style={{ fontSize: 14, color: GOLD, fontWeight: 700, marginTop: 3 }}>{open.winner.points} points</div>
              </>
            )}
          </div>

          {open.highlights.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
              {open.highlights.map((h, i) => (
                <div key={i} style={{ display: "flex", gap: 9, fontSize: 12.5, color: INK, lineHeight: 1.45 }}>
                  <span>{h.emoji}</span><span>{h.text}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>FINAL TABLE AFTER GW{open.gw}</div>
          <LeagueTableRows rows={open.table} showLastGw={false} />

          <div style={{ marginTop: 14 }}><Btn onClick={() => setOpen(null)}>Close</Btn></div>
        </Sheet>
      )}
    </div>
  );
}
