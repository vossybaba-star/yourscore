"use client";

/**
 * Matchweek → PL → Table. The live Premier League table from /api/pl/standings
 * (SportMonks, edge-cached 5 min).
 *
 * ORDER (founder, 2026-07-16): alphabetical BEFORE a ball is kicked, by position
 * once the season starts. SportMonks' pre-season "order" is really just row ids
 * — it had Sunderland 1st and Spurs 2nd — which reads as a table that's already
 * wrong. Alphabetical is the honest pre-season view. Locking it to alphabetical
 * all season would be the opposite bug, so it flips the moment anyone has played.
 *
 * Pre-season the position column shows "–" rather than 1–20: nobody has a
 * position yet, and numbering an alphabetical list invents one.
 *
 * Columns are the classic table — P W D L GD Pts — the same set the official PL
 * app shows on a phone. GF/GA do come back from SportMonks (goalsFor /
 * goalsAgainst) and are deliberately left out: eight numeric columns don't fit
 * 375px without a horizontal scroller, and GD is the one people read.
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

  // Has anyone actually played? That, not the calendar, decides the order.
  const started = rows.some((r) => r.played > 0);
  const ordered = started
    ? [...rows].sort((a, b) => a.position - b.position)
    : [...rows].sort((a, b) => a.team.localeCompare(b.team));

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      {!started && (
        <p className="font-body text-xs mb-2 px-1" style={{ color: "#586058" }}>
          Nothing played yet — listed A–Z until the first whistle.
        </p>
      )}
      <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <span className="w-4 flex-shrink-0" />
          <span className="flex-1 font-display text-[10px] tracking-widest min-w-0" style={{ color: "#586058" }}>CLUB</span>
          <Cols />
        </div>
        {ordered.map((r) => (
          <div key={r.team} className="flex items-center gap-2 px-3 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <span className="w-4 flex-shrink-0 font-display text-xs text-right" style={{ color: "#8a948f" }}>
              {started ? r.position : "–"}
            </span>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <Crest name={r.team} size={20} />
              <span className="font-body text-[13px] text-white truncate">{r.team}</span>
            </div>
            <Cols row={r} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** P · W · D · L · GD · Pts — header when no row is given. */
function Cols({ row }: { row?: Row }) {
  const header = !row;
  const cell = (v: string, key: string, bold = false) => (
    <span
      key={key}
      className={`w-[26px] text-right ${bold ? "font-display text-[13px] text-white" : "font-body text-[11px]"}`}
      style={bold ? undefined : { color: header ? "#586058" : "#8a948f" }}
    >
      {v}
    </span>
  );
  if (header) {
    return (
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {cell("P", "p")}{cell("W", "w")}{cell("D", "d")}{cell("L", "l")}{cell("GD", "gd")}{cell("PTS", "pts")}
      </div>
    );
  }
  const gd = row.goalDifference > 0 ? `+${row.goalDifference}` : String(row.goalDifference);
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      {cell(String(row.played), "p")}
      {cell(String(row.won), "w")}
      {cell(String(row.draw), "d")}
      {cell(String(row.lost), "l")}
      {cell(gd, "gd")}
      {cell(String(row.points), "pts", true)}
    </div>
  );
}
