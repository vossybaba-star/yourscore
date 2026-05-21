/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";

const WORLD_CUP_START = new Date("2026-06-11T18:00:00Z");

// ── Animations ────────────────────────────────────────────────────────────────

const ANIM_CSS = `
  @keyframes floatCard {
    0%, 100% { transform: translateY(0px) rotate(-1deg); }
    50% { transform: translateY(-10px) rotate(-1deg); }
  }
  @keyframes floatCard2 {
    0%, 100% { transform: translateY(0px) rotate(0.5deg); }
    50% { transform: translateY(-6px) rotate(0.5deg); }
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 28px rgba(167,139,250,0.35), 0 0 60px rgba(167,139,250,0.12); }
    50% { box-shadow: 0 0 40px rgba(167,139,250,0.55), 0 0 80px rgba(167,139,250,0.2); }
  }
  @keyframes scoreUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes greenPulse {
    0%, 100% { box-shadow: 0 0 20px rgba(0,255,135,0.3); }
    50% { box-shadow: 0 0 35px rgba(0,255,135,0.55); }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  .float-card { animation: floatCard 5s ease-in-out infinite; }
  .float-card-2 { animation: floatCard2 6s ease-in-out infinite 1s; }
  .pulse-glow { animation: pulseGlow 3s ease-in-out infinite; }
  .green-pulse { animation: greenPulse 3s ease-in-out infinite; }
  .score-in { animation: scoreUp 0.4s ease-out forwards; }
`;

// ── World Cup countdown ───────────────────────────────────────────────────────

function WorldCupCountdown() {
  const [diff, setDiff] = useState<number | null>(null);

  useEffect(() => {
    setDiff(WORLD_CUP_START.getTime() - Date.now());
    const iv = setInterval(() => setDiff(WORLD_CUP_START.getTime() - Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (diff === null) return null;
  if (diff <= 0) return <span className="font-display text-3xl" style={{ color: "#00ff87" }}>THE CUP IS LIVE</span>;

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);

  return (
    <div className="flex items-end justify-center gap-4 sm:gap-6">
      {[{ v: days, l: "days" }, { v: hours, l: "hrs" }, { v: mins, l: "min" }, { v: secs, l: "sec" }].map(({ v, l }) => (
        <div key={l} className="text-center">
          <p className="font-display text-4xl sm:text-5xl text-white leading-none tabular-nums">{String(v).padStart(2, "0")}</p>
          <p className="font-body text-xs text-text-muted mt-1 uppercase tracking-widest">{l}</p>
        </div>
      ))}
    </div>
  );
}

// ── Animated league card (hero visual) ───────────────────────────────────────

const LEAGUE_PLAYERS = [
  { name: "Marcus", flag: "🇧🇷", pts: 2840, streak: 4, acc: 91 },
  { name: "Priya",  flag: "🇮🇳", pts: 2720, streak: 2, acc: 87 },
  { name: "Jamie",  flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", pts: 2650, streak: 0, acc: 83 },
  { name: "Zach",   flag: "🇳🇬", pts: 2590, streak: 1, acc: 80 },
];

const PALETTES = [
  { bg: "#1a2f4a", text: "#60a5fa" },
  { bg: "#2a1a4a", text: "#a78bfa" },
  { bg: "#1a4a2a", text: "#4ade80" },
  { bg: "#4a2a1a", text: "#fb923c" },
];

function LeagueHeroCard() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 3200);
    return () => clearInterval(iv);
  }, []);

  const highlighted = tick % 4;

  return (
    <div className="float-card w-full max-w-[340px]"
      style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 24, overflow: "hidden", boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(167,139,250,0.08)" }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(167,139,250,0.04)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.15)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 2h8v3L7 8l-4-3z" stroke="#a78bfa" strokeWidth="1.3" strokeLinejoin="round" fill="rgba(167,139,250,0.2)"/>
              <path d="M4 5v5a3 3 0 0 0 6 0V5" stroke="#a78bfa" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="font-body text-xs font-semibold text-white">The Lads 🏆</p>
            <p className="font-body text-xs text-text-muted">6 games played</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)" }}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#00ff87" }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#00ff87" }} />
          </span>
          <span className="font-body text-xs font-semibold" style={{ color: "#00ff87" }}>Live</span>
        </div>
      </div>

      {/* Tab toggle mini */}
      <div className="px-4 pt-3 pb-2 flex gap-1.5">
        <span className="font-body text-xs font-semibold px-2.5 py-1 rounded-md" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>Points</span>
        <span className="font-body text-xs text-text-muted px-2.5 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.04)" }}>P4P</span>
      </div>

      {/* Players */}
      {LEAGUE_PLAYERS.map((p, i) => {
        const isHighlighted = i === highlighted;
        const pal = PALETTES[i];
        return (
          <div key={p.name}
            className="flex items-center gap-3 px-4 py-3 transition-all"
            style={{
              background: isHighlighted ? "rgba(167,139,250,0.06)" : i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
              borderBottom: i < LEAGUE_PLAYERS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}>
            <span className="font-display text-sm w-5 flex-shrink-0" style={{ color: i === 0 ? "#a78bfa" : "#555577" }}>#{i + 1}</span>
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-body font-bold text-xs flex-shrink-0"
              style={{ background: pal.bg, color: pal.text, border: "1px solid rgba(255,255,255,0.08)" }}>
              {p.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-body text-sm font-medium text-white">{p.name}</span>
                <span className="text-sm">{p.flag}</span>
                {p.streak >= 2 && (
                  <span className="font-body text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(251,146,60,0.1)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.2)" }}>
                    🔥{p.streak}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="h-0.5 rounded-full" style={{ width: 32, background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full rounded-full" style={{ width: `${p.acc}%`, background: p.acc >= 85 ? "#00ff87" : "#a78bfa" }} />
                </div>
                <span className="font-body text-xs tabular-nums" style={{ color: "#555577" }}>{p.acc}%</span>
              </div>
            </div>
            <span className="font-display text-base flex-shrink-0" style={{ color: i === 0 ? "#a78bfa" : "white" }}>
              {p.pts.toLocaleString()}
            </span>
          </div>
        );
      })}

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
        <span className="font-body text-xs text-text-muted">🏴󠁧󠁢󠁥󠁮󠁧󠁿 England vs France · 67&apos;</span>
        <span className="font-body text-xs font-semibold" style={{ color: "#a78bfa" }}>2 watching →</span>
      </div>
    </div>
  );
}

// ── League standings tile ─────────────────────────────────────────────────────

interface StandingRow {
  user_id: string;
  display_name: string;
  total_score: number;
  is_me: boolean;
}

interface LeagueTab {
  id: string;
  name: string;
  members: StandingRow[];
}

function LeagueStandingsTile({ userId }: { userId: string }) {
  const [leagues, setLeagues] = useState<LeagueTab[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setLoading(false); return; }
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();

      const { data: memberships } = await (sb as any)
        .from("league_members")
        .select("league_id, leagues(id, name)")
        .eq("user_id", userId)
        .limit(10);

      if (!memberships?.length) { setLoading(false); return; }

      const result: LeagueTab[] = await Promise.all(
        memberships.map(async (m: any) => {
          const league = m.leagues;
          const { data: memberRows } = await (sb as any)
            .from("league_members")
            .select("user_id, total_score")
            .eq("league_id", league.id)
            .order("total_score", { ascending: false })
            .limit(20);

          if (!memberRows?.length) return { id: league.id, name: league.name, members: [] };

          const userIds = memberRows.map((r: any) => r.user_id);
          const { data: profiles } = await (sb as any)
            .from("profiles")
            .select("id, display_name")
            .in("id", userIds);

          const pm: Record<string, string> = {};
          if (profiles) for (const p of profiles) pm[p.id] = p.display_name ?? "Player";

          return {
            id: league.id,
            name: league.name,
            members: memberRows.map((r: any) => ({
              user_id: r.user_id,
              display_name: pm[r.user_id] ?? "Player",
              total_score: r.total_score ?? 0,
              is_me: r.user_id === userId,
            })),
          };
        })
      );

      setLeagues(result.filter((l) => l.members.length > 0));
      setLoading(false);
    });
  }, [userId]);

  if (!loading && leagues.length === 0) return null;

  const active = leagues[activeIdx] ?? null;
  const MEDALS = ["🥇", "🥈", "🥉"];

  return (
    <div className="dash-slide-2 rounded-2xl overflow-hidden"
      style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="px-5 pt-4 pb-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2h8v3L7 8l-4-3z" stroke="#a78bfa" strokeWidth="1.3" strokeLinejoin="round" fill="rgba(167,139,250,0.2)"/>
            <path d="M4 5v5a3 3 0 0 0 6 0V5" stroke="#a78bfa" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <p className="font-body text-xs font-semibold uppercase tracking-widest" style={{ color: "#a78bfa" }}>League Standings</p>
        </div>
        <Link href="/leagues" className="font-body text-xs font-semibold" style={{ color: "#a78bfa" }}>All leagues →</Link>
      </div>

      {leagues.length > 1 && (
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          {leagues.map((l, i) => (
            <button key={l.id} onClick={() => setActiveIdx(i)}
              className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0 transition-all"
              style={{
                background: i === activeIdx ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.04)",
                color: i === activeIdx ? "#a78bfa" : "#8888aa",
                border: `1px solid ${i === activeIdx ? "rgba(167,139,250,0.3)" : "transparent"}`,
              }}>
              {l.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 rounded-full border-2 border-white/10 animate-spin" style={{ borderTopColor: "#a78bfa" }} />
        </div>
      ) : active ? (
        <>
          {active.members.map((member, i) => (
            <div key={member.user_id}
              className="flex items-center gap-3 px-5 py-3 transition-colors"
              style={{
                background: member.is_me ? "rgba(167,139,250,0.05)" : "transparent",
                borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}>
              <span className="font-display text-sm w-7 flex-shrink-0 text-center">
                {i < 3 ? MEDALS[i] : <span style={{ color: "#555577" }}>#{i + 1}</span>}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-body text-sm font-medium text-white truncate">{member.display_name}</p>
                  {member.is_me && (
                    <span className="font-body text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>you</span>
                  )}
                </div>
              </div>
              <span className="font-display text-base flex-shrink-0"
                style={{ color: member.is_me ? "#a78bfa" : i === 0 ? "#fff" : "#8888aa" }}>
                {member.total_score.toLocaleString()}
              </span>
            </div>
          ))}
          <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <Link href={`/league/${active.id}`} className="font-body text-xs font-semibold" style={{ color: "#a78bfa" }}>
              Full standings →
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Dashboard (logged-in) ────────────────────────────────────────────────────

interface RoomCard {
  id: string;
  name: string;
  code: string;
  status: "lobby" | "live" | "completed";
  match_label: string;
  player_count: number;
  is_host: boolean;
}

// ── Live matches strip ────────────────────────────────────────────────────────

interface LiveMatch {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  tournament: string;
  status: string;
  home_score: number;
  away_score: number;
}

const FLAG_MAP_DASH: Record<string, string> = {
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", France: "🇫🇷", Brazil: "🇧🇷", Argentina: "🇦🇷",
  Germany: "🇩🇪", Spain: "🇪🇸", Portugal: "🇵🇹", Netherlands: "🇳🇱",
  USA: "🇺🇸", Mexico: "🇲🇽", Italy: "🇮🇹", Morocco: "🇲🇦",
  Ecuador: "🇪🇨", Canada: "🇨🇦", Jamaica: "🇯🇲", Chile: "🇨🇱",
  Bolivia: "🇧🇴", Honduras: "🇭🇳", Panama: "🇵🇦", Uruguay: "🇺🇾",
  Colombia: "🇨🇴", Peru: "🇵🇪", Venezuela: "🇻🇪", Paraguay: "🇵🇾",
  Senegal: "🇸🇳", Nigeria: "🇳🇬", Ghana: "🇬🇭", "South Africa": "🇿🇦",
  Croatia: "🇭🇷", Serbia: "🇷🇸", Denmark: "🇩🇰", Switzerland: "🇨🇭",
  Belgium: "🇧🇪", Poland: "🇵🇱", Ukraine: "🇺🇦", Turkey: "🇹🇷",
  Japan: "🇯🇵", "South Korea": "🇰🇷", Iran: "🇮🇷", Australia: "🇦🇺",
  Qatar: "🇶🇦", "Saudi Arabia": "🇸🇦", Wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
};

function useUpcomingMatches(limit = 5) {
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    import("@/lib/supabase/client").then(({ createClient }) => {
      const sb = createClient();
      const now = new Date().toISOString();
      (sb as any)
        .from("matches")
        .select("id, home_team, away_team, match_date, tournament, status, home_score, away_score")
        .or(`status.eq.live,and(status.eq.upcoming,match_date.gte.${now})`)
        .order("match_date", { ascending: true })
        .limit(limit)
        .then(({ data }: { data: LiveMatch[] | null }) => {
          if (data?.length) setMatches(data);
        });
    });
  }, [limit]);
  return matches;
}


const DASH_ANIM = `
  @keyframes dashGlow {
    0%,100% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.02); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes countPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(167,139,250,0.4); }
    50% { box-shadow: 0 0 0 8px rgba(167,139,250,0); }
  }
  .dash-slide-1 { animation: slideIn 0.4s ease-out 0.05s both; }
  .dash-slide-2 { animation: slideIn 0.4s ease-out 0.15s both; }
  .dash-slide-3 { animation: slideIn 0.4s ease-out 0.25s both; }
  .dash-slide-4 { animation: slideIn 0.4s ease-out 0.35s both; }
  .league-cta-pulse { animation: countPulse 2.5s ease-in-out infinite; }
  .dash-slide-5 { animation: slideIn 0.4s ease-out 0.45s both; }
`;

function Dashboard({ userId }: { userId: string }) {
  const [rooms, setRooms] = useState<RoomCard[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [totalScore, setTotalScore] = useState<number | null>(null);
  const [globalRank, setGlobalRank] = useState<number | null>(null);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const matches = useUpcomingMatches(8);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setLoadingRooms(false); return; }
    import("@/lib/supabase/client").then(({ createClient }) => {
      const sb = createClient();
      sb.from("profiles").select("display_name, total_score").eq("id", userId).single()
        .then(({ data }) => {
          if (data) {
            setDisplayName((data as any).display_name ?? "");
            const score = (data as any).total_score ?? 0;
            setTotalScore(score);
            (sb as any).from("profiles").select("*", { count: "exact", head: true })
              .gt("total_score", score)
              .then(({ count }: any) => setGlobalRank((count ?? 0) + 1));
          }
        });
      sb.from("room_members")
        .select("room_id, rooms(id, name, code, status, created_by, match_id, matches(home_team, away_team))")
        .eq("user_id", userId)
        .order("joined_at", { ascending: false })
        .limit(20)
        .then(async ({ data }) => {
          if (!data) { setLoadingRooms(false); return; }
          const cards: RoomCard[] = (data as any[]).map((row) => {
            const r = row.rooms as any;
            const m = r?.matches as any;
            return { id: r?.id ?? "", name: r?.name ?? "", code: r?.code ?? "", status: r?.status ?? "lobby", match_label: m ? `${m.home_team} vs ${m.away_team}` : "Room", player_count: 0, is_host: r?.created_by === userId };
          }).filter((r) => r.id);
          setRooms(cards);
          setLoadingRooms(false);
        });
    });
  }, [userId]);

  const firstName = displayName ? displayName.split(" ")[0] : null;
  const activeRooms = rooms.filter((r) => r.status !== "completed");
  const pastRooms = rooms.filter((r) => r.status === "completed");
  const STATUS_LABEL: Record<string, string> = { lobby: "Lobby", live: "LIVE", completed: "Ended" };
  const STATUS_COLOR: Record<string, string> = { lobby: "#ffb800", live: "#00ff87", completed: "#8888aa" };

  return (
    <main className="min-h-dvh bg-bg pb-28 overflow-x-hidden">
      <style>{DASH_ANIM}</style>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="fixed top-0 right-0 w-[350px] h-[350px] pointer-events-none" style={{ background: "radial-gradient(circle at 100% 0%, rgba(167,139,250,0.08) 0%, transparent 60%)" }} />
      <div className="fixed bottom-0 left-0 w-[300px] h-[300px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 100%, rgba(0,255,135,0.05) 0%, transparent 60%)" }} />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
        <span className="font-display text-2xl text-white tracking-wider" style={{ textShadow: "0 0 20px rgba(0,255,135,0.3)" }}>YOURSCORE</span>
        <Link href="/profile" className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm transition-opacity hover:opacity-80"
          style={{ background: "linear-gradient(135deg, #1a2f4a, #2a1a4a)", color: "#a78bfa", border: "1.5px solid rgba(167,139,250,0.25)" }}>
          {(displayName || "?")[0].toUpperCase()}
        </Link>
      </nav>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-5">

        {/* ── Hero: score + countdown ─────────────────────────────────────── */}
        <div className="dash-slide-1 rounded-2xl overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.12) 0%, rgba(0,255,135,0.06) 100%)", border: "1px solid rgba(167,139,250,0.2)" }}>
          <div className="px-5 pt-5 pb-4">
            <p className="font-body text-xs text-text-muted mb-0.5">
              {firstName ? `Hey ${firstName} 👋` : "Welcome back"}
            </p>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-display text-5xl text-white leading-none" style={{ textShadow: "0 0 30px rgba(167,139,250,0.3)" }}>
                  {totalScore !== null ? totalScore.toLocaleString() : "—"}
                </p>
                <p className="font-body text-xs text-text-muted mt-1">Total points</p>
                {globalRank !== null && (
                  <span className="inline-flex items-center gap-1 font-body text-xs font-bold px-2.5 py-1 rounded-full mt-2"
                    style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}>
                    #{globalRank} globally
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="font-body text-xs text-text-muted mb-1 uppercase tracking-widest">World Cup in</p>
                <WorldCupCountdown />
              </div>
            </div>
          </div>
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#a78bfa" }} />
            <p className="font-body text-xs text-text-muted">FIFA World Cup 2026 · June 11 · USA, Canada & Mexico</p>
          </div>
        </div>

        {/* ── League standings ───────────────────────────────────────────── */}
        <LeagueStandingsTile userId={userId} />

        {/* ── Create a league — big purple CTA ───────────────────────────── */}
        <div className="dash-slide-3">
          <Link href="/league/new"
            className="flex items-center justify-between px-5 py-5 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99] league-cta-pulse"
            style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(167,139,250,0.08) 100%)", border: "1px solid rgba(167,139,250,0.3)" }}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.3)" }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M5 3h12v5l-6 5-6-5z" stroke="#a78bfa" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(167,139,250,0.25)"/>
                  <path d="M7 8v9a4 4 0 0 0 8 0V8" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <p className="font-body text-base font-bold text-white">Create a league</p>
                <p className="font-body text-xs text-text-muted">Invite your mates · Points all season</p>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: "#a78bfa", flexShrink: 0 }}>
              <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
        </div>

        {/* ── Upcoming fixtures horizontal scroller ───────────────────────── */}
        {matches.length > 0 && (
          <div className="dash-slide-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-body text-xs text-text-muted uppercase tracking-widest">
                {matches.some(m => m.status === "live") ? "🔴 Live now" : "Upcoming fixtures"}
              </p>
              <Link href="/join" className="font-body text-xs font-semibold" style={{ color: "#00ff87" }}>See all →</Link>
            </div>
            <div className="overflow-x-auto pb-2 -mx-5 px-5">
              <div className="flex gap-3" style={{ minWidth: "max-content" }}>
                {matches.map((m) => {
                  const isLive = m.status === "live";
                  const dateStr = new Date(m.match_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                  return (
                    <Link key={m.id} href={`/match/${m.id}`}
                      className="flex flex-col gap-2 rounded-2xl p-4 flex-shrink-0 transition-opacity hover:opacity-80 active:scale-[0.98]"
                      style={{ background: isLive ? "rgba(0,255,135,0.07)" : "#12121e", border: isLive ? "1px solid rgba(0,255,135,0.2)" : "1px solid rgba(255,255,255,0.08)", width: 148 }}>
                      <div className="flex items-center justify-between">
                        <span className="text-2xl">{FLAG_MAP_DASH[m.home_team] ?? "🏳️"}</span>
                        {isLive
                          ? <span className="font-display text-sm text-white">{m.home_score}–{m.away_score}</span>
                          : <span className="font-body text-xs text-text-muted">vs</span>}
                        <span className="text-2xl">{FLAG_MAP_DASH[m.away_team] ?? "🏳️"}</span>
                      </div>
                      <p className="font-body text-xs font-semibold text-white leading-tight">{m.home_team} vs {m.away_team}</p>
                      <p className="font-body text-xs" style={{ color: isLive ? "#00ff87" : "#8888aa" }}>
                        {isLive ? "● Live" : dateStr}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Create a room + active rooms ────────────────────────────────── */}
        <div className="dash-slide-5">
          <div className="flex items-center justify-between mb-3">
            <p className="font-body text-xs text-text-muted uppercase tracking-widest">Your rooms</p>
            <Link href="/room/new" className="font-body text-xs font-semibold" style={{ color: "#00ff87" }}>+ New room</Link>
          </div>
          {loadingRooms ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 rounded-full border-2 border-white/20 animate-spin" style={{ borderTopColor: "#00ff87" }} />
            </div>
          ) : activeRooms.length === 0 ? (
            <Link href="/room/new"
              className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all hover:opacity-80"
              style={{ background: "rgba(0,255,135,0.04)", border: "1px dashed rgba(0,255,135,0.2)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(0,255,135,0.1)" }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 2v14M2 9h14" stroke="#00ff87" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <p className="font-body text-sm font-semibold text-white">Create a room</p>
                <p className="font-body text-xs text-text-muted">Pick a match, invite your crew</p>
              </div>
            </Link>
          ) : (
            <div className="space-y-2">
              {activeRooms.map((room) => (
                <Link key={room.id} href={`/room/${room.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-opacity hover:opacity-80"
                  style={{ background: "#12121e", border: `1px solid ${room.status === "live" ? "rgba(0,255,135,0.15)" : "rgba(255,255,255,0.07)"}` }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[room.status], boxShadow: room.status === "live" ? `0 0 6px ${STATUS_COLOR[room.status]}` : "none" }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm font-semibold text-white truncate">{room.name}</p>
                    <p className="font-body text-xs text-text-muted truncate">{room.match_label}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="font-body text-xs font-semibold uppercase tracking-widest px-2 py-1 rounded-full"
                      style={{ background: `${STATUS_COLOR[room.status]}15`, color: STATUS_COLOR[room.status], border: `1px solid ${STATUS_COLOR[room.status]}30` }}>
                      {STATUS_LABEL[room.status]}
                    </span>
                    <span className="font-display text-base" style={{ color: "#00ff87" }}>{room.code}</span>
                  </div>
                </Link>
              ))}
              <Link href="/room/new"
                className="flex items-center justify-center gap-2 py-3 rounded-xl font-body text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ border: "1px dashed rgba(0,255,135,0.2)", color: "#00ff87" }}>
                + Create another room
              </Link>
            </div>
          )}
        </div>

        {/* Past games */}
        {pastRooms.length > 0 && (
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Past games</p>
            <div className="space-y-2">
              {pastRooms.map((room) => (
                <Link key={room.id} href={`/room/${room.id}/results`}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-opacity hover:opacity-80"
                  style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm font-medium text-white truncate">{room.name}</p>
                    <p className="font-body text-xs text-text-muted truncate">{room.match_label}</p>
                  </div>
                  <span className="font-body text-xs text-text-muted">Results →</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </main>
  );
}

// ── Marketing landing (logged-out) ───────────────────────────────────────────

function UpcomingFixturesSection() {
  const matches = useUpcomingMatches(8);

  return (
    <section className="relative z-10 max-w-6xl mx-auto px-6 pb-20">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-3xl text-white">UPCOMING FIXTURES</h2>
        <Link href="/league/new" className="font-body text-xs font-semibold" style={{ color: "#a78bfa" }}>Create a league →</Link>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: "max-content" }}>
          {matches.map((m) => {
            const isLive = m.status === "live";
            const dateStr = new Date(m.match_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return (
              <Link key={m.id} href={`/match/${m.id}`}
                className="flex flex-col gap-2 rounded-2xl p-4 hover:opacity-80 transition-opacity flex-shrink-0 group"
                style={{ background: isLive ? "rgba(0,255,135,0.06)" : "#12121e", border: isLive ? "1px solid rgba(0,255,135,0.2)" : "1px solid rgba(255,255,255,0.08)", width: 160 }}>
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{FLAG_MAP_DASH[m.home_team] ?? "🏳️"}</span>
                  {isLive
                    ? <span className="font-display text-sm text-white">{m.home_score}–{m.away_score}</span>
                    : <span className="font-body text-xs text-text-muted">vs</span>}
                  <span className="text-2xl">{FLAG_MAP_DASH[m.away_team] ?? "🏳️"}</span>
                </div>
                <p className="font-body text-xs font-semibold text-white leading-tight">{m.home_team} vs {m.away_team}</p>
                <div className="flex items-center justify-between">
                  <p className="font-body text-xs text-text-muted">{isLive ? "Live" : dateStr}</p>
                  <span className="font-body text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: isLive ? "#00ff87" : "#a78bfa" }}>
                    {isLive ? "Play →" : "Open →"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MarketingLanding() {
  const [timerValue, setTimerValue] = useState(45);

  useEffect(() => {
    const loop = () => {
      setTimerValue(45);
      let t = 45;
      const iv = setInterval(() => {
        t -= 1; setTimerValue(t);
        if (t <= 0) { clearInterval(iv); setTimeout(loop, 1500); }
      }, 120);
      return iv;
    };
    const iv = loop();
    return () => clearInterval(iv);
  }, []);

  const timerColor = timerValue <= 5 ? "#ff4757" : timerValue <= 15 ? "#ffb800" : "#00ff87";
  const dashOffset = 282 * (1 - timerValue / 45);

  return (
    <main className="min-h-dvh bg-bg overflow-x-hidden">
      <style>{ANIM_CSS}</style>

      {/* Grid + glow background */}
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.022) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="fixed top-0 left-0 w-[700px] h-[700px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(167,139,250,0.07) 0%, transparent 60%)" }} />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 100% 100%, rgba(0,255,135,0.05) 0%, transparent 60%)" }} />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="font-display text-3xl text-white tracking-wider" style={{ textShadow: "0 0 30px rgba(0,255,135,0.35)" }}>YOURSCORE</span>
        <div className="flex items-center gap-2">
          <Link href="/how-it-works" className="hidden sm:block font-body text-sm text-text-muted hover:text-white transition-colors px-3 py-2">How it works</Link>
          <Link href="/join" className="hidden sm:block font-body text-sm text-text-muted hover:text-white transition-colors px-3 py-2">Join room</Link>
          <Link href="/auth/sign-in" className="font-body text-sm text-text-muted hover:text-white transition-colors px-3 py-2">Sign in</Link>
          <Link href="/league/new" className="font-body font-bold text-sm px-5 py-2.5 rounded-xl hover:opacity-90 transition-all pulse-glow"
            style={{ background: "#a78bfa", color: "#0a0a0f" }}>
            Create a league
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pt-6 pb-16 lg:pt-12">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">

          {/* Left: copy + CTAs */}
          <div>
            <div className="inline-flex items-center gap-2.5 rounded-full px-4 py-2 mb-7"
              style={{ background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.18)" }}>
              <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "#00ff87" }} />
              <span className="font-body text-xs text-text-muted uppercase tracking-widest">World Cup · Euros · Champions League</span>
            </div>

            <h1 className="font-display text-6xl sm:text-7xl lg:text-8xl text-white leading-none mb-6">
              YOUR<br />FOOTBALL<br />
              <span style={{ color: "#00ff87", textShadow: "0 0 50px rgba(0,255,135,0.35)" }}>IQ.</span>{" "}
              <span style={{ color: "#a78bfa", textShadow: "0 0 50px rgba(167,139,250,0.35)" }}>RANKED.</span>
            </h1>

            <p className="font-body text-text-muted text-lg leading-relaxed mb-8 max-w-lg">
              Start a league with your mates. Answer live questions during every match. Points stack across{" "}
              <span className="text-white font-medium">every game, all season long.</span>
            </p>

            {/* Primary CTA — Create a league */}
            <Link href="/league/new"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 font-body font-bold text-lg px-10 py-5 rounded-2xl hover:opacity-90 transition-all mb-3 pulse-glow"
              style={{ background: "#a78bfa", color: "#0a0a0f", display: "flex" }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M5 3h12v5L11 12 5 8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(0,0,0,0.15)"/>
                <path d="M7 8v9a4 4 0 0 0 8 0V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Create a league
            </Link>

            {/* Secondary CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <Link href="/room/new"
                className="flex-1 flex items-center justify-center gap-2 font-body font-semibold text-base px-6 py-4 rounded-xl transition-all hover:opacity-80 green-pulse"
                style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.25)" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                Create a room
              </Link>
              <Link href="/join"
                className="flex-1 flex items-center justify-center gap-2 font-body font-semibold text-base px-6 py-4 rounded-xl transition-all hover:opacity-80 text-white"
                style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M13 3h3v3M16 3l-6 6M9 5H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Join a room
              </Link>
            </div>

            <p className="font-body text-xs text-text-muted">
              Free to play · No app needed ·{" "}
              <Link href="/how-it-works" className="underline hover:text-white transition-colors">How it works →</Link>
            </p>
          </div>

          {/* Right: league card */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="relative">
              {/* Glow behind card */}
              <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 50%, rgba(167,139,250,0.15) 0%, transparent 70%)", transform: "scale(1.3)" }} />
              <LeagueHeroCard />

              {/* Floating badge: "Pound for Pound" */}
              <div className="float-card-2 absolute -bottom-4 -left-4 flex items-center gap-2 px-3.5 py-2.5 rounded-xl"
                style={{ background: "#12121e", border: "1px solid rgba(167,139,250,0.25)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                <span className="font-body text-base">👑</span>
                <div>
                  <p className="font-body text-xs font-bold text-white">P4P #1</p>
                  <p className="font-body text-xs text-text-muted">Marcus · 91%</p>
                </div>
              </div>

              {/* Floating badge: streak */}
              <div className="float-card absolute -top-4 -right-4 flex items-center gap-2 px-3.5 py-2.5 rounded-xl"
                style={{ background: "#12121e", border: "1px solid rgba(251,146,60,0.3)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                <span className="font-body text-base">🔥</span>
                <div>
                  <p className="font-body text-xs font-bold text-white">4 in a row</p>
                  <p className="font-body text-xs text-text-muted">Marcus</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── What a league gets you ────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
        <div className="rounded-3xl overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.06) 0%, rgba(10,10,15,1) 60%)", border: "1px solid rgba(167,139,250,0.15)" }}>
          <div className="px-8 py-10 lg:py-12">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 font-body text-xs uppercase tracking-widest"
                  style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 1.5h7v3L6 8l-3.5-3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M3 4.5v4a3 3 0 0 0 6 0v-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                  Leagues
                </div>
                <h2 className="font-display text-4xl sm:text-5xl text-white mb-4">YOUR MATES.<br />ONE TABLE.</h2>
                <p className="font-body text-text-muted text-base leading-relaxed mb-6">
                  A league tracks your whole group across every game you each play — whether you watch together or separately. One permanent leaderboard. All season.
                </p>
                <div className="space-y-3 mb-8">
                  {[
                    { icon: "📈", text: "Points stack across World Cup, Euros, Champions League — all of it" },
                    { icon: "👁", text: "See who's live right now and which match they're in" },
                    { icon: "👑", text: "Raw points vs Pound for Pound accuracy — real debates built in" },
                    { icon: "🔥", text: "Streaks, badges, and P4P ranking for more ways to brag" },
                  ].map(f => (
                    <div key={f.text} className="flex items-start gap-3">
                      <span className="text-base mt-0.5 flex-shrink-0">{f.icon}</span>
                      <p className="font-body text-sm text-white/80">{f.text}</p>
                    </div>
                  ))}
                </div>
                <Link href="/league/new"
                  className="inline-flex items-center gap-2 font-body font-bold text-base px-8 py-4 rounded-xl hover:opacity-90 transition-all"
                  style={{ background: "#a78bfa", color: "#0a0a0f", boxShadow: "0 0 28px rgba(167,139,250,0.3)" }}>
                  Start your league →
                </Link>
              </div>

              {/* Fixture cards */}
              <div className="space-y-3">
                {[
                  { fh: "🇧🇷", fa: "🇦🇷", home: "Brazil", away: "Argentina", date: "Jun 20", pts: "+340" },
                  { fh: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", fa: "🇫🇷", home: "England", away: "France", date: "Jun 24", pts: "+280" },
                  { fh: "🇩🇪", fa: "🇪🇸", home: "Germany", away: "Spain", date: "Jun 27", pts: "+210" },
                ].map((m, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4 rounded-2xl"
                    style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span className="text-2xl">{m.fh}</span>
                    <div className="flex-1">
                      <p className="font-body text-sm font-semibold text-white">{m.home} vs {m.away}</p>
                      <p className="font-body text-xs text-text-muted">{m.date} · World Cup</p>
                    </div>
                    <span className="text-2xl">{m.fa}</span>
                    <div className="text-right">
                      <p className="font-display text-base" style={{ color: "#00ff87" }}>{m.pts}</p>
                      <p className="font-body text-xs text-text-muted">pts earned</p>
                    </div>
                  </div>
                ))}
                <div className="px-5 py-3 rounded-2xl text-center" style={{ background: "rgba(167,139,250,0.04)", border: "1px dashed rgba(167,139,250,0.2)" }}>
                  <p className="font-body text-xs" style={{ color: "#a78bfa" }}>Every game you play adds to your league table</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works (condensed) ──────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
        <div className="text-center mb-10">
          <h2 className="font-display text-5xl text-white mb-3">HOW IT WORKS</h2>
          <p className="font-body text-text-muted">Four steps. No app. Drop the link in your group chat.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { num: "01", col: "#a78bfa", emoji: "🏆", title: "CREATE A LEAGUE", desc: "Start a private league. Invite your mates. Points track all season." },
            { num: "02", col: "#00ff87", emoji: "⚽", title: "PICK A MATCH", desc: "Create a room for any game. Share the code. Friends join in seconds." },
            { num: "03", col: "#ffb800", emoji: "⚡", title: "ANSWER LIVE", desc: "Questions fire during the match. 45 seconds. Faster = more points." },
            { num: "04", col: "#ff4757", emoji: "📈", title: "POINTS STACK", desc: "Your league table updates after every game. Accuracy and streaks tracked." },
          ].map((step) => (
            <div key={step.num} className="rounded-2xl p-6 relative overflow-hidden group" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="font-display text-9xl absolute -top-4 -right-2 opacity-[0.06] group-hover:opacity-[0.1] transition-opacity select-none" style={{ color: step.col }}>{step.num}</div>
              <div className="relative z-10">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-5 text-2xl" style={{ background: `${step.col}15`, border: `1px solid ${step.col}25` }}>{step.emoji}</div>
                <h3 className="font-display text-xl text-white mb-2">{step.title}</h3>
                <p className="font-body text-text-muted text-sm leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-6">
          <Link href="/how-it-works" className="font-body text-sm font-semibold transition-colors hover:opacity-80" style={{ color: "#00ff87" }}>
            Full breakdown → scoring, streaks, FAQs
          </Link>
        </div>
      </section>

      {/* ── Live question preview ─────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="font-body text-xs uppercase tracking-widest mb-3" style={{ color: "#ffb800" }}>Real-time</p>
            <h2 className="font-display text-4xl sm:text-5xl text-white mb-4">LIVE DURING<br />THE MATCH.</h2>
            <p className="font-body text-text-muted text-base leading-relaxed mb-6">
              Questions are tied to match events — goals, penalties, key stats. They fire at the perfect moment and you have 45 seconds to answer. Faster answers score more points.
            </p>
            <div className="space-y-3">
              {[
                { col: "#00ff87", label: "Answer in 0–15s", pts: "+200 pts" },
                { col: "#ffb800", label: "Answer in 15–30s", pts: "+150 pts" },
                { col: "#ff9f43", label: "Answer in 30–45s", pts: "+100 pts" },
                { col: "#a78bfa", label: "3 correct in a row", pts: "×2 bonus" },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between py-2.5 px-4 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span className="font-body text-sm text-white/80">{r.label}</span>
                  <span className="font-display text-base" style={{ color: r.col }}>{r.pts}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Animated question card */}
          <div className="flex items-center justify-center">
            <div className="float-card-2 w-full max-w-sm rounded-3xl overflow-hidden"
              style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 0 0 1px rgba(0,255,135,0.08), 0 32px 64px rgba(0,0,0,0.6)" }}>
              <div className="flex items-center justify-between px-6 pt-6 pb-4">
                <div>
                  <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-1">Question 3 of 8</p>
                  <p className="font-body text-xs text-text-muted">🏴󠁧󠁢󠁥󠁮󠁧󠁿 England vs France 🇫🇷</p>
                </div>
                <div className="relative w-14 h-14">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                    <circle cx="50" cy="50" r="45" fill="none" stroke={timerColor} strokeWidth="6" strokeLinecap="round" strokeDasharray="282" strokeDashoffset={dashOffset} style={{ transition: "stroke 0.3s, stroke-dashoffset 0.1s linear" }} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center font-display text-xl" style={{ color: timerColor }}>{Math.max(0, timerValue)}</span>
                </div>
              </div>
              <div className="px-6 pb-5">
                <p className="font-body text-white text-base font-medium leading-snug">How many World Cup goals has Kylian Mbappé scored for France?</p>
              </div>
              <div className="px-4 pb-6 space-y-2">
                {[{ letter: "a", text: "9 goals" }, { letter: "b", text: "12 goals" }, { letter: "c", text: "7 goals" }, { letter: "d", text: "15 goals" }].map((opt) => {
                  const isCorrect = timerValue <= 0 && opt.letter === "b";
                  return (
                    <div key={opt.letter} className="w-full flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{ background: isCorrect ? "rgba(0,255,135,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${isCorrect ? "#00ff87" : "rgba(255,255,255,0.08)"}`, color: isCorrect ? "#00ff87" : "#ffffff" }}>
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-sm flex-shrink-0"
                        style={{ background: isCorrect ? "#00ff87" : "rgba(255,255,255,0.06)", color: isCorrect ? "#0a0a0f" : "inherit" }}>{opt.letter.toUpperCase()}</span>
                      <span className="font-body text-sm">{opt.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Countdown strip ───────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
        <div className="rounded-3xl overflow-hidden relative" style={{ background: "linear-gradient(135deg, #0d1a0f 0%, #0a0a0f 50%, #0d0d1a 100%)", border: "1px solid rgba(0,255,135,0.12)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
          <div className="relative z-10 px-8 py-10 text-center">
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-5">World Cup 2026 · Opening match</p>
            <WorldCupCountdown />
            <p className="font-body text-sm text-text-muted mt-4 mb-6">June 11 · Mexico City. The first match to earn points on.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/league/new" className="inline-flex items-center gap-2 font-body font-bold text-sm px-6 py-3 rounded-xl transition-all hover:opacity-90 pulse-glow"
                style={{ background: "#a78bfa", color: "#0a0a0f" }}>
                Create your league before Jun 11 →
              </Link>
              <Link href="/room/new" className="inline-flex items-center gap-2 font-body font-semibold text-sm px-6 py-3 rounded-xl transition-all hover:opacity-80"
                style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}>
                Quick room →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Upcoming fixtures ────────────────────────────────────────────── */}
      <UpcomingFixturesSection />

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
        <div className="rounded-3xl p-10 sm:p-14 text-center relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.1) 0%, rgba(0,255,135,0.06) 100%)", border: "1px solid rgba(167,139,250,0.2)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
          <div className="relative z-10">
            <div className="flex items-center justify-center gap-4 mb-6 text-5xl">
              🇧🇷 🏴󠁧󠁢󠁥󠁮󠁧󠁿 🇫🇷 🇩🇪 🇦🇷
            </div>
            <h2 className="font-display text-5xl sm:text-6xl text-white mb-3">START YOUR LEAGUE</h2>
            <p className="font-display text-2xl mb-6" style={{ color: "#a78bfa" }}>World Cup 2026 · June 11</p>
            <p className="font-body text-text-muted mb-8 max-w-md mx-auto">
              Invite your mates, pick your matches, and start building your score. Points stack all season.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link href="/league/new"
                className="inline-flex items-center gap-2 font-body font-bold text-lg px-10 py-5 rounded-2xl hover:opacity-90 transition-all pulse-glow"
                style={{ background: "#a78bfa", color: "#0a0a0f" }}>
                Create a league →
              </Link>
              <div className="flex items-center gap-3">
                <Link href="/room/new" className="font-body text-sm font-semibold text-white hover:opacity-70 transition-opacity">Create a room</Link>
                <span className="text-text-muted font-body text-sm">·</span>
                <Link href="/join" className="font-body text-sm font-semibold text-white hover:opacity-70 transition-opacity">Join a room</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-display text-xl text-text-muted tracking-wider">YOURSCORE</span>
          <div className="flex items-center gap-6 text-sm font-body text-text-muted">
            <Link href="/how-it-works" className="hover:text-white transition-colors">How it works</Link>
            <Link href="/join" className="hover:text-white transition-colors">Join a room</Link>
            <Link href="/league/new" className="hover:text-white transition-colors">Create a league</Link>
            <a href="mailto:hello@yourscore.app" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ── Root: branch on auth ──────────────────────────────────────────────────────

export default function RootPage() {
  const { user, loading } = useUser();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) window.location.replace(`/auth/callback?code=${encodeURIComponent(code)}&next=/`);
  }, []);

  if (loading) return <MarketingLanding />;
  if (user) return <Dashboard userId={user.id} />;
  return <MarketingLanding />;
}
