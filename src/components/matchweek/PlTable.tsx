"use client";

/**
 * Matchweek → PL → Table. The live Premier League table from /api/pl/standings
 * (SportMonks, edge-cached 5 min). Pre-season the standings come back empty —
 * nothing has been played — so the tab says so rather than showing a blank grid.
 */

import { useEffect, useState } from "react";
import { Crest } from "@/components/clubs/Crest";

interface Row {
  position: number;
  team: string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalDifference: number;
  points: number;
}

export function PlTable() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/pl/standings")
      .then((r) => r.json())
      .then((d) => { if (live) { setRows(d.standings ?? []); setError(Boolean(d.error)); } })
      .catch(() => { if (live) { setRows([]); setError(true); } });
    return () => { live = false; };
  }, []);

  if (rows === null) return null;

  if (rows.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4">
        <div className="rounded-2xl p-6 bg-surface text-center" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="font-display text-sm text-white mb-1">
            {error ? "Table unavailable" : "The table starts on opening day"}
          </p>
          <p className="font-body text-xs" style={{ color: "#8a948f" }}>
            {error ? "Couldn't load the standings — try again shortly." : "Once the season kicks off, the Premier League table lives here."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <span className="w-5 flex-shrink-0" />
          <span className="flex-1 font-display text-[10px] tracking-widest" style={{ color: "#586058" }}>CLUB</span>
          <Cols />
        </div>
        {rows.map((r) => (
          <div key={r.position + r.team} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <span className="w-5 flex-shrink-0 font-display text-sm text-right" style={{ color: "#8a948f" }}>{r.position}</span>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <Crest name={r.team} size={22} />
              <span className="font-body text-sm text-white truncate">{r.team}</span>
            </div>
            <Cols played={r.played} gd={r.goalDifference} pts={r.points} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The three numeric columns (P · GD · Pts), header when values omitted. */
function Cols({ played, gd, pts }: { played?: number; gd?: number; pts?: number } = {}) {
  const header = played === undefined;
  const cell = (v: string, bold = false) => (
    <span
      className={`w-8 text-right ${bold ? "font-display text-sm text-white" : "font-body text-xs"}`}
      style={bold ? undefined : { color: header ? "#586058" : "#8a948f" }}
    >
      {v}
    </span>
  );
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {cell(header ? "P" : String(played))}
      {cell(header ? "GD" : (gd! > 0 ? `+${gd}` : String(gd)))}
      {header ? cell("PTS") : cell(String(pts), true)}
    </div>
  );
}
