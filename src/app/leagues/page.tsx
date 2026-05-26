/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { AuthProviders } from "@/components/auth/AuthButton";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";

interface LeagueCard {
  id: string;
  name: string;
  description: string | null;
  code: string;
  member_count: number;
  my_score: number;
  my_rank: number | null;
}

interface GlobalPlayer {
  id: string;
  display_name: string | null;
  total_score: number;
  games_played: number;
}

function rankStyle(rank: number) {
  if (rank === 1) return { color: "#ffd700", bg: "rgba(255,215,0,0.12)", border: "rgba(255,215,0,0.28)", bar: "#ffd700" };
  if (rank === 2) return { color: "#c0c0c0", bg: "rgba(192,192,192,0.1)", border: "rgba(192,192,192,0.22)", bar: "#c0c0c0" };
  if (rank === 3) return { color: "#e8945a", bg: "rgba(232,148,90,0.1)", border: "rgba(232,148,90,0.22)", bar: "#e8945a" };
  return { color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.2)", bar: "#a78bfa" };
}

function playerInitial(name: string | null) {
  return (name ?? "?")[0].toUpperCase();
}

function playerColor(name: string | null) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const n = name ?? "?";
  return palettes[n.charCodeAt(0) % palettes.length];
}

export default function LeaguesPage() {
  const { user, loading: userLoading } = useUser();
  const [tab, setTab] = useState<"mine" | "global">("mine");
  const [leagues, setLeagues] = useState<LeagueCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalPlayers, setGlobalPlayers] = useState<GlobalPlayer[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalFetched, setGlobalFetched] = useState(false);

  useEffect(() => {
    if (userLoading) return;
    if (!user) { setLoading(false); return; }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setLoading(false); return; }

    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();

      const { data: memberships } = await (sb as any)
        .from("league_members")
        .select("league_id, total_score, leagues(id, name, description, code)")
        .eq("user_id", user.id)
        .order("total_score", { ascending: false });

      if (!memberships?.length) { setLoading(false); return; }

      const cards: LeagueCard[] = await Promise.all(
        memberships.map(async (row: any) => {
          const league = row.leagues;
          const { count } = await (sb as any)
            .from("league_members")
            .select("*", { count: "exact", head: true })
            .eq("league_id", league.id);

          const { count: above } = await (sb as any)
            .from("league_members")
            .select("*", { count: "exact", head: true })
            .eq("league_id", league.id)
            .gt("total_score", row.total_score ?? 0);

          return {
            id: league.id,
            name: league.name,
            description: league.description,
            code: league.code,
            member_count: count ?? 0,
            my_score: row.total_score ?? 0,
            my_rank: (above ?? 0) + 1,
          };
        })
      );

      setLeagues(cards);
      setLoading(false);
    });
  }, [user, userLoading]);

  // Lazy-load global tab data on first switch
  useEffect(() => {
    if (tab !== "global" || globalFetched || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    setGlobalLoading(true);
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();
      const { data } = await sb
        .from("profiles")
        .select("id, display_name, total_score, games_played")
        .order("total_score", { ascending: false })
        .limit(100);
      setGlobalPlayers((data ?? []) as GlobalPlayer[]);
      setGlobalFetched(true);
      setGlobalLoading(false);
    });
  }, [tab, globalFetched]);

  const bestRank = leagues.reduce<number | null>((best, l) => {
    if (l.my_rank === null) return best;
    return best === null ? l.my_rank : Math.min(best, l.my_rank);
  }, null);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)",
        backgroundSize: "40px 40px",
      }} />
      <div className="fixed top-0 right-0 w-[400px] h-[400px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 100% 0%, rgba(167,139,250,0.07) 0%, transparent 60%)" }} />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
        <span className="font-display text-2xl text-white tracking-wider">Leagues</span>
        {user && (
          <Link href="/league/new"
            className="flex items-center gap-1.5 font-body text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:opacity-90"
            style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New league
          </Link>
        )}
      </nav>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4">

        {/* Not signed in */}
        {!userLoading && !user && (
          <div>
            <div className="rounded-2xl p-6 mb-4"
              style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}>
              <p className="font-display text-2xl text-white mb-1">Your leagues live here</p>
              <p className="font-body text-sm mb-5" style={{ color: "#8888aa" }}>
                Sign in to create a league, invite your mates, and track your score all season.
              </p>
              <AuthProviders />
            </div>
          </div>
        )}

        {/* Tabs — only shown when signed in */}
        {user && !userLoading && (
          <div className="flex gap-2 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <button
              onClick={() => setTab("mine")}
              className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold transition-all"
              style={tab === "mine"
                ? { background: "#a78bfa", color: "#0a0a0f" }
                : { background: "transparent", color: "#8888aa" }
              }
            >
              My Leagues
            </button>
            <button
              onClick={() => setTab("global")}
              className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold transition-all"
              style={tab === "global"
                ? { background: "#a78bfa", color: "#0a0a0f" }
                : { background: "transparent", color: "#8888aa" }
              }
            >
              Global
            </button>
          </div>
        )}

        {/* ─── MY LEAGUES TAB ─── */}
        {(!user || tab === "mine") && (
          <>
            {/* Loading */}
            {loading && user && (
              <div className="flex items-center justify-center py-16">
                <Spinner size={28} />
              </div>
            )}

            {/* Summary hero */}
            {!loading && user && leagues.length > 0 && (
              <div className="rounded-2xl px-5 py-4"
                style={{
                  background: "linear-gradient(135deg, rgba(167,139,250,0.1) 0%, rgba(167,139,250,0.04) 100%)",
                  border: "1px solid rgba(167,139,250,0.18)",
                }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-body text-xs uppercase tracking-widest mb-1.5" style={{ color: "#8888aa" }}>
                      Your leagues
                    </p>
                    <p className="font-display text-5xl text-white leading-none">{leagues.length}</p>
                    <p className="font-body text-xs mt-1" style={{ color: "#8888aa" }}>
                      {leagues.length === 1 ? "league" : "leagues"} joined
                    </p>
                  </div>
                  {bestRank !== null && (
                    <div className="text-right">
                      <p className="font-body text-xs uppercase tracking-widest mb-1.5" style={{ color: "#8888aa" }}>
                        Best rank
                      </p>
                      <p className="font-display text-5xl leading-none"
                        style={{ color: bestRank === 1 ? "#ffd700" : bestRank <= 3 ? "#e8945a" : "#a78bfa" }}>
                        #{bestRank}
                      </p>
                      {bestRank === 1 && <p className="font-body text-xs mt-1" style={{ color: "#ffd700" }}>👑 leading</p>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* League cards */}
            {!loading && user && leagues.length > 0 && (
              <div className="space-y-3">
                {leagues.map((league) => {
                  const rankNum = league.my_rank ?? league.member_count;
                  const pct = league.member_count > 1
                    ? Math.round(((league.member_count - rankNum) / (league.member_count - 1)) * 100)
                    : 100;
                  const rs = rankStyle(rankNum);
                  const isLeading = rankNum === 1;
                  const gapFromTop = league.member_count > 1 && !isLeading ? `#${rankNum} of ${league.member_count}` : null;

                  return (
                    <Link key={league.id} href={`/league/${league.id}`}
                      className="block rounded-2xl overflow-hidden transition-opacity hover:opacity-90 active:scale-[0.99]"
                      style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>

                      <div className="px-5 pt-5 pb-4">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                                style={{ background: rs.bg, border: `1px solid ${rs.border}` }}>
                                <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                                  <path d="M3 2h8v3L7 8l-4-3z" stroke={rs.color} strokeWidth="1.4" strokeLinejoin="round" />
                                  <path d="M4 5v5a3 3 0 0 0 6 0V5" stroke={rs.color} strokeWidth="1.4" strokeLinecap="round" />
                                </svg>
                              </div>
                              <p className="font-body text-base font-bold text-white truncate">{league.name}</p>
                              {isLeading && <span className="text-sm flex-shrink-0">👑</span>}
                            </div>
                            {league.description && (
                              <p className="font-body text-xs truncate mb-1" style={{ color: "#8888aa" }}>
                                {league.description}
                              </p>
                            )}
                            <p className="font-body text-xs" style={{ color: "#444466" }}>
                              {league.member_count} {league.member_count === 1 ? "member" : "members"}
                            </p>
                          </div>

                          {/* Rank badge */}
                          <div className="flex-shrink-0 rounded-2xl px-4 py-3 text-center"
                            style={{ background: rs.bg, border: `1px solid ${rs.border}`, minWidth: 68 }}>
                            <p className="font-display text-3xl leading-none" style={{ color: rs.color }}>
                              #{rankNum}
                            </p>
                            <p className="font-body text-xs mt-1" style={{ color: rs.color, opacity: 0.6 }}>
                              of {league.member_count}
                            </p>
                          </div>
                        </div>

                        {/* Score + progress bar */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="font-body text-xs" style={{ color: "#555577" }}>
                              {isLeading ? "🏆 Leading the table" : gapFromTop ?? ""}
                            </p>
                            <p className="font-display text-lg" style={{ color: rs.color }}>
                              {league.my_score.toLocaleString()} <span className="font-body text-xs" style={{ color: "#555577" }}>pts</span>
                            </p>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                            <div className="h-full rounded-full"
                              style={{
                                width: `${Math.max(3, pct)}%`,
                                background: `linear-gradient(90deg, ${rs.bar}55, ${rs.bar})`,
                                transition: "width 0.6s ease-out",
                              }} />
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {!loading && user && leagues.length === 0 && (
              <div className="rounded-2xl p-8 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="font-display text-4xl mb-3">🏆</p>
                <p className="font-display text-2xl text-white mb-2">No leagues yet</p>
                <p className="font-body text-sm mb-6" style={{ color: "#8888aa" }}>
                  Create a league and invite your mates — your points stack across every match all season.
                </p>
                <Link href="/league/new"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-body font-bold text-sm transition-all hover:opacity-90"
                  style={{ background: "#a78bfa", color: "#0a0a0f" }}>
                  Create your first league →
                </Link>
              </div>
            )}

            {/* Create new league nudge */}
            {!loading && user && leagues.length > 0 && (
              <Link href="/league/new"
                className="flex items-center justify-between px-5 py-4 rounded-2xl transition-all hover:opacity-80"
                style={{ background: "rgba(167,139,250,0.05)", border: "1px dashed rgba(167,139,250,0.2)" }}>
                <div>
                  <p className="font-body text-sm font-semibold text-white">Start another league</p>
                  <p className="font-body text-xs" style={{ color: "#8888aa" }}>Different crew? Create as many as you like</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "#a78bfa", flexShrink: 0 }}>
                  <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </Link>
            )}
          </>
        )}

        {/* ─── GLOBAL TAB ─── */}
        {user && tab === "global" && (
          <>
            {globalLoading && (
              <div className="flex items-center justify-center py-16">
                <Spinner size={28} />
              </div>
            )}

            {!globalLoading && globalPlayers.length === 0 && (
              <div className="rounded-2xl p-8 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="font-display text-3xl mb-3">🌍</p>
                <p className="font-body text-sm" style={{ color: "#8888aa" }}>No players yet. Be the first to score.</p>
              </div>
            )}

            {!globalLoading && globalPlayers.length > 0 && (
              <div>
                {/* Top 3 podium strip */}
                {globalPlayers.length >= 3 && (
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[1, 0, 2].map((idx) => {
                      const p = globalPlayers[idx];

                      const isMe = user && p.id === user.id;
                      const colors = [
                        { medal: "#ffd700", bg: "rgba(255,215,0,0.1)", border: "rgba(255,215,0,0.25)" },
                        { medal: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.25)" },
                        { medal: "#e8945a", bg: "rgba(232,148,90,0.1)", border: "rgba(232,148,90,0.2)" },
                      ];
                      // visual order: 2nd | 1st | 3rd
                      const visualPos = [2, 1, 3][idx];
                      const c = colors[visualPos - 1];
                      const pal = playerColor(p.display_name);
                      return (
                        <div key={p.id}
                          className="rounded-2xl px-3 py-4 flex flex-col items-center gap-2 text-center"
                          style={{
                            background: isMe ? "rgba(0,255,135,0.07)" : c.bg,
                            border: `1px solid ${isMe ? "rgba(0,255,135,0.25)" : c.border}`,
                            order: idx === 0 ? 1 : idx === 1 ? 0 : 2,
                            marginTop: visualPos === 1 ? 0 : 12,
                          }}>
                          <div className="w-10 h-10 rounded-full flex items-center justify-center font-body font-bold text-base"
                            style={{ background: pal.bg, color: pal.text, border: "2px solid rgba(255,255,255,0.08)" }}>
                            {playerInitial(p.display_name)}
                          </div>
                          <p className="font-body text-xs font-semibold text-white truncate w-full">
                            {p.display_name ?? "Player"}
                            {isMe && <span style={{ color: "#00ff87" }}> (you)</span>}
                          </p>
                          <p className="font-display text-lg leading-none" style={{ color: c.medal }}>#{visualPos}</p>
                          <p className="font-body text-xs" style={{ color: "#8888aa" }}>{p.total_score.toLocaleString()} pts</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Full ranked list */}
                <div className="space-y-1.5">
                  {globalPlayers.map((p, i) => {
                    const rank = i + 1;
                    const isMe = user && p.id === user.id;
                    const rs = rankStyle(rank);
                    return (
                      <div key={p.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                        style={{
                          background: isMe ? "rgba(0,255,135,0.06)" : "#12121e",
                          border: `1px solid ${isMe ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.06)"}`,
                        }}>
                        {/* Rank */}
                        <div className="w-8 text-center flex-shrink-0">
                          {rank <= 3 ? (
                            <span className="text-base">{["🥇","🥈","🥉"][rank-1]}</span>
                          ) : (
                            <span className="font-display text-sm" style={{ color: rs.color }}>#{rank}</span>
                          )}
                        </div>
                        {/* Avatar */}
                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
                          style={{ background: playerColor(p.display_name).bg, color: playerColor(p.display_name).text, border: "1px solid rgba(255,255,255,0.07)" }}>
                          {playerInitial(p.display_name)}
                        </div>
                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className="font-body text-sm font-medium text-white truncate">
                            {p.display_name ?? "Player"}
                            {isMe && <span className="font-normal ml-1.5" style={{ color: "#00ff87", fontSize: "0.7rem" }}>you</span>}
                          </p>
                          <p className="font-body text-xs" style={{ color: "#555577" }}>{p.games_played} games</p>
                        </div>
                        {/* Score */}
                        <p className="font-display text-lg flex-shrink-0" style={{ color: isMe ? "#00ff87" : rank <= 3 ? rs.color : "#8888aa" }}>
                          {p.total_score.toLocaleString()}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
