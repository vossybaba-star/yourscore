/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";
import { createClient } from "@/lib/supabase/client";
import { MOCK_MATCHES, formatMatchDate } from "@/lib/rooms";

interface League {
  id: string;
  name: string;
  code: string;
  description: string | null;
  created_by: string | null;
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
  live_room_id: string | null;
  live_match_label: string | null;
}

function computeCurrentStreak(answers: { is_correct: boolean }[]): number {
  let streak = 0;
  for (const a of answers) {
    if (a.is_correct) streak++;
    else break;
  }
  return streak;
}

function computeBestStreak(answers: { is_correct: boolean }[]): number {
  let best = 0;
  let cur = 0;
  for (const a of [...answers].reverse()) {
    if (a.is_correct) { cur++; best = Math.max(best, cur); }
    else cur = 0;
  }
  return best;
}

function accuracy(correct: number, attempted: number): number {
  if (attempted === 0) return 0;
  return Math.round((correct / attempted) * 100);
}

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

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#00ff87" }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#00ff87" }} />
    </span>
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
  const [tab, setTab] = useState<"standings" | "live" | "fixtures">("standings");
  const [sortBy, setSortBy] = useState<"points" | "form">("points");
  const [formScores, setFormScores] = useState<Record<string, number>>({});
  const [gamesPlayedByUser, setGamesPlayedByUser] = useState<Record<string, number>>({});
  const [totalGames, setTotalGames] = useState(0);

  useEffect(() => {
    const sb = createClient();

    sb.from("leagues").select("id, name, code, description, created_by").eq("id", params.id).single()
      .then(({ data }) => { if (data) setLeague(data as League); });

    async function fetchMembers() {
      const { data: memberRows } = await sb
        .from("league_members")
        .select("user_id, total_score, games_played, profiles(display_name, avatar_url)")
        .eq("league_id", params.id)
        .order("total_score", { ascending: false });

      if (!memberRows) { setLoading(false); return; }
      const userIds = memberRows.map((m: any) => m.user_id);

      // Fetch answers for all members (newest first for current streak calc)
      const { data: answerRows } = await (sb as any)
        .from("answers")
        .select("user_id, is_correct, answered_at, points_awarded, match_id, room_id")
        .in("user_id", userIds)
        .order("answered_at", { ascending: false });

      const answersByUser: Record<string, { is_correct: boolean }[]> = {};
      (answerRows ?? []).forEach((a: any) => {
        if (!answersByUser[a.user_id]) answersByUser[a.user_id] = [];
        answersByUser[a.user_id].push({ is_correct: a.is_correct });
      });

      // Compute form scores (last 5 unique games) and games played per user
      const userGameOrder: Record<string, string[]> = {};
      const userGamePts: Record<string, Record<string, number>> = {};
      const allGameKeys = new Set<string>();
      for (const a of (answerRows ?? [])) {
        const uid = a.user_id;
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

      // Check live rooms
      const { data: liveRooms } = await sb
        .from("room_members")
        .select("user_id, room_id, rooms(status, name, matches(home_team, away_team))")
        .in("user_id", userIds)
        .eq("rooms.status", "live");

      const liveMap: Record<string, { room_id: string; label: string }> = {};
      (liveRooms ?? []).forEach((row: any) => {
        if (row.rooms?.status === "live") {
          const m = row.rooms.matches;
          liveMap[row.user_id] = {
            room_id: row.room_id,
            label: m ? `${m.home_team} vs ${m.away_team}` : row.rooms.name,
          };
        }
      });

      setMembers(memberRows.map((row: any) => {
        const userAnswers = answersByUser[row.user_id] ?? [];
        const correct = userAnswers.filter((a) => a.is_correct).length;
        return {
          user_id: row.user_id,
          display_name: row.profiles?.display_name ?? "Player",
          avatar_url: row.profiles?.avatar_url ?? null,
          total_score: row.total_score ?? 0,
          games_played: row.games_played ?? 0,
          questions_attempted: userAnswers.length,
          questions_correct: correct,
          current_streak: computeCurrentStreak(userAnswers),
          best_streak: computeBestStreak(userAnswers),
          live_room_id: liveMap[row.user_id]?.room_id ?? null,
          live_match_label: liveMap[row.user_id]?.label ?? null,
        };
      }));
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

  const liveMembers = members.filter(m => m.live_room_id);
  const isCreator = user?.id === league?.created_by;

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
        <Link href="/" className="font-body text-sm text-text-muted hover:text-white">← Home</Link>
      </div>
    </main>
  );

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="fixed top-0 left-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(167,139,250,0.06) 0%, transparent 60%)" }} />

      {/* Header */}
      <div className="sticky top-0 z-10" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-text-muted hover:text-white transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <div>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest">League</p>
              <p className="font-display text-lg text-white leading-tight">{league.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {liveMembers.length > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)" }}>
                <LiveDot />
                <span className="font-body text-xs font-semibold" style={{ color: "#00ff87" }}>{liveMembers.length} live</span>
              </div>
            )}
            <button onClick={copyInvite}
              className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
              style={{ background: copied ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.06)", color: copied ? "#a78bfa" : "#8888aa", border: `1px solid ${copied ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.08)"}` }}>
              {copied ? "✓ Copied" : `${league.code} · Invite`}
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-4">

        {/* Live now banner */}
        {liveMembers.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.15)" }}>
            <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(0,255,135,0.08)" }}>
              <LiveDot />
              <p className="font-body text-xs font-semibold uppercase tracking-widest text-white">Live right now</p>
            </div>
            {liveMembers.map((m) => (
              <Link key={m.user_id} href={`/room/${m.live_room_id}`}
                className="flex items-center gap-3 px-5 py-3 hover:opacity-80 transition-opacity"
                style={{ borderBottom: "1px solid rgba(0,255,135,0.06)" }}>
                <AvatarCircle name={m.display_name} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold text-white">{m.display_name}</p>
                  <p className="font-body text-xs text-text-muted truncate">{m.live_match_label}</p>
                </div>
                <span className="font-body text-xs font-semibold" style={{ color: "#00ff87" }}>Watch →</span>
              </Link>
            ))}
          </div>
        )}

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
                <p className="font-body text-xs" style={{ color: "#00ff87" }}>
                  Points from each player&apos;s last 5 games. Shows who&apos;s in form right now.
                </p>
              </div>
            )}

            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              {members.length === 0 ? (
                <div className="px-5 py-8 text-center" style={{ background: "#12121e" }}>
                  <p className="font-body text-sm text-text-muted">No members yet. Share the invite code!</p>
                </div>
              ) : sortedMembers.map((m, i) => {
                const acc = accuracy(m.questions_correct, m.questions_attempted);
                const badges = getMemberBadges(m, false);
                const gPlayed = gamesPlayedByUser[m.user_id] ?? 0;
                const formScore = formScores[m.user_id] ?? 0;

                return (
                  <div key={m.user_id} className="px-4 py-3.5"
                    style={{
                      background: m.user_id === user?.id ? "rgba(167,139,250,0.04)" : i % 2 === 0 ? "#12121e" : "rgba(255,255,255,0.01)",
                      borderBottom: i < sortedMembers.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}>
                    <div className="flex items-center gap-2.5">
                      <span className="font-display text-sm w-5 flex-shrink-0" style={{ color: i === 0 ? (sortBy === "form" ? "#00ff87" : "#a78bfa") : "#8888aa" }}>#{i + 1}</span>
                      <AvatarCircle name={m.display_name} size={32} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-body text-sm font-medium text-white">{m.display_name}</p>
                          {m.user_id === user?.id && <span className="font-body text-xs px-1 rounded" style={{ color: "#a78bfa" }}>you</span>}
                          {badges}
                          {m.live_room_id && <LiveDot />}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {m.questions_attempted > 0 ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <AccuracyBar pct={acc} />
                                <span className="font-body text-xs tabular-nums"
                                  style={{ color: acc >= 75 ? "#00ff87" : acc >= 50 ? "#a78bfa" : "#8888aa" }}>
                                  {acc}%
                                </span>
                              </div>
                              <span className="font-body text-xs tabular-nums" style={{ color: "#555577" }}>
                                {gPlayed}{totalGames > 0 ? `/${totalGames}` : ""} games
                              </span>
                            </>
                          ) : (
                            <span className="font-body text-xs text-text-muted">No games yet</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {sortBy === "form" ? (
                          <>
                            <p className="font-display text-lg leading-none" style={{ color: i === 0 ? "#00ff87" : "white" }}>
                              {formScore.toLocaleString()}
                            </p>
                            <p className="font-body text-xs mt-0.5" style={{ color: "#555577" }}>last 5</p>
                          </>
                        ) : (
                          <>
                            <p className="font-display text-lg leading-none" style={{ color: i === 0 ? "#a78bfa" : "white" }}>
                              {m.total_score.toLocaleString()}
                            </p>
                            <p className="font-body text-xs text-text-muted mt-0.5">pts</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Members tab */}
        {tab === "live" && (
          <div className="space-y-3">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                style={{ background: "#12121e", border: `1px solid ${m.live_room_id ? "rgba(0,255,135,0.15)" : "rgba(255,255,255,0.07)"}` }}>
                <AvatarCircle name={m.display_name} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-body text-sm font-semibold text-white">{m.display_name}</p>
                    {m.user_id === user?.id && <span className="font-body text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa" }}>you</span>}
                  </div>
                  {m.live_room_id ? (
                    <p className="font-body text-xs mt-0.5" style={{ color: "#00ff87" }}>⚡ {m.live_match_label}</p>
                  ) : (
                    <p className="font-body text-xs text-text-muted mt-0.5">
                      {m.total_score > 0
                        ? `${m.total_score.toLocaleString()} pts · ${accuracy(m.questions_correct, m.questions_attempted)}% accuracy`
                        : "No games played yet"}
                    </p>
                  )}
                </div>
                {m.live_room_id ? (
                  <Link href={`/room/${m.live_room_id}`}
                    className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
                    style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}>
                    Watch
                  </Link>
                ) : (
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.15)" }} />
                )}
              </div>
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
          <div className="space-y-3">
            <p className="font-body text-xs text-text-muted uppercase tracking-widest">Upcoming matches — create a room for your group</p>
            {MOCK_MATCHES.slice(0, 8).map((match) => (
              <Link key={match.id} href={`/room/new?match=${match.id}`}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-opacity hover:opacity-80"
                style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="text-xl">{match.flag_home}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-medium text-white">
                    {match.home_team} <span className="text-text-muted font-normal">vs</span> {match.away_team}
                  </p>
                  <p className="font-body text-xs text-text-muted">{formatMatchDate(match.match_date)}</p>
                </div>
                <span className="text-xl">{match.flag_away}</span>
                <span className="font-body text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                  style={{ background: "rgba(0,255,135,0.08)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.15)" }}>
                  + Room
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* Invite code card */}
        <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.12)" }}>
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-0.5">Invite code</p>
            <p className="font-display text-2xl tracking-widest" style={{ color: "#a78bfa" }}>{league.code}</p>
          </div>
          <button onClick={copyInvite}
            className="font-body text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:opacity-80"
            style={{ background: copied ? "rgba(167,139,250,0.2)" : "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
            {copied ? "✓ Copied" : "Copy invite link"}
          </button>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
