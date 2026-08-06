"use client";
/** History — the league's permanent per-gameweek memory. A list of completed
 *  gameweeks, each with a recap: winner, your finish, the derived highlights and
 *  the final table snapshot (immutable, recomputed from scored entries).
 *
 *  Phase 4B adds a flat "GAMES" block — completed league-mate challenge
 *  results. History here is strictly per-GAMEWEEK buckets (leagues.ts's
 *  leagueHistory walks fantasy_entries, nothing about member_challenges), so
 *  results are never forced into a gameweek the way a Fantasy score is —
 *  a challenge can complete mid-week, between gameweeks, or long after one
 *  closes. Rendered BELOW the gameweek list rather than above: gameweek
 *  recaps stay this tab's primary, unchanged first thing a member sees;
 *  Games results are an appended section, not a promotion above them. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, SectionLabel, Sheet } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { LeagueTableRows } from "./LeagueTableRows";
import { formatGameResultLine } from "@/lib/fantasy/games-pure";
import { competitionResultLine, type CompetitionFormatId } from "@/lib/fantasy/competitions-pure";
import { trackGamesHistoryResultOpened } from "@/lib/analytics/trackSocial";
import type { CompetitionHistoryEntry, GamesHistoryEntry, HistoryGw, LeagueHistoryData } from "./types";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "3 hours ago" / "2 days ago" — same rounding idiom LeagueGamesView's own
 *  timeAgo uses, duplicated rather than imported (that one lives in a
 *  "use client" component file, not a shared lib — same per-file duplication
 *  idiom this codebase already follows for small display helpers). */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

function GameHistoryRow({ entry }: { entry: GamesHistoryEntry }) {
  const line = formatGameResultLine(entry);
  const row = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "9px 11px" }}>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ position: "relative", zIndex: 2 }}><PlayerAvatar name={entry.challengerName} avatarUrl={entry.challengerAvatarUrl} size={24} /></div>
        <div style={{ position: "relative", zIndex: 1, marginLeft: -8 }}><PlayerAvatar name={entry.opponentName} avatarUrl={entry.opponentAvatarUrl} size={24} /></div>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{entry.gameName} · {timeAgo(entry.completedAt)}</div>
      </div>
    </div>
  );
  if (!entry.h2hId) return row;
  return (
    <Link href={`/h2h/${entry.h2hId}`} onClick={() => trackGamesHistoryResultOpened()} style={{ textDecoration: "none", display: "block" }}>
      {row}
    </Link>
  );
}

/** A completed competition's history line (UI wave) — title + the exact same
 *  result-line copy competitions.ts's own settle path uses (competitionResultLine),
 *  never a second wording. No link target (a competition has no page of its
 *  own outside the Games tab sheet) — a quiet, terminal record, same as a
 *  gameweek recap row that's already settled. */
function CompetitionHistoryRow({ entry }: { entry: CompetitionHistoryEntry }) {
  const line = competitionResultLine({
    format: entry.format as CompetitionFormatId, entrantCount: entry.entrantCount,
    winnerName: entry.winnerName, placedCount: entry.placedCount,
  });
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "9px 11px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{line} · {timeAgo(entry.settledAt)}</div>
    </div>
  );
}

export function LeagueHistoryView({ code, onOpenChat }: { code: string; onOpenChat: (gw: number) => void }) {
  const [data, setData] = useState<LeagueHistoryData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<HistoryGw | null>(null);
  const [games, setGames] = useState<GamesHistoryEntry[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionHistoryEntry[]>([]);

  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load history"))))
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [code]);

  // GAMES block (Phase 4B, + competitions in the UI wave) — a separate small
  // fetch, own failure mode: if it 404s/errors the gameweek list above still
  // renders fine, this section just stays empty (no error banner of its own
  // — a completed-challenge/competition list is a nice-to-have on this tab,
  // not load-bearing).
  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/games/history`)
      .then((r) => (r.ok ? r.json() : { entries: [], competitions: [] }))
      .then((d) => {
        if (!live) return;
        setGames((d.entries ?? []) as GamesHistoryEntry[]);
        setCompetitions((d.competitions ?? []) as CompetitionHistoryEntry[]);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [code]);

  // The GAMES block's rows, interleaved by their own settle time (UI wave)
  // — a challenge and a competition are differently shaped rows, so this
  // merges pre-rendered nodes by timestamp rather than forcing one common
  // row shape.
  const gamesRows = useMemo(() => {
    const rows: { at: string; node: React.ReactNode }[] = [
      ...games.map((e) => ({ at: e.completedAt, node: <GameHistoryRow key={e.challengeId} entry={e} /> })),
      ...competitions.map((c) => ({ at: c.settledAt, node: <CompetitionHistoryRow key={c.id} entry={c} /> })),
    ];
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [games, competitions]);

  if (err) return <p style={{ fontSize: 13, color: MUTED }}>{err}</p>;
  if (!data) return <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!data.gameweeks.length ? (
        <Card>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            No completed gameweeks yet. Once a gameweek is scored, it lands here with a recap and a final table
            you can always come back to.
          </p>
        </Card>
      ) : (
        data.gameweeks.map((g) => (
          <div key={g.gw} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 13 }}>
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
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <button onClick={() => setOpen(g)} style={{ background: "none", border: "none", color: "#43d6c0", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>View recap →</button>
              <button onClick={() => onOpenChat(g.gw)} style={{ background: "none", border: "none", color: "#43d6c0", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Open GW{g.gw} chat →</button>
            </div>
          </div>
        ))
      )}

      {/* GAMES block (Phase 4B) — flat, appended below the gameweek list;
          omitted outright when this league has no completed challenges
          (house rule: no empty section headers). */}
      {gamesRows.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <SectionLabel>GAMES</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {gamesRows.map((r) => r.node)}
          </div>
        </div>
      )}

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

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Btn onClick={() => { const gw = open.gw; setOpen(null); onOpenChat(gw); }}>Open GW{open.gw} chat</Btn>
            <Btn onClick={() => setOpen(null)}>Close</Btn>
          </div>
        </Sheet>
      )}
    </div>
  );
}
