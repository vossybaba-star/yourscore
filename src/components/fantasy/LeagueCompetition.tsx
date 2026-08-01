"use client";
/**
 * The "Competition" subtab of the Leagues tab — the YourScore-wide comp, the thing
 * a manager should care about first. The MONTHLY table is the hero (this month's
 * prize is what's live), with the season-long table beneath it as the long game.
 * Private friends' leagues live in the sibling "My Leagues" subtab (founder, 31 Jul).
 *
 * Reads the same standings API the old single table did, but fetches month AND
 * season together so both are on one screen, month first.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import type { GlobalStandings as Standings, StandingRow } from "@/lib/fantasy/standings";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Days left in the named calendar month — the monthly comp runs to month end, so
 *  this is the countdown on the prize. Client-only (browser Date). Null if the
 *  label isn't a plain month name. */
function daysLeftInMonth(monthName: string): number | null {
  const idx = MONTHS.indexOf(monthName.trim());
  if (idx < 0) return null;
  const now = new Date();
  // The comp month is the current or the coming one; end = last instant of it.
  const year = now.getFullYear() + (idx < now.getMonth() ? 1 : 0);
  const end = new Date(year, idx + 1, 0, 23, 59, 59);
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}
const nextMonthName = (monthName: string) => {
  const idx = MONTHS.indexOf(monthName.trim());
  return idx < 0 ? "next month" : MONTHS[(idx + 1) % 12];
};

function Row({ r }: { r: StandingRow }) {
  return (
    <Link href={`/profile/${r.userId}`} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10,
      textDecoration: "none", color: INK,
      background: r.isMe ? tint(TEAL, "18") : PANEL,
      border: `1px solid ${r.isMe ? tint(TEAL, "66") : LINE}`,
    }}>
      <span style={{ width: 26, textAlign: "center", fontWeight: 800, fontSize: 13.5, color: r.rank <= 3 ? GOLD : MUTED, flexShrink: 0 }}>{r.rank}</span>
      <PlayerAvatar name={r.name} avatarUrl={r.avatarUrl} size={30} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {r.name}{r.isMe && <span style={{ color: TEAL, fontWeight: 700 }}> · you</span>}
      </span>
      <span style={{ fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{r.points.toLocaleString()}</span>
    </Link>
  );
}

function Table({ data, loading, empty }: { data: Standings | null; loading: boolean; empty: string }) {
  if (loading) return <p style={{ fontSize: 13, color: MUTED, margin: "4px 0" }}>Loading…</p>;
  if (!data) return <p style={{ fontSize: 13, color: MUTED, margin: "4px 0" }}>Couldn&apos;t load the table.</p>;
  if (!data.rows.length) return <p style={{ fontSize: 13, color: MUTED, margin: "4px 0", lineHeight: 1.5 }}>{empty}</p>;
  const youBelowTop = data.you && !data.rows.some((r) => r.isMe);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.rows.map((r) => <Row key={r.userId} r={r} />)}
      {youBelowTop && data.you && (
        <>
          <div style={{ textAlign: "center", color: MUTED, fontSize: 16, lineHeight: 1, margin: "1px 0" }}>⋯</div>
          <Row r={data.you} />
        </>
      )}
    </div>
  );
}

const PODIUM_RING = ["#ffd700", "#c9d1d3", "#cd7f32"]; // gold, silver, bronze

export function LeagueCompetition() {
  const [month, setMonth] = useState<Standings | null>(null);
  const [season, setSeason] = useState<Standings | null>(null);
  const [loading, setLoading] = useState(true);
  // The two tables are a subtab under the hero (month first), not one stacked
  // under the other — the month and the season are different competitions, not a
  // long scroll (founder, 1 Aug).
  const [view, setView] = useState<"month" | "season">("month");

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/fantasy/standings?scope=month").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/fantasy/standings?scope=season").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([m, s]) => { if (live) { setMonth(m); setSeason(s); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const monthLabel = month?.title ?? "This month";
  const running = !!month && month.rows.length > 0;
  const left = running ? daysLeftInMonth(monthLabel) : null;
  const podium = month?.rows.slice(0, 3) ?? [];

  return (
    <div>
      {/* HERO — the monthly comp, the thing to care about now. Gold = a prize. */}
      <div style={{
        borderRadius: 16, padding: 18, marginBottom: 14, position: "relative", overflow: "hidden",
        background: `linear-gradient(140deg, ${tint(GOLD, "26")}, ${tint(GOLD, "05")})`,
        border: `1px solid ${tint(GOLD, "55")}`,
      }}>
        <div className="font-display" style={{
          fontSize: 10.5, letterSpacing: "0.16em", color: GOLD, marginBottom: 7,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>MONTHLY COMPETITION</span>
          {running && left != null && <span>{left} day{left === 1 ? "" : "s"} left</span>}
        </div>
        <div className="font-display text-white" style={{ fontSize: 34, lineHeight: 0.95, letterSpacing: "-0.01em", textTransform: "uppercase" }}>
          {monthLabel}
        </div>
        <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "10px 0 0", lineHeight: 1.55, maxWidth: "94%" }}>
          {running
            ? `Every gameweek this month feeds one table. Finish top of ${monthLabel} to win the month. It resets in ${nextMonthName(monthLabel)}, so a slow start never buries your season.`
            : `Finish top of ${monthLabel} to win the month. The table fills once the first gameweek scores, and it resets in ${nextMonthName(monthLabel)}, so every month is a fresh shot at the prize.`}
        </p>

        {/* Your standing + the podium, once the month is actually scoring. */}
        {running && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            {month?.you && (
              <div style={{ background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "55")}`, borderRadius: 12, padding: "8px 14px", flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: TEAL, lineHeight: 1 }}>#{month.you.rank}</div>
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>you · {month.totalPlayers.toLocaleString()} playing</div>
              </div>
            )}
            {podium.length > 0 && (
              <div style={{ display: "flex", gap: 8 }}>
                {podium.map((r, i) => (
                  <div key={r.userId} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 52 }}>
                    <PlayerAvatar name={r.name} avatarUrl={r.avatarUrl} size={38} ring={PODIUM_RING[i]} />
                    <span style={{ fontSize: 10, color: INK, fontWeight: 700, maxWidth: 52, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                    <span style={{ fontSize: 10, color: GOLD, fontWeight: 800 }}>{r.points.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Link href="/fantasy/rules" className="font-body" style={{
          display: "inline-block", marginTop: 14, background: GOLD, color: "#1a1204", textDecoration: "none",
          borderRadius: 999, padding: "9px 18px", fontSize: 13, fontWeight: 700,
        }}>How it works</Link>
      </div>

      {/* Month / Season subtab — one table at a time. The month is the prize
          that's live; the season is the long game. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {([["month", monthLabel], ["season", "Season"]] as ["month" | "season", string][]).map(([k, label]) => {
          const active = view === k;
          return (
            <button key={k} onClick={() => setView(k)} style={{
              flex: 1, padding: "9px 4px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : MUTED,
              border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
            }}>{label}</button>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>
          {view === "month" ? `${monthLabel.toUpperCase()} TABLE` : "SEASON TABLE"}
        </span>
        {(() => {
          const d = view === "month" ? month : season;
          return d && d.totalPlayers > 0
            ? <span style={{ fontSize: 11, color: MUTED }}>{d.totalPlayers.toLocaleString()} playing</span>
            : null;
        })()}
      </div>
      <div style={{ marginBottom: 8 }}>
        <Card>
          {view === "month"
            ? <Table data={month} loading={loading} empty={`No scores yet. ${monthLabel}'s table fills once the first gameweek is played.`} />
            : <Table data={season} loading={loading} empty="No scores yet. The season table builds gameweek by gameweek." />}
        </Card>
      </div>
    </div>
  );
}
