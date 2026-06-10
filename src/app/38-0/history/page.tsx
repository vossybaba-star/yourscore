"use client";

/**
 * /38-0/history — full H2H match history for the current user.
 * Shows every quick challenge and live match, grouped by date, with
 * an "Opponents faced" breakdown showing W/D/L record vs each person.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { useUser } from "@/hooks/useUser";
import type { HistoryEntry, OpponentRecord } from "@/app/api/draft/history/route";

// ── helpers ──────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${diffDays < 14 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: diffDays > 365 ? "numeric" : undefined });
}

function groupByDate(matches: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const groups: Map<string, HistoryEntry[]> = new Map();
  for (const m of matches) {
    const d = new Date(m.playedAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    let label: string;
    if (diffDays === 0) label = "Today";
    else if (diffDays === 1) label = "Yesterday";
    else if (diffDays < 7) label = "This week";
    else if (diffDays < 30) label = "This month";
    else {
      const mo = d.toLocaleString("en-GB", { month: "long" });
      label = `${mo} ${d.getFullYear()}`;
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(m);
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
}

// ── small components ──────────────────────────────────────────────────────────

function ResultBadge({ outcome }: { outcome: "W" | "D" | "L" }) {
  const cfg = {
    W: { bg: "rgba(0,255,135,0.12)", border: "rgba(0,255,135,0.3)", color: "#00ff87", label: "W" },
    D: { bg: "rgba(255,184,0,0.12)", border: "rgba(255,184,0,0.3)", color: "#ffb800", label: "D" },
    L: { bg: "rgba(255,71,87,0.12)", border: "rgba(255,71,87,0.3)", color: "#ff4757", label: "L" },
  }[outcome];
  return (
    <div className="w-9 h-9 rounded-xl flex items-center justify-center font-display text-base flex-shrink-0"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}>
      {cfg.label}
    </div>
  );
}

function TypeTag({ type }: { type: "live" | "quick" }) {
  return type === "live"
    ? <span className="font-body text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(0,255,135,0.08)", color: "#00ff87" }}>⚡ Live</span>
    : <span className="font-body text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa" }}>⚔️ Challenge</span>;
}

function MatchRow({ m }: { m: HistoryEntry }) {
  const outcomeColor = m.outcome === "W" ? "#00ff87" : m.outcome === "D" ? "#ffb800" : "#ff4757";
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all"
      style={{ background: "#12121e", border: `1px solid rgba(255,255,255,0.06)` }}>
      <ResultBadge outcome={m.outcome} />
      {/* Score */}
      <div className="w-14 text-center flex-shrink-0">
        <span className="font-display text-xl tabular-nums" style={{ color: outcomeColor }}>
          {m.myGoals}
        </span>
        <span className="font-display text-xl" style={{ color: "#444466" }}>–</span>
        <span className="font-display text-xl tabular-nums" style={{ color: m.outcome === "L" ? outcomeColor : "#cfcfe6" }}>
          {m.oppGoals}
        </span>
      </div>
      {/* Opponent + meta */}
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-semibold text-white truncate">vs {m.opponentName}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <TypeTag type={m.type} />
          {m.myFormation && (
            <span className="font-body text-xs" style={{ color: "#555577" }}>{m.myFormation}</span>
          )}
        </div>
      </div>
      {/* Date + strength */}
      <div className="text-right flex-shrink-0">
        <p className="font-body text-xs" style={{ color: "#555577" }}>{relativeDate(m.playedAt)}</p>
        {m.myStrength != null && (
          <p className="font-body text-xs mt-0.5" style={{ color: "#444466" }}>
            {m.myStrength} <span style={{ color: "#333355" }}>vs</span> {m.oppStrength}
          </p>
        )}
      </div>
    </div>
  );
}

function OpponentRow({ opp }: { opp: OpponentRecord }) {
  const total = opp.played;
  const winPct = total > 0 ? Math.round((opp.wins / total) * 100) : 0;
  const dominantOutcome = opp.wins > opp.losses ? "W" : opp.losses > opp.wins ? "L" : "D";
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
      style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Avatar initial */}
      <div className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
        style={{
          background: dominantOutcome === "W" ? "rgba(0,255,135,0.12)" : dominantOutcome === "L" ? "rgba(255,71,87,0.12)" : "rgba(255,184,0,0.12)",
          color: dominantOutcome === "W" ? "#00ff87" : dominantOutcome === "L" ? "#ff4757" : "#ffb800",
          border: `1px solid ${dominantOutcome === "W" ? "rgba(0,255,135,0.2)" : dominantOutcome === "L" ? "rgba(255,71,87,0.2)" : "rgba(255,184,0,0.2)"}`,
        }}>
        {(opp.opponentName[0] ?? "?").toUpperCase()}
      </div>
      {/* Name + stats */}
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-semibold text-white truncate">{opp.opponentName}</p>
        <div className="flex items-center gap-2 mt-1">
          {/* W/D/L mini bars */}
          {total > 0 && (
            <div className="flex h-1.5 rounded-full overflow-hidden gap-px flex-1 max-w-[80px]">
              <div className="rounded-l-full" style={{ width: `${(opp.wins / total) * 100}%`, background: "#00ff87", minWidth: opp.wins > 0 ? 3 : 0 }} />
              <div style={{ width: `${(opp.draws / total) * 100}%`, background: "#ffb800", minWidth: opp.draws > 0 ? 3 : 0 }} />
              <div className="rounded-r-full" style={{ width: `${(opp.losses / total) * 100}%`, background: "#ff4757", minWidth: opp.losses > 0 ? 3 : 0 }} />
            </div>
          )}
          <span className="font-body text-xs" style={{ color: "#555577" }}>
            {opp.wins}W {opp.draws}D {opp.losses}L
          </span>
        </div>
      </div>
      {/* Win % + game count */}
      <div className="text-right flex-shrink-0">
        <p className="font-display text-lg leading-none" style={{ color: winPct >= 50 ? "#00ff87" : "#ff4757" }}>{winPct}%</p>
        <p className="font-body text-xs mt-0.5" style={{ color: "#555577" }}>{total} game{total !== 1 ? "s" : ""}</p>
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const [matches, setMatches] = useState<HistoryEntry[] | null>(null);
  const [opponents, setOpponents] = useState<OpponentRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"matches" | "opponents">("matches");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userLoading) return;
    if (!user) { router.replace("/auth/sign-in?next=/38-0/history"); return; }
    fetch("/api/draft/history")
      .then((r) => r.json())
      .then((d: { matches?: HistoryEntry[]; opponents?: OpponentRecord[]; error?: string }) => {
        if (d.error) { setError(d.error); return; }
        setMatches(d.matches ?? []);
        setOpponents(d.opponents ?? []);
      })
      .catch(() => setError("Couldn't load history"));
  }, [user, userLoading, router]);

  const groups = matches ? groupByDate(matches) : [];

  // Totals
  const totalPlayed = matches?.length ?? 0;
  const totalWins = matches?.filter(m => m.outcome === "W").length ?? 0;
  const totalDraws = matches?.filter(m => m.outcome === "D").length ?? 0;
  const totalLosses = matches?.filter(m => m.outcome === "L").length ?? 0;

  return (
    <main className="min-h-dvh pb-28" style={{ background: "#0a0a0f" }}>

      {/* Header */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3 px-5 py-4 max-w-lg mx-auto">
          <button onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="#8888aa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="flex-1">
            <p className="font-display tracking-wide text-white leading-none" style={{ fontSize: 20 }}>MATCH HISTORY</p>
            <p className="font-body text-xs text-text-muted mt-0.5">38-0 Head-to-Head</p>
          </div>
          <Link href="/38-0/leaderboard" className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}>
            Leaderboard
          </Link>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 pt-5 space-y-5">

        {/* Overall record banner */}
        {matches !== null && totalPlayed > 0 && (
          <div className="rounded-2xl px-5 py-4"
            style={{ background: "linear-gradient(135deg, rgba(0,255,135,0.08) 0%, rgba(167,139,250,0.05) 100%)", border: "1px solid rgba(0,255,135,0.15)" }}>
            <p className="font-body text-xs uppercase tracking-widest mb-3" style={{ color: "#00ff87" }}>Your Record</p>
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <p className="font-display text-4xl leading-none text-white">
                  {totalWins}
                  <span className="text-2xl" style={{ color: "#555577" }}>-{totalDraws}-{totalLosses}</span>
                </p>
                <p className="font-body text-xs text-text-muted mt-1.5">W-D-L · {totalPlayed} games</p>
              </div>
              {/* Win % gauge */}
              <div className="text-right">
                <p className="font-display text-3xl leading-none" style={{ color: totalWins / totalPlayed >= 0.5 ? "#00ff87" : "#ff4757" }}>
                  {Math.round((totalWins / totalPlayed) * 100)}%
                </p>
                <p className="font-body text-xs text-text-muted mt-1">win rate</p>
              </div>
            </div>
            {/* W/D/L bar */}
            <div className="flex h-2 rounded-full overflow-hidden gap-px mt-3">
              <div style={{ flex: totalWins, background: "#00ff87", minWidth: totalWins > 0 ? 4 : 0 }} />
              <div style={{ flex: totalDraws, background: "#ffb800", minWidth: totalDraws > 0 ? 4 : 0 }} />
              <div style={{ flex: totalLosses, background: "#ff4757", minWidth: totalLosses > 0 ? 4 : 0 }} />
            </div>
          </div>
        )}

        {/* Tabs */}
        {matches !== null && totalPlayed > 0 && (
          <div className="flex gap-2 p-1 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <button
              onClick={() => setActiveTab("matches")}
              className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
              style={{
                background: activeTab === "matches" ? "rgba(0,255,135,0.12)" : "transparent",
                color: activeTab === "matches" ? "#00ff87" : "#8888aa",
                border: activeTab === "matches" ? "1px solid rgba(0,255,135,0.25)" : "1px solid transparent",
              }}>
              Matches ({totalPlayed})
            </button>
            <button
              onClick={() => setActiveTab("opponents")}
              className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
              style={{
                background: activeTab === "opponents" ? "rgba(167,139,250,0.12)" : "transparent",
                color: activeTab === "opponents" ? "#a78bfa" : "#8888aa",
                border: activeTab === "opponents" ? "1px solid rgba(167,139,250,0.25)" : "1px solid transparent",
              }}>
              Opponents ({opponents.length})
            </button>
          </div>
        )}

        {/* Loading */}
        {matches === null && !error && (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="h-8 w-8 rounded-full animate-spin" style={{ border: "2px solid rgba(0,255,135,0.2)", borderTopColor: "#00ff87" }} />
            <p className="font-body text-sm" style={{ color: "#8888aa" }}>Loading match history…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-2xl px-5 py-4 text-center" style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.2)" }}>
            <p className="font-body text-sm" style={{ color: "#ff4757" }}>{error}</p>
          </div>
        )}

        {/* Empty state */}
        {matches !== null && totalPlayed === 0 && (
          <div className="py-16 text-center">
            <p className="font-display text-3xl text-white mb-3">NO MATCHES YET</p>
            <p className="font-body text-sm text-text-muted mb-6">Play your first head-to-head to start your history.</p>
            <Link href="/38-0/live"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-body font-bold text-sm"
              style={{ background: "rgba(0,255,135,0.12)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.25)" }}>
              Find a match →
            </Link>
          </div>
        )}

        {/* Matches tab */}
        {activeTab === "matches" && groups.length > 0 && (
          <div className="space-y-6">
            {groups.map(({ label, entries }) => (
              <div key={label}>
                <p className="font-body text-xs uppercase tracking-widest mb-3" style={{ color: "#555577" }}>{label}</p>
                <div className="space-y-2">
                  {entries.map(m => <MatchRow key={m.id} m={m} />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Opponents tab */}
        {activeTab === "opponents" && opponents.length > 0 && (
          <div className="space-y-2">
            {opponents.map(opp => <OpponentRow key={opp.opponentId} opp={opp} />)}
          </div>
        )}

        {/* Bottom links */}
        {matches !== null && (
          <div className="flex gap-3 pt-2">
            <Link href="/38-0/live"
              className="flex-1 flex items-center justify-center py-3 rounded-2xl font-body text-sm font-semibold"
              style={{ background: "rgba(0,255,135,0.08)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.18)" }}>
              Play now →
            </Link>
            <Link href="/friends"
              className="flex-1 flex items-center justify-center py-3 rounded-2xl font-body text-sm font-semibold"
              style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.18)" }}>
              Friends
            </Link>
          </div>
        )}

      </div>

      <BottomNav />
    </main>
  );
}
