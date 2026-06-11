"use client";

/**
 * /leaderboard — the unified YourScore Rank board.
 * One headline rank (blended Match + Knowledge) with a Global / Friends toggle.
 * Data: get_yourscore_leaderboard RPC (migration 26). Global = all players;
 * Friends = your accepted friendships + you.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { AuthProviders } from "@/components/auth/AuthButton";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";
import { GridBackground } from "@/components/ui/GridBackground";

type Scope = "global" | "friends";

interface RankRow {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  match_score: number;
  knowledge_score: number;
  overall_score: number;
  overall_rank: number;
  tier: string;
  wins: number;
  draws: number;
  losses: number;
}

function tierColor(tier: string | null): string {
  switch (tier) {
    case "Elite": return "#00ff87";
    case "Diamond": return "#a78bfa";
    case "Platinum": return "#67e8f9";
    case "Gold": return "#ffd700";
    case "Silver": return "#c0c0c0";
    default: return "#b08d57";
  }
}

function playerInitial(name: string | null) { return (name ?? "?")[0].toUpperCase(); }
function playerColor(name: string | null) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const n = name ?? "?";
  return palettes[n.charCodeAt(0) % palettes.length];
}

export default function LeaderboardPage() {
  const { user, loading: userLoading } = useUser();
  const [scope, setScope] = useState<Scope>("global");
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userLoading) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any;
      let userIds: string[] | null = null;
      if (scope === "friends") {
        if (!user) { if (!cancelled) { setRows([]); setLoading(false); } return; }
        const { data: fr } = await sb
          .from("friendships")
          .select("user_id, friend_id, status")
          .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
          .eq("status", "accepted");
        const ids = new Set<string>([user.id]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fr ?? []).forEach((r: any) => { ids.add(r.user_id); ids.add(r.friend_id); });
        userIds = Array.from(ids);
      }
      const { data } = await sb.rpc("get_yourscore_leaderboard", { p_user_ids: userIds, p_limit: 100 });
      if (!cancelled) { setRows((data ?? []) as RankRow[]); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [scope, user, userLoading]);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.025} />
      <div className="fixed top-0 right-0 w-[400px] h-[400px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 100% 0%, rgba(167,139,250,0.07) 0%, transparent 60%)" }} />

      {/* Header */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <nav className="flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          <span className="font-display text-2xl text-white tracking-wider">Rankings</span>
        </nav>
        <div className="px-5 pb-3 max-w-lg mx-auto">
          <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {([["global", "Global 🌍"] as const, ["friends", "Friends 🤝"] as const]).map(([key, label]) => (
              <button key={key} onClick={() => setScope(key)}
                className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold transition-all"
                style={scope === key ? { background: "#a78bfa", color: "#0a0a0f" } : { background: "transparent", color: "#8888aa" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-4 space-y-4">
        <p className="font-body text-xs text-text-muted text-center">
          YourScore Rank blends your <span style={{ color: "#ffb800" }}>Knowledge</span> (quizzes) and <span style={{ color: "#00ff87" }}>Match</span> (38-0) tracks.
        </p>

        {/* Friends, signed out */}
        {scope === "friends" && !user && !userLoading && (
          <div className="rounded-2xl p-6" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}>
            <p className="font-display text-2xl text-white mb-1">See how you rank vs your mates</p>
            <p className="font-body text-sm mb-5 text-text-muted">Sign in to compare your YourScore Rank with your friends.</p>
            <AuthProviders />
          </div>
        )}

        {loading && <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>}

        {!loading && rows.length === 0 && (scope === "global" || user) && (
          <div className="rounded-2xl p-8 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-3xl mb-3">{scope === "friends" ? "🤝" : "🌍"}</p>
            <p className="font-body text-sm text-text-muted">
              {scope === "friends" ? "No ranked friends yet. Add mates, then climb past them." : "No ranked players yet. Be the first."}
            </p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-1.5">
            {rows.map((p, i) => {
              const pos = i + 1;
              const isMe = !!user && p.user_id === user.id;
              const tc = tierColor(p.tier);
              const pal = playerColor(p.display_name);
              return (
                <Link key={p.user_id} href={`/profile/${p.user_id}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-opacity hover:opacity-80"
                  style={{ background: isMe ? "rgba(0,255,135,0.06)" : "#12121e", border: `1px solid ${isMe ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.06)"}` }}>
                  <div className="w-7 text-center flex-shrink-0">
                    {pos <= 3 ? <span className="text-base">{["🥇", "🥈", "🥉"][pos - 1]}</span>
                      : <span className="font-display text-sm" style={{ color: "#8888aa" }}>#{pos}</span>}
                  </div>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
                    style={{ background: pal.bg, color: pal.text, border: "1px solid rgba(255,255,255,0.07)" }}>
                    {playerInitial(p.display_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm font-medium text-white truncate">
                      {p.display_name ?? "Player"}
                      {isMe && <span className="font-normal ml-1.5 text-green" style={{ fontSize: "0.7rem" }}>you</span>}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-body" style={{ fontSize: "0.68rem", color: tc }}>{p.tier}</span>
                      <span className="font-body text-text-muted" style={{ fontSize: "0.68rem" }}>
                        🧠 {p.knowledge_score.toLocaleString()} · ⚽ {p.match_score.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <p className="font-display text-lg flex-shrink-0" style={{ color: isMe ? "#00ff87" : tc }}>
                    {p.overall_score}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
