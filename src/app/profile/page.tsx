/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";

interface ProfileStats {
  display_name: string;
  total_score: number;
  games_played: number;
}

interface RoomHistory {
  room_id: string;
  room_name: string;
  total_score: number;
  correct_answers: number;
  total_answers: number;
  best_streak: number;
  rank: number;
  match_label: string;
}

function AvatarCircle({ name, size = 64 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[name.charCodeAt(0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "2px solid rgba(255,255,255,0.1)" }}>
      {name[0].toUpperCase()}
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading } = useUser();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [history, setHistory] = useState<RoomHistory[]>([]);
  const [globalRank, setGlobalRank] = useState<number | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setDataLoading(false);
      return;
    }
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      Promise.all([
        supabase.from("profiles").select("display_name, total_score, games_played").eq("id", user.id).single(),
        supabase.from("room_scores")
          .select("room_id, total_score, correct_answers, total_answers, best_streak, rank, rooms(name, matches(home_team, away_team))")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(20),
      ]).then(([{ data: p }, { data: h }]) => {
        if (p) {
          setStats(p as ProfileStats);
          (supabase as any).from("profiles")
            .select("*", { count: "exact", head: true })
            .gt("total_score", (p as any).total_score ?? 0)
            .then(({ count }: any) => setGlobalRank((count ?? 0) + 1));
        }
        if (h?.length) {
          setHistory(h.map((s: any) => ({
            room_id: s.room_id,
            room_name: s.rooms?.name ?? "Room",
            total_score: s.total_score,
            correct_answers: s.correct_answers,
            total_answers: s.total_answers,
            best_streak: s.best_streak,
            rank: s.rank ?? 0,
            match_label: s.rooms?.matches
              ? `${s.rooms.matches.home_team} vs ${s.rooms.matches.away_team}`
              : "",
          })));
        }
        setDataLoading(false);
      });
    });
  }, [user, loading]);

  if (loading || dataLoading) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center">
        <Spinner size={32} />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="font-body text-text-muted">Sign in to see your profile.</p>
          <Link href="/" className="font-body text-sm font-semibold" style={{ color: "#00ff87" }}>← Home</Link>
        </div>
      </main>
    );
  }

  const name = stats?.display_name || user.email?.split("@")[0] || "Player";
  const totalCorrect = history.reduce((a, r) => a + r.correct_answers, 0);
  const totalAnswers = history.reduce((a, r) => a + r.total_answers, 0);
  const overallAccuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;
  const bestStreak = Math.max(...history.map((r) => r.best_streak), 0);
  const avgRank = history.length > 0 ? Math.round(history.reduce((a, r) => a + r.rank, 0) / history.length) : 0;

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* Header */}
      <div className="sticky top-0 z-10" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
          <Link href="/" className="font-body text-xs text-text-muted hover:text-white transition-colors">← Home</Link>
          <p className="font-body text-xs font-semibold text-white">Profile</p>
          <Link href="/settings" className="font-body text-xs font-semibold transition-colors" style={{ color: "#00ff87" }}>
            Edit
          </Link>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-8 space-y-5">
        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          <AvatarCircle name={name} size={64} />
          <div className="flex-1 min-w-0">
            <p className="font-display text-3xl text-white tracking-wide truncate">{name.toUpperCase()}</p>
            <p className="font-body text-xs text-text-muted mt-0.5">{user.email}</p>
            <p className="font-body text-xs text-text-muted">{stats?.games_played ?? 0} games played</p>
          </div>
        </div>

        {/* Global rank */}
        {globalRank !== null && (
          <div className="rounded-2xl px-5 py-4"
            style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-1.5">Global ranking</p>
            <div className="flex items-end justify-between">
              <p className="font-display text-5xl leading-none" style={{ color: "#a78bfa" }}>#{globalRank}</p>
              <p className="font-body text-xs text-text-muted">out of all players</p>
            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "Total score", value: (stats?.total_score ?? 0).toLocaleString(), color: "#00ff87" },
            { label: "Avg rank", value: avgRank > 0 ? `#${avgRank}` : "—", color: "#ffffff" },
            { label: "Accuracy", value: `${overallAccuracy}%`, color: overallAccuracy >= 70 ? "#00ff87" : overallAccuracy >= 50 ? "#ffb800" : "#ff4757" },
            { label: "Best streak", value: `×${bestStreak}`, color: "#ffb800" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl px-5 py-4" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-display text-3xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="font-body text-xs text-text-muted mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Room history */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recent games</p>
          {history.length === 0 ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-body text-sm text-text-muted mb-3">No games yet.</p>
              <Link href="/room/new" className="font-body text-sm font-semibold" style={{ color: "#00ff87" }}>
                Create your first room →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((r) => {
                const acc = r.total_answers > 0 ? Math.round((r.correct_answers / r.total_answers) * 100) : 0;
                return (
                  <Link key={r.room_id} href={`/room/${r.room_id}/results`}
                    className="flex items-center gap-4 px-5 py-4 rounded-2xl hover:opacity-90 transition-opacity"
                    style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center font-display text-base flex-shrink-0"
                      style={{ background: r.rank === 1 ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.05)", color: r.rank === 1 ? "#ffd700" : "#8888aa", border: `1px solid ${r.rank === 1 ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.08)"}` }}>
                      #{r.rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white truncate">{r.room_name}</p>
                      <p className="font-body text-xs text-text-muted truncate">{r.match_label} · {acc}% accuracy</p>
                    </div>
                    <p className="font-display text-xl flex-shrink-0" style={{ color: "#00ff87" }}>{r.total_score.toLocaleString()}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Settings link */}
        <Link href="/settings" className="flex items-center justify-between px-5 py-4 rounded-2xl transition-opacity hover:opacity-80"
          style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
          <span className="font-body text-sm text-white">Settings</span>
          <span className="font-body text-xs text-text-muted">Edit name, sign out →</span>
        </Link>
      </div>

      <BottomNav />
    </main>
  );
}
