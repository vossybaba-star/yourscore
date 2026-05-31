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
  avatar_url?: string | null;
}

function AvatarCircle({ name, size = 64, avatarUrl }: { name: string; size?: number; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={name} className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, border: "2px solid rgba(255,255,255,0.1)" }} />
    );
  }
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[name.charCodeAt(0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "2px solid rgba(255,255,255,0.1)" }}>
      {name[0].toUpperCase()}
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading } = useUser();
  const [stats, setStats] = useState<ProfileStats | null>(null);
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
      supabase.from("profiles").select("display_name, total_score, games_played, avatar_url").eq("id", user.id).single()
        .then(({ data: p }) => {
          if (p) {
            setStats(p as ProfileStats);
            (supabase as any).from("profiles")
              .select("*", { count: "exact", head: true })
              .gt("total_score", (p as any).total_score ?? 0)
              .then(({ count }: any) => setGlobalRank((count ?? 0) + 1));
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
          <Link href="/auth/sign-in" className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-body font-bold text-sm transition-all"
            style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.28)" }}>
            Sign in →
          </Link>
        </div>
      </main>
    );
  }

  const name = stats?.display_name || user.email?.split("@")[0] || "Player";

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* Sticky profile header */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="max-w-lg mx-auto px-5 py-4">
          <div className="flex items-center gap-4">
            <AvatarCircle name={name} size={56} avatarUrl={stats?.avatar_url} />
            <div className="flex-1 min-w-0">
              <p className="font-display text-2xl text-white tracking-wide truncate">{name.toUpperCase()}</p>
              <p className="font-body text-xs text-text-muted mt-0.5 truncate">{user.email}</p>
              <p className="font-body text-xs text-text-muted">{stats?.games_played ?? 0} games played</p>
            </div>
            <Link href="/settings" aria-label="Edit profile"
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-80"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#8888aa" }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M10.5 2.5l2 2L5 12H3v-2L10.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-5">

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
            { label: "Avg rank", value: "—", color: "#ffffff" },
            { label: "Accuracy", value: "—", color: "#ffffff" },
            { label: "Best streak", value: "—", color: "#ffb800" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl px-5 py-4" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-display text-3xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="font-body text-xs text-text-muted mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Recent games placeholder */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recent games</p>
          <div className="rounded-2xl p-6 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-body text-sm text-text-muted mb-3">No recent games.</p>
            <Link href="/league/join" className="font-body text-sm font-semibold" style={{ color: "#00ff87" }}>
              Join a league →
            </Link>
          </div>
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
