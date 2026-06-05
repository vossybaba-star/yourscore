"use client";

import { useState, useEffect } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";

interface PublicProfile {
  id: string;
  display_name: string | null;
  total_score: number;
  games_played: number;
  avatar_url: string | null;
}

interface RecentAttempt {
  id: string;
  score: number;
  max_score: number;
  completed_at: string;
  pack_name: string | null;
}

function AvatarCircle({ name, size = 72, avatarUrl }: { name: string; size?: number; avatarUrl?: string | null }) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt={name} className="rounded-full object-cover flex-shrink-0"
      style={{ width: size, height: size, border: "2px solid rgba(255,255,255,0.1)" }} />;
  }
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "2px solid rgba(255,255,255,0.1)" }}>
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

export default function PublicProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useUser();
  const userId = params.userId as string;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [globalRank, setGlobalRank] = useState<number | null>(null);
  const [leagueCount, setLeagueCount] = useState(0);
  const [attempts, setAttempts] = useState<RecentAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  // Redirect own profile to the personal profile page
  useEffect(() => {
    if (user && user.id === userId) {
      router.replace("/profile");
    }
  }, [user, userId, router]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setLoading(false); return; }
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();

      // Fetch profile
      const { data: p } = await sb
        .from("profiles")
        .select("id, display_name, total_score, games_played, avatar_url")
        .eq("id", userId)
        .single();

      if (!p) { setLoading(false); return; }
      setProfile({
        id: p.id,
        display_name: p.display_name,
        total_score: p.total_score ?? 0,
        games_played: p.games_played ?? 0,
        avatar_url: p.avatar_url,
      });

      // Global rank
      const { count: above } = await sb
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .gt("total_score", p.total_score ?? 0);
      setGlobalRank((above ?? 0) + 1);

      // League count
      const { count: leagues } = await sb
        .from("league_members")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      setLeagueCount(leagues ?? 0);

      // Recent quiz attempts with pack name
      const { data: att } = await sb
        .from("quiz_attempts")
        .select("id, score, max_score, completed_at, pack_id")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false })
        .limit(10);

      if (att?.length) {
        const packIdSet = new Set<string>(att.map((a) => a.pack_id).filter(Boolean));
        const packIds = Array.from(packIdSet);
        const packNames: Record<string, string> = {};
        if (packIds.length > 0) {
          const { data: packs } = await sb.from("quiz_packs").select("id, name").in("id", packIds);
          (packs ?? []).forEach((pk) => { packNames[pk.id] = pk.name; });
        }
        setAttempts(att.map((a) => ({
          id: a.id,
          score: a.score,
          max_score: a.max_score,
          completed_at: a.completed_at,
          pack_name: packNames[a.pack_id] ?? null,
        })));
      }

      setLoading(false);
    });
  }, [userId]);

  if (loading) {
    return <main className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></main>;
  }

  if (!profile) {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-6 gap-4">
        <p className="font-display text-5xl">🤔</p>
        <p className="font-display text-2xl text-white">Player not found</p>
        <Link href="/leagues" className="font-body text-sm" style={{ color: "#a78bfa" }}>← Leaderboard</Link>
      </main>
    );
  }

  const name = profile.display_name ?? "Player";
  const avgAcc = attempts.length > 0
    ? Math.round(attempts.reduce((s, a) => s + (a.max_score > 0 ? a.score / a.max_score : 0), 0) / attempts.length * 100)
    : null;

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.02} />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
        <button onClick={() => router.back()}
          className="flex items-center gap-2 font-body text-sm transition-opacity hover:opacity-70 text-text-muted">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <span className="font-body text-xs px-3 py-1 rounded-full"
          style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
          Player Profile
        </span>
      </nav>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-5">

        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          <AvatarCircle name={name} size={72} avatarUrl={profile.avatar_url} />
          <div className="flex-1 min-w-0">
            <p className="font-display text-3xl text-white tracking-wide truncate">{name.toUpperCase()}</p>
            {globalRank !== null && (
              <div className="flex items-center gap-2 mt-1">
                <span className="font-body text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
                  #{globalRank} global
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "Total score", value: (profile.total_score ?? 0).toLocaleString(), color: "#00ff87" },
            { label: "Games played", value: String(profile.games_played ?? 0), color: "#ffffff" },
            { label: "Leagues", value: String(leagueCount), color: "#a78bfa" },
            { label: "Avg accuracy", value: avgAcc !== null ? `${avgAcc}%` : "—", color: "#ffb800" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl px-5 py-4 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-display text-3xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="font-body text-xs text-text-muted mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Recent games */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recent challenges</p>
          {attempts.length === 0 ? (
            <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-body text-sm text-text-muted">No challenges played yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {attempts.map(a => {
                const pct = a.max_score > 0 ? Math.round(a.score / a.max_score * 100) : 0;
                const pctColor = pct >= 80 ? "#00ff87" : pct >= 50 ? "#ffb800" : "#f87171";
                const date = new Date(a.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white truncate">
                        {a.pack_name ?? "Challenge"}
                      </p>
                      <p className="font-body text-xs" style={{ color: "#555577" }}>{date}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-display text-lg leading-none" style={{ color: pctColor }}>{pct}%</p>
                      <p className="font-body text-xs" style={{ color: "#555577" }}>
                        {a.score}/{a.max_score} pts
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
