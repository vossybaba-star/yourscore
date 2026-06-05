"use client";

import { useState, useEffect } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";
import { createClient } from "@/lib/supabase/client";

interface League {
  id: string;
  name: string;
  code: string;
  description: string | null;
  created_by: string | null;
}

// league_members → profiles has no declared FK in the generated types,
// so the nested join result is typed locally at the query boundary.
interface MemberRow {
  user_id: string;
  total_score: number | null;
  games_played: number | null;
  questions_attempted: number | null;
  questions_correct: number | null;
  current_streak: number | null;
  best_streak: number | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

interface LeagueMember {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_score: number;
  games_played: number;
  questions_attempted: number;
  questions_correct: number;
  current_streak: number;
  best_streak: number;
}

function accuracy(correct: number, attempted: number): number {
  if (attempted === 0) return 0;
  return Math.round((correct / attempted) * 100);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AccuracyBar({ pct }: { pct: number }) {
  const color = pct >= 75 ? "#00ff87" : pct >= 50 ? "#a78bfa" : "#8888aa";
  return (
    <div className="h-1 rounded-full overflow-hidden" style={{ width: 40, background: "rgba(255,255,255,0.08)" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function AvatarCircle({ name, size = 36 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[name.charCodeAt(0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "1px solid rgba(255,255,255,0.08)" }}>
      {name[0].toUpperCase()}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  const configs: Record<string, { bg: string; border: string; text: string }> = {
    green:  { bg: "rgba(0,255,135,0.1)",    border: "rgba(0,255,135,0.25)",    text: "#00ff87" },
    purple: { bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.3)",   text: "#a78bfa" },
    orange: { bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.3)",    text: "#fb923c" },
    blue:   { bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.3)",    text: "#60a5fa" },
  };
  const s = configs[color] ?? configs.purple;
  return (
    <span className="inline-flex items-center font-body font-semibold rounded-md px-1.5 py-0.5 text-xs flex-shrink-0"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}>
      {children}
    </span>
  );
}

function getMemberBadges(m: LeagueMember, isP4PLeader: boolean) {
  const badges: React.ReactNode[] = [];
  if (isP4PLeader && m.questions_attempted >= 3) {
    badges.push(<Badge key="p4p" color="purple">P4P #1</Badge>);
  }
  if (m.current_streak >= 3) {
    badges.push(<Badge key="streak" color="orange">🔥 {m.current_streak}</Badge>);
  }
  if (m.best_streak >= 8) {
    badges.push(<Badge key="best" color="blue">Best: {m.best_streak}</Badge>);
  }
  const acc = accuracy(m.questions_correct, m.questions_attempted);
  if (acc === 100 && m.questions_attempted >= 3) {
    badges.push(<Badge key="perfect" color="green">Perfect</Badge>);
  }
  return badges;
}

export default function LeaguePage({ params }: { params: { id: string } }) {
  const { user } = useUser();
  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [QRCode, setQRCode] = useState<React.ComponentType<{ value: string; size?: number }> | null>(null);
  const [tab, setTab] = useState<"standings" | "live" | "fixtures">("standings");
  const [sortBy, setSortBy] = useState<"points" | "form">("points");
  const [formScores, setFormScores] = useState<Record<string, number>>({});
  const [gamesPlayedByUser, setGamesPlayedByUser] = useState<Record<string, number>>({});
  const [totalGames, setTotalGames] = useState(0); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [rankDelta, setRankDelta] = useState<number | null>(null);

  useEffect(() => {
    import("react-qr-code").then(m => setQRCode(() => m.default));
  }, []);

  useEffect(() => {
    const sb = createClient();

    sb.from("leagues").select("id, name, code, description, created_by").eq("id", params.id).single()
      .then(({ data }) => { if (data) setLeague(data as League); });

    async function fetchMembers() {
      // Member stats come from the canonical league_members aggregates (kept
      // up to date by the update_league_member_stats RPC), not recomputed from
      // a full answers scan.
      const { data: memberRows } = await sb
        .from("league_members")
        .select("user_id, total_score, games_played, questions_attempted, questions_correct, current_streak, best_streak, profiles(display_name, avatar_url)")
        .eq("league_id", params.id)
        .order("total_score", { ascending: false }) as { data: MemberRow[] | null };

      if (!memberRows) { setLoading(false); return; }
      const userIds = memberRows.map((m) => m.user_id);

      // "Form" (last 5 games) is the only thing that needs per-answer data — fetch
      // a bounded recent slice rather than every answer the league has ever had.
      const { data: answerRows } = await sb
        .from("answers")
        .select("user_id, points_awarded, match_id, room_id")
        .in("user_id", userIds)
        .order("answered_at", { ascending: false })
        .limit(2000);

      // Compute form scores (last 5 unique games) and games played per user
      const userGameOrder: Record<string, string[]> = {};
      const userGamePts: Record<string, Record<string, number>> = {};
      const allGameKeys = new Set<string>();
      for (const a of (answerRows ?? [])) {
        const uid = a.user_id;
        if (!uid) continue;
        const gameKey = a.match_id ?? a.room_id;
        if (!gameKey) continue;
        allGameKeys.add(gameKey);
        if (!userGamePts[uid]) { userGamePts[uid] = {}; userGameOrder[uid] = []; }
        if (!userGamePts[uid][gameKey]) {
          userGamePts[uid][gameKey] = 0;
          userGameOrder[uid].push(gameKey);
        }
        userGamePts[uid][gameKey] += a.points_awarded ?? 0;
      }
      const fScores: Record<string, number> = {};
      const gPlayed: Record<string, number> = {};
      for (const uid of Object.keys(userGamePts)) {
        const games = userGameOrder[uid];
        gPlayed[uid] = games.length;
        fScores[uid] = games.slice(0, 5).reduce((sum, gk) => sum + (userGamePts[uid][gk] ?? 0), 0);
      }
      setFormScores(fScores);
      setGamesPlayedByUser(gPlayed);
      setTotalGames(allGameKeys.size);

      setMembers(memberRows.map((row) => ({
        user_id: row.user_id,
        display_name: row.profiles?.display_name ?? "Player",
        avatar_url: row.profiles?.avatar_url ?? null,
        total_score: row.total_score ?? 0,
        games_played: row.games_played ?? 0,
        questions_attempted: row.questions_attempted ?? 0,
        questions_correct: row.questions_correct ?? 0,
        current_streak: row.current_streak ?? 0,
        best_streak: row.best_streak ?? 0,
      })));
      setLoading(false);
    }
    fetchMembers();
  }, [params.id]);

  function copyInvite() {
    if (!league) return;
    navigator.clipboard.writeText(`${window.location.origin}/league/join/${league.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isCreator = user?.id === league?.created_by;

  // Rank delta: compare stored rank to current rank for own user
  const myRankInStandings = members.length > 0 && user
    ? [...members].sort((a, b) => b.total_score - a.total_score).findIndex(m => m.user_id === user.id) + 1
    : null;
  useEffect(() => {
    if (!user || !params.id || myRankInStandings === null || myRankInStandings === 0) return;
    const key = `ys_rank_${params.id}_${user.id}`;
    const stored = typeof window !== "undefined" ? localStorage.getItem(key) : null;
    if (stored) {
      const prev = parseInt(stored, 10);
      if (!isNaN(prev) && prev !== myRankInStandings) setRankDelta(prev - myRankInStandings);
    }
    if (typeof window !== "undefined") localStorage.setItem(key, String(myRankInStandings));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRankInStandings]);

  const sortedMembers = [...members].sort((a, b) => {
    if (sortBy === "form") {
      const fA = formScores[a.user_id] ?? 0;
      const fB = formScores[b.user_id] ?? 0;
      if (fB !== fA) return fB - fA;
      return b.total_score - a.total_score;
    }
    return b.total_score - a.total_score;
  });

  if (loading) return (
    <main className="min-h-dvh bg-bg flex items-center justify-center">
      <Spinner size={32} />
    </main>
  );

  if (!league) return (
    <main className="min-h-dvh bg-bg flex items-center justify-center">
      <div className="text-center">
        <p className="font-display text-2xl text-white mb-2">League not found</p>
        <Link href="/leagues" className="font-body text-sm text-text-muted hover:text-white">← Leagues</Link>
      </div>
    </main>
  );

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.025} />
      <div className="fixed top-0 left-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(167,139,250,0.06) 0%, transparent 60%)" }} />

      {/* Header */}
      <div className="sticky top-0 z-10 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/leagues" className="text-text-muted hover:text-white transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <div>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest">League</p>
              <p className="font-display text-lg text-white leading-tight">{league.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyInvite}
              className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
              style={{ background: copied ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.06)", color: copied ? "#a78bfa" : "#8888aa", border: `1px solid ${copied ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.08)"}` }}>
              {copied ? "✓ Copied" : `${league.code} · Invite`}
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-4">

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}>
          {([["standings", "Standings"], ["live", "Members"], ["fixtures", "Fixtures"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex-1 py-2.5 rounded-lg font-body text-sm font-semibold transition-all"
              style={{ background: tab === key ? "rgba(167,139,250,0.15)" : "transparent", color: tab === key ? "#a78bfa" : "#8888aa" }}>
              {label}
            </button>
          ))}
        </div>

        {/* Standings tab */}
        {tab === "standings" && (
          <div className="space-y-3">
            {/* Sort toggle */}
            <div className="flex items-center gap-2">
              <span className="font-body text-xs text-text-muted">Ranked by</span>
              <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <button onClick={() => setSortBy("points")}
                  className="px-3 py-1.5 rounded-md font-body text-xs font-semibold transition-all"
                  style={{ background: sortBy === "points" ? "rgba(167,139,250,0.2)" : "transparent", color: sortBy === "points" ? "#a78bfa" : "#8888aa" }}>
                  Season
                </button>
                <button onClick={() => setSortBy("form")}
                  className="px-3 py-1.5 rounded-md font-body text-xs font-semibold transition-all"
                  style={{ background: sortBy === "form" ? "rgba(0,255,135,0.15)" : "transparent", color: sortBy === "form" ? "#00ff87" : "#8888aa" }}>
                  Form (last 5)
                </button>
              </div>
            </div>

            {sortBy === "form" && (
              <div className="px-4 py-3 rounded-xl" style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.15)" }}>
                <p className="font-body text-xs text-green">
                  Points from each player&apos;s last 5 games. Shows who&apos;s in form right now.
                </p>
              </div>
            )}

            {/* Table header */}
            <div className="flex items-center gap-2 px-4 py-2 rounded-t-2xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderBottom: "none" }}>
              <span className="font-body text-xs uppercase tracking-widest w-6 flex-shrink-0" style={{ color: "#555577" }}>Pos</span>
              <span className="flex-1 font-body text-xs uppercase tracking-widest" style={{ color: "#555577" }}>Player</span>
              <span className="font-body text-xs uppercase tracking-widest w-8 text-right flex-shrink-0" style={{ color: "#555577" }}>P</span>
              <span className="font-body text-xs uppercase tracking-widest w-10 text-right flex-shrink-0" style={{ color: "#555577" }}>Acc</span>
              <span className="font-body text-xs uppercase tracking-widest w-14 text-right flex-shrink-0" style={{ color: "#555577" }}>Pts</span>
            </div>

            <div className="rounded-b-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              {members.length === 0 ? (
                <div className="px-5 py-8 text-center bg-surface">
                  <p className="font-body text-sm text-text-muted">No members yet. Share the invite code!</p>
                </div>
              ) : sortedMembers.map((m, i) => {
                const acc = accuracy(m.questions_correct, m.questions_attempted);
                const badges = getMemberBadges(m, false);
                const gPlayed = gamesPlayedByUser[m.user_id] ?? 0;
                const formScore = formScores[m.user_id] ?? 0;
                const isMe = m.user_id === user?.id;
                const medalColor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : null;

                return (
                  <Link key={m.user_id} href={`/profile/${m.user_id}`}
                    className="flex items-center gap-2 px-4 py-3 transition-opacity hover:opacity-80"
                    style={{
                      background: isMe ? "rgba(167,139,250,0.06)" : i % 2 === 0 ? "#12121e" : "rgba(255,255,255,0.01)",
                      borderBottom: i < sortedMembers.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}>
                    {/* Pos */}
                    <div className="w-6 flex-shrink-0 flex flex-col items-center">
                      <span className="font-display text-sm" style={{ color: medalColor ?? "#8888aa" }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                      </span>
                      {isMe && rankDelta !== null && rankDelta !== 0 && (
                        <span className="font-body text-xs leading-none" style={{ color: rankDelta > 0 ? "#00ff87" : "#f87171" }}>
                          {rankDelta > 0 ? `▲${rankDelta}` : `▼${Math.abs(rankDelta)}`}
                        </span>
                      )}
                    </div>
                    {/* Avatar + name */}
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      <AvatarCircle name={m.display_name} size={28} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <p className="font-body text-sm font-medium text-white truncate">{m.display_name}</p>
                          {isMe && <span className="font-body text-xs" style={{ color: "#a78bfa" }}>you</span>}
                        </div>
                        <div className="flex gap-1 flex-wrap">{badges}</div>
                      </div>
                    </div>
                    {/* P (games) */}
                    <span className="font-body text-xs tabular-nums w-8 text-right flex-shrink-0" style={{ color: "#555577" }}>
                      {gPlayed}
                    </span>
                    {/* Acc */}
                    <span className="font-body text-xs tabular-nums w-10 text-right flex-shrink-0"
                      style={{ color: m.questions_attempted > 0 ? (acc >= 75 ? "#00ff87" : acc >= 50 ? "#a78bfa" : "#8888aa") : "#333355" }}>
                      {m.questions_attempted > 0 ? `${acc}%` : "—"}
                    </span>
                    {/* Pts */}
                    <div className="w-14 text-right flex-shrink-0">
                      <p className="font-display text-base leading-none" style={{ color: sortBy === "form" ? (i === 0 ? "#00ff87" : "white") : (i === 0 ? "#a78bfa" : "white") }}>
                        {(sortBy === "form" ? formScore : m.total_score).toLocaleString()}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Sticky own-player row — shown when user is not already visible at top */}
            {user && sortedMembers.length > 5 && (() => {
              const myIdx = sortedMembers.findIndex(m => m.user_id === user.id);
              if (myIdx < 0 || myIdx < 4) return null;
              const m = sortedMembers[myIdx];
              const acc = accuracy(m.questions_correct, m.questions_attempted);
              const gPlayed = gamesPlayedByUser[m.user_id] ?? 0;
              const formScore = formScores[m.user_id] ?? 0;
              return (
                <div className="sticky bottom-0 mt-1 rounded-2xl overflow-hidden"
                  style={{ background: "rgba(10,10,15,0.97)", backdropFilter: "blur(12px)", border: "1px solid rgba(167,139,250,0.3)" }}>
                  <Link href={`/profile/${m.user_id}`}
                    className="flex items-center gap-2 px-4 py-3"
                    style={{ background: "rgba(167,139,250,0.08)" }}>
                    <div className="w-6 flex-shrink-0 flex flex-col items-center">
                      <span className="font-display text-sm" style={{ color: "#a78bfa" }}>#{myIdx + 1}</span>
                      {rankDelta !== null && rankDelta !== 0 && (
                        <span className="font-body text-xs leading-none" style={{ color: rankDelta > 0 ? "#00ff87" : "#f87171" }}>
                          {rankDelta > 0 ? `▲${rankDelta}` : `▼${Math.abs(rankDelta)}`}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      <AvatarCircle name={m.display_name} size={28} />
                      <p className="font-body text-sm font-medium text-white truncate">{m.display_name}</p>
                      <span className="font-body text-xs" style={{ color: "#a78bfa" }}>you</span>
                    </div>
                    <span className="font-body text-xs tabular-nums w-8 text-right flex-shrink-0" style={{ color: "#555577" }}>{gPlayed}</span>
                    <span className="font-body text-xs tabular-nums w-10 text-right flex-shrink-0"
                      style={{ color: acc >= 75 ? "#00ff87" : acc >= 50 ? "#a78bfa" : "#8888aa" }}>
                      {m.questions_attempted > 0 ? `${acc}%` : "—"}
                    </span>
                    <div className="w-14 text-right flex-shrink-0">
                      <p className="font-display text-base leading-none" style={{ color: "#a78bfa" }}>
                        {(sortBy === "form" ? formScore : m.total_score).toLocaleString()}
                      </p>
                    </div>
                  </Link>
                </div>
              );
            })()}
          </div>
        )}

        {/* Members tab */}
        {tab === "live" && (
          <div className="space-y-3">
            {members.map((m) => (
              <Link key={m.user_id} href={`/profile/${m.user_id}`}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-opacity hover:opacity-80 bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <AvatarCircle name={m.display_name} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-body text-sm font-semibold text-white">{m.display_name}</p>
                    {m.user_id === user?.id && <span className="font-body text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa" }}>you</span>}
                  </div>
                  <p className="font-body text-xs text-text-muted mt-0.5">
                    {m.total_score > 0
                      ? `${m.total_score.toLocaleString()} pts · ${accuracy(m.questions_correct, m.questions_attempted)}% accuracy`
                      : "No games played yet"}
                  </p>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "#333355", flexShrink: 0 }}>
                  <path d="M4 2l6 5-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}

            {isCreator && (
              <button onClick={copyInvite}
                className="w-full py-3.5 rounded-2xl font-body text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-80"
                style={{ border: "1px dashed rgba(167,139,250,0.3)", color: "#a78bfa", background: "rgba(167,139,250,0.04)" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {copied ? "Link copied!" : "Invite more people"}
              </button>
            )}
          </div>
        )}

        {/* Fixtures tab */}
        {tab === "fixtures" && (
          <div className="rounded-2xl p-8 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-body text-sm text-text-muted">Fixtures coming soon.</p>
          </div>
        )}

        {/* Invite code card */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.12)" }}>
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-0.5">Invite code</p>
              <p className="font-display text-2xl tracking-widest" style={{ color: "#a78bfa" }}>{league.code}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowQR(v => !v)}
                className="font-body text-sm font-semibold px-3 py-2 rounded-xl transition-all hover:opacity-80 flex items-center gap-1.5"
                style={{ background: showQR ? "rgba(167,139,250,0.2)" : "rgba(255,255,255,0.05)", color: showQR ? "#a78bfa" : "#8888aa", border: `1px solid ${showQR ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.08)"}` }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/><rect x="8" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="8" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/><rect x="3" y="3" width="1.5" height="1.5" fill="currentColor"/><rect x="10" y="3" width="1.5" height="1.5" fill="currentColor"/><rect x="3" y="10" width="1.5" height="1.5" fill="currentColor"/><path d="M8 8h1.5v1.5H8zM10.5 8H12v1.5h-1.5zM10.5 10.5H12V12h-1.5zM8 10.5h1.5V12H8z" fill="currentColor"/></svg>
                QR
              </button>
              <button onClick={copyInvite}
                className="font-body text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:opacity-80"
                style={{ background: copied ? "rgba(167,139,250,0.2)" : "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
                {copied ? "✓ Copied" : "Copy link"}
              </button>
            </div>
          </div>
          {showQR && QRCode && (
            <div className="px-4 pb-4">
              <div className="flex flex-col items-center gap-2 p-4 rounded-2xl" style={{ background: "white" }}>
                <QRCode value={`${typeof window !== "undefined" ? window.location.origin : ""}/league/join/${league.code}`} size={160} />
                <p className="font-body text-xs text-black/50 mt-1">Scan to join <span className="font-semibold text-black/70">{league.name}</span></p>
              </div>
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
