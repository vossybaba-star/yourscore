"use client";

/**
 * /leagues — unified leagues hub with two top-level tabs:
 *   "38-0"  → Draft XI private leagues (create / join / my boards)
 *   "Quiz"  → Multiplayer quiz leagues (my leagues + global rankings)
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { AuthProviders } from "@/components/auth/AuthButton";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";
import { GridBackground } from "@/components/ui/GridBackground";

// ── Types ─────────────────────────────────────────────────────────────────────

type MainTab = "38-0" | "quiz";
type QuizSubTab = "mine" | "global";

interface DraftLeague { id: string; name: string; code: string; member_count: number; }

interface QuizLeague {
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
}

interface ClubLeagueCard {
  slug: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function rankStyle(rank: number) {
  if (rank === 1) return { color: "#ffd700", bg: "rgba(255,215,0,0.12)", border: "rgba(255,215,0,0.28)", bar: "#ffd700" };
  if (rank === 2) return { color: "#c0c0c0", bg: "rgba(192,192,192,0.1)", border: "rgba(192,192,192,0.22)", bar: "#c0c0c0" };
  if (rank === 3) return { color: "#e8945a", bg: "rgba(232,148,90,0.1)", border: "rgba(232,148,90,0.22)", bar: "#e8945a" };
  return { color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.2)", bar: "#a78bfa" };
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

function initMainTab(): MainTab {
  if (typeof window === "undefined") return "38-0";
  const p = new URLSearchParams(window.location.search).get("tab");
  return p === "quiz" || p === "global" ? "quiz" : "38-0";
}

function initQuizSubTab(): QuizSubTab {
  if (typeof window === "undefined") return "mine";
  return new URLSearchParams(window.location.search).get("tab") === "global" ? "global" : "mine";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LeaguesPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  // ── Top-level tab ──
  const [mainTab, setMainTab] = useState<MainTab>(initMainTab);

  function selectMainTab(t: MainTab) {
    setMainTab(t);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", t === "quiz" ? "/leagues?tab=quiz" : "/leagues");
    }
  }

  // ── 38-0 leagues state ──
  const [draftLeagues, setDraftLeagues] = useState<DraftLeague[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/draft/league")
      .then((r) => r.json())
      .then((d) => setDraftLeagues(d.leagues ?? []))
      .catch(() => {});
  }, [user]);

  // ── Club Leagues (partner-owned branded leagues the user belongs to) ──
  const [clubLeagues, setClubLeagues] = useState<ClubLeagueCard[]>([]);

  useEffect(() => {
    if (!user || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();
      // RLS: own membership rows + member-readable club_leagues.
      const { data } = await sb
        .from("club_league_members")
        .select("club_leagues(slug, name, logo_url, brand_color, is_active)")
        .eq("user_id", user.id);
      const rows = (data ?? [])
        .map((r) => r.club_leagues as unknown as (ClubLeagueCard & { is_active: boolean }) | null)
        .filter((l): l is ClubLeagueCard & { is_active: boolean } => !!l && l.is_active);
      setClubLeagues(rows);
    });
  }, [user]);

  async function createDraftLeague() {
    if (!draftName.trim() || draftBusy) return;
    setDraftBusy(true); setDraftErr(null);
    try {
      const r = await fetch("/api/draft/league", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: draftName }) });
      const d = await r.json();
      if (!r.ok) { setDraftErr(d.error ?? "Could not create"); setDraftBusy(false); return; }
      router.push(`/38-0/league/${d.code}`);
    } catch { setDraftErr("Network error"); setDraftBusy(false); }
  }

  async function joinDraftLeague() {
    if (!draftCode.trim() || draftBusy) return;
    setDraftBusy(true); setDraftErr(null);
    try {
      const r = await fetch("/api/draft/league/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: draftCode }) });
      const d = await r.json();
      if (!r.ok) { setDraftErr(d.error ?? "Could not join"); setDraftBusy(false); return; }
      router.push(`/38-0/league/${d.code}`);
    } catch { setDraftErr("Network error"); setDraftBusy(false); }
  }

  // ── Quiz leagues state ──
  const [quizSubTab, setQuizSubTab] = useState<QuizSubTab>(initQuizSubTab);
  const [quizLeagues, setQuizLeagues] = useState<QuizLeague[]>([]);
  const [quizLoading, setQuizLoading] = useState(true);
  const [globalPlayers, setGlobalPlayers] = useState<GlobalPlayer[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalFetched, setGlobalFetched] = useState(false);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const joinInputRef = useRef<HTMLInputElement>(null);

  function selectQuizSubTab(t: QuizSubTab) {
    setQuizSubTab(t);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", t === "global" ? "/leagues?tab=global" : "/leagues?tab=quiz");
    }
  }

  useEffect(() => {
    if (userLoading || !user || !process.env.NEXT_PUBLIC_SUPABASE_URL) { setQuizLoading(false); return; }
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();
      const { data } = await sb.rpc("get_my_leagues", { p_user_id: user.id });
      setQuizLeagues((data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id), name: String(row.name), description: row.description as string | null,
        code: String(row.code), member_count: Number(row.member_count ?? 0),
        my_score: Number(row.my_score ?? 0), my_rank: Number(row.my_rank ?? 1),
      })));
      setQuizLoading(false);
    });
  }, [user, userLoading]);

  useEffect(() => {
    if (quizSubTab !== "global" || globalFetched || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    setGlobalLoading(true);
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();
      const { data } = await sb.from("profiles").select("id, display_name, total_score").order("total_score", { ascending: false }).limit(100);
      setGlobalPlayers((data ?? []) as GlobalPlayer[]);
      setGlobalFetched(true);
      setGlobalLoading(false);
    });
  }, [quizSubTab, globalFetched]);

  useEffect(() => {
    if (joinSheetOpen) { setTimeout(() => joinInputRef.current?.focus(), 120); }
    else { setJoinCode(""); }
  }, [joinSheetOpen]);

  function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    setJoinSheetOpen(false);
    router.push(`/league/join/${code}`);
  }

  const bestQuizRank = quizLeagues.reduce<number | null>((best, l) => {
    if (l.my_rank === null) return best;
    return best === null ? l.my_rank : Math.min(best, l.my_rank);
  }, null);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.025} />
      <div className="fixed top-0 right-0 w-[400px] h-[400px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 100% 0%, rgba(167,139,250,0.07) 0%, transparent 60%)" }} />

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <nav className="flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          <span className="font-display text-2xl text-white tracking-wider">Leagues</span>
          {user && mainTab === "quiz" && (
            <div className="flex items-center gap-2">
              <button onClick={() => setJoinSheetOpen(true)}
                className="flex items-center gap-1.5 font-body text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:opacity-90"
                style={{ background: "rgba(255,255,255,0.05)", color: "#aaaacc", border: "1px solid rgba(255,255,255,0.1)" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Join
              </button>
              <Link href="/league/new"
                className="flex items-center gap-1.5 font-body text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:opacity-90"
                style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                New
              </Link>
            </div>
          )}
        </nav>

        {/* ── Main tab selector ─────────────────────────────────────────── */}
        <div className="px-5 pb-3 max-w-lg mx-auto">
          <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {([["38-0", "38-0 ⚽"] as const, ["quiz", "Quiz 🧠"] as const]).map(([key, label]) => (
              <button key={key} onClick={() => selectMainTab(key)}
                className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold transition-all"
                style={mainTab === key
                  ? { background: key === "38-0" ? "#00ff87" : "#a78bfa", color: "#0a0a0f" }
                  : { background: "transparent", color: "#8888aa" }
                }>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-4 space-y-4">

        {/* ════════════════════ CLUB LEAGUES (cross-game, partner-owned) ════ */}
        {clubLeagues.length > 0 && (
          <div>
            <p className="font-body text-xs uppercase tracking-widest mb-3" style={{ color: "#555577" }}>My club leagues</p>
            <div className="space-y-2">
              {clubLeagues.map((l) => {
                const brand = l.brand_color || "#a78bfa";
                return (
                  <Link key={l.slug} href={`/l/${l.slug}`}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 active:scale-[0.98] transition-transform"
                    style={{ background: "#12121e", border: `1px solid ${brand}33` }}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0"
                      style={{ background: `${brand}15`, border: `1px solid ${brand}33` }}>
                      {l.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.logo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="font-display text-lg" style={{ color: brand }}>{(l.name || "?")[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-body" style={{ fontSize: 15, color: "#fff" }}>{l.name}</div>
                      <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>Club League · boards, events & feed</div>
                    </div>
                    <span className="font-display" style={{ fontSize: 20, color: brand }}>→</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════════════════ 38-0 TAB ════════════════════════════════════ */}
        {mainTab === "38-0" && (
          <>
            {!user && !userLoading ? (
              <div className="rounded-2xl p-6 text-center" style={{ background: "#12121e", border: "1px solid rgba(0,255,135,0.15)" }}>
                <div className="font-display tracking-wide mb-2" style={{ fontSize: 20, color: "#fff" }}>SIGN IN FOR LEAGUES</div>
                <p className="font-body mb-4" style={{ fontSize: 13, color: "#8888aa" }}>Create or join a private 38-0 league to compete with your group.</p>
                <Link href="/auth/sign-in" className="inline-block rounded-xl px-5 py-3 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 18 }}>SIGN IN →</Link>
              </div>
            ) : (
              <>
                {draftErr && (
                  <div className="rounded-xl px-4 py-2 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{draftErr}</div>
                )}

                {/* Create */}
                <div className="rounded-2xl p-4" style={{ background: "#12121e", border: "1px solid rgba(0,255,135,0.18)" }}>
                  <div className="font-display tracking-wide mb-2" style={{ fontSize: 16, color: "#00ff87" }}>CREATE A LEAGUE</div>
                  <div className="flex gap-2">
                    <input value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={40} placeholder="League name"
                      onKeyDown={(e) => e.key === "Enter" && createDraftLeague()}
                      className="flex-1 rounded-xl px-3 py-3 font-body outline-none" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }} />
                    <button onClick={createDraftLeague} disabled={draftBusy || !draftName.trim()}
                      className="rounded-xl px-5 font-display tracking-wide disabled:opacity-50 transition-opacity" style={{ background: "#00ff87", color: "#062013", fontSize: 16 }}>
                      CREATE
                    </button>
                  </div>
                </div>

                {/* Join */}
                <div className="rounded-2xl p-4" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="font-display tracking-wide mb-2" style={{ fontSize: 16, color: "#fff" }}>JOIN BY CODE</div>
                  <div className="flex gap-2">
                    <input value={draftCode} onChange={(e) => setDraftCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123"
                      onKeyDown={(e) => e.key === "Enter" && joinDraftLeague()}
                      className="flex-1 rounded-xl px-3 py-3 font-display tracking-widest outline-none" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)", fontSize: 20 }} />
                    <button onClick={joinDraftLeague} disabled={draftBusy || !draftCode.trim()}
                      className="rounded-xl px-5 font-display tracking-wide disabled:opacity-50 transition-opacity" style={{ background: "#a78bfa", color: "#15082b", fontSize: 16 }}>
                      JOIN
                    </button>
                  </div>
                </div>

                {/* My draft leagues */}
                {draftLeagues.length > 0 && (
                  <div>
                    <p className="font-body text-xs uppercase tracking-widest mb-3" style={{ color: "#555577" }}>My leagues</p>
                    <div className="space-y-2">
                      {draftLeagues.map((l) => (
                        <Link key={l.id} href={`/38-0/league/${l.code}`}
                          className="flex items-center justify-between rounded-xl px-4 py-3 active:scale-[0.98] transition-transform"
                          style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <div>
                            <div className="font-body" style={{ fontSize: 15, color: "#fff" }}>{l.name}</div>
                            <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>{l.member_count} member{l.member_count === 1 ? "" : "s"} · {l.code}</div>
                          </div>
                          <span className="font-display" style={{ fontSize: 20, color: "#a78bfa" }}>→</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Global board shortcut */}
                <Link href="/38-0/leaderboard"
                  className="flex items-center justify-between rounded-xl px-4 py-3 active:scale-[0.98] transition-transform"
                  style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.18)" }}>
                  <div>
                    <div className="font-body text-sm font-semibold" style={{ color: "#fff" }}>Global 38-0 leaderboard</div>
                    <div className="font-body text-xs" style={{ color: "#8888aa" }}>Daily + all-time rankings →</div>
                  </div>
                  <span className="font-body text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,255,135,0.12)", color: "#00ff87" }}>View</span>
                </Link>
              </>
            )}
          </>
        )}

        {/* ════════════════════ QUIZ TAB ════════════════════════════════════ */}
        {mainTab === "quiz" && (
          <>
            {/* Not signed in */}
            {!userLoading && !user && (
              <div className="rounded-2xl p-6" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}>
                <p className="font-display text-2xl text-white mb-1">Your leagues live here</p>
                <p className="font-body text-sm mb-5 text-text-muted">Sign in to create a league, invite your mates, and track your score all season.</p>
                <AuthProviders />
              </div>
            )}

            {/* Sub-tab toggle */}
            {user && !userLoading && (
              <div className="flex gap-2 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                {([["mine", "My Leagues"] as const, ["global", "Global"] as const]).map(([key, label]) => (
                  <button key={key} onClick={() => selectQuizSubTab(key)}
                    className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold transition-all"
                    style={quizSubTab === key
                      ? { background: "#a78bfa", color: "#0a0a0f" }
                      : { background: "transparent", color: "#8888aa" }
                    }>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* ── My Quiz Leagues ── */}
            {(!user || quizSubTab === "mine") && (
              <>
                {quizLoading && user && <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>}

                {/* Summary hero */}
                {!quizLoading && user && quizLeagues.length > 0 && (
                  <div className="rounded-2xl px-5 py-4"
                    style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.1) 0%, rgba(167,139,250,0.04) 100%)", border: "1px solid rgba(167,139,250,0.18)" }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-body text-xs uppercase tracking-widest mb-1.5 text-text-muted">Your leagues</p>
                        <p className="font-display text-5xl text-white leading-none">{quizLeagues.length}</p>
                        <p className="font-body text-xs mt-1 text-text-muted">{quizLeagues.length === 1 ? "league" : "leagues"} joined</p>
                      </div>
                      {bestQuizRank !== null && (
                        <div className="text-right">
                          <p className="font-body text-xs uppercase tracking-widest mb-1.5 text-text-muted">Best rank</p>
                          <p className="font-display text-5xl leading-none"
                            style={{ color: bestQuizRank === 1 ? "#ffd700" : bestQuizRank <= 3 ? "#e8945a" : "#a78bfa" }}>
                            #{bestQuizRank}
                          </p>
                          {bestQuizRank === 1 && <p className="font-body text-xs mt-1" style={{ color: "#ffd700" }}>👑 leading</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* League cards */}
                {!quizLoading && user && quizLeagues.length > 0 && (
                  <div className="space-y-3">
                    {quizLeagues.map((league) => {
                      const rankNum = league.my_rank ?? league.member_count;
                      const pct = league.member_count > 1
                        ? Math.round(((league.member_count - rankNum) / (league.member_count - 1)) * 100)
                        : 100;
                      const rs = rankStyle(rankNum);
                      const isLeading = rankNum === 1;
                      const gapFromTop = league.member_count > 1 && !isLeading ? `#${rankNum} of ${league.member_count}` : null;
                      return (
                        <Link key={league.id} href={`/league/${league.id}`}
                          className="block rounded-2xl overflow-hidden transition-opacity hover:opacity-90 active:scale-[0.99] bg-surface border border-border">
                          <div className="px-5 pt-5 pb-4">
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
                                  <p className="font-body text-xs truncate mb-1 text-text-muted">{league.description}</p>
                                )}
                                <p className="font-body text-xs" style={{ color: "#444466" }}>
                                  {league.member_count} {league.member_count === 1 ? "member" : "members"}
                                </p>
                              </div>
                              <div className="flex-shrink-0 rounded-2xl px-4 py-3 text-center"
                                style={{ background: rs.bg, border: `1px solid ${rs.border}`, minWidth: 68 }}>
                                <p className="font-display text-3xl leading-none" style={{ color: rs.color }}>#{rankNum}</p>
                                <p className="font-body text-xs mt-1" style={{ color: rs.color, opacity: 0.6 }}>of {league.member_count}</p>
                              </div>
                            </div>
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
                                  style={{ width: `${Math.max(3, pct)}%`, background: `linear-gradient(90deg, ${rs.bar}55, ${rs.bar})`, transition: "width 0.6s ease-out" }} />
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {/* Empty state */}
                {!quizLoading && user && quizLeagues.length === 0 && (
                  <div className="rounded-2xl p-8 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                    <p className="font-display text-4xl mb-3">🏆</p>
                    <p className="font-display text-2xl text-white mb-2">No leagues yet</p>
                    <p className="font-body text-sm mb-6 text-text-muted">
                      Create a league and invite your mates — your points stack across every match all season.
                    </p>
                    <Link href="/league/new"
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-body font-bold text-sm transition-all hover:opacity-90"
                      style={{ background: "#a78bfa", color: "#0a0a0f" }}>
                      Create your first league →
                    </Link>
                  </div>
                )}

                {/* Create more nudge */}
                {!quizLoading && user && quizLeagues.length > 0 && (
                  <Link href="/league/new"
                    className="flex items-center justify-between px-5 py-4 rounded-2xl transition-all hover:opacity-80"
                    style={{ background: "rgba(167,139,250,0.05)", border: "1px dashed rgba(167,139,250,0.2)" }}>
                    <div>
                      <p className="font-body text-sm font-semibold text-white">Start another league</p>
                      <p className="font-body text-xs text-text-muted">Different crew? Create as many as you like</p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "#a78bfa", flexShrink: 0 }}>
                      <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </Link>
                )}
              </>
            )}

            {/* ── Global Rankings ── */}
            {user && quizSubTab === "global" && (
              <>
                {globalLoading && <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>}

                {!globalLoading && globalPlayers.length === 0 && (
                  <div className="rounded-2xl p-8 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                    <p className="font-display text-3xl mb-3">🌍</p>
                    <p className="font-body text-sm text-text-muted">No players yet. Be the first to score.</p>
                  </div>
                )}

                {!globalLoading && globalPlayers.length > 0 && (
                  <div>
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
                          const visualPos = idx + 1;
                          const c = colors[visualPos - 1];
                          const pal = playerColor(p.display_name);
                          return (
                            <Link key={p.id} href={`/profile/${p.id}`}
                              className="rounded-2xl px-3 py-4 flex flex-col items-center gap-2 text-center transition-opacity hover:opacity-80 active:scale-[0.98]"
                              style={{ background: isMe ? "rgba(0,255,135,0.07)" : c.bg, border: `1px solid ${isMe ? "rgba(0,255,135,0.25)" : c.border}`, order: idx === 0 ? 1 : idx === 1 ? 0 : 2, marginTop: visualPos === 1 ? 0 : 12 }}>
                              <div className="w-10 h-10 rounded-full flex items-center justify-center font-body font-bold text-base"
                                style={{ background: pal.bg, color: pal.text, border: "2px solid rgba(255,255,255,0.08)" }}>
                                {playerInitial(p.display_name)}
                              </div>
                              <p className="font-body text-xs font-semibold text-white truncate w-full">
                                {p.display_name ?? "Player"}{isMe && <span className="text-green"> (you)</span>}
                              </p>
                              <p className="font-display text-lg leading-none" style={{ color: c.medal }}>#{visualPos}</p>
                              <p className="font-body text-xs text-text-muted">{p.total_score.toLocaleString()} pts</p>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {globalPlayers.map((p, i) => {
                        const rank = i + 1;
                        const isMe = user && p.id === user.id;
                        const rs = rankStyle(rank);
                        return (
                          <Link key={p.id} href={`/profile/${p.id}`}
                            className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-opacity hover:opacity-80"
                            style={{ background: isMe ? "rgba(0,255,135,0.06)" : "#12121e", border: `1px solid ${isMe ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.06)"}` }}>
                            <div className="w-8 text-center flex-shrink-0">
                              {rank <= 3 ? <span className="text-base">{["🥇", "🥈", "🥉"][rank - 1]}</span>
                                : <span className="font-display text-sm" style={{ color: rs.color }}>#{rank}</span>}
                            </div>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
                              style={{ background: playerColor(p.display_name).bg, color: playerColor(p.display_name).text, border: "1px solid rgba(255,255,255,0.07)" }}>
                              {playerInitial(p.display_name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-body text-sm font-medium text-white truncate">
                                {p.display_name ?? "Player"}
                                {isMe && <span className="font-normal ml-1.5 text-green" style={{ fontSize: "0.7rem" }}>you</span>}
                              </p>
                            </div>
                            <p className="font-display text-lg flex-shrink-0" style={{ color: isMe ? "#00ff87" : rank <= 3 ? rs.color : "#8888aa" }}>
                              {p.total_score.toLocaleString()}
                            </p>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <BottomNav />

      {/* ── Quiz Join Sheet ──────────────────────────────────────────────────── */}
      {joinSheetOpen && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setJoinSheetOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl px-5 pt-5 pb-10 bg-surface"
            style={{ border: "1px solid rgba(167,139,250,0.2)", borderBottom: "none" }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: "rgba(255,255,255,0.12)" }} />
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="font-display text-xl text-white tracking-wide">Join a league</p>
                <p className="font-body text-xs mt-0.5 text-text-muted">Enter the code your mate shared</p>
              </div>
              <button onClick={() => setJoinSheetOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ background: "rgba(255,255,255,0.07)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="#aaaacc" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleJoinSubmit}>
              <input ref={joinInputRef} type="text" value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                placeholder="ENTER CODE" autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                className="w-full rounded-2xl px-5 font-display text-3xl text-center tracking-[0.25em] text-white outline-none mb-4"
                style={{ height: 72, background: "rgba(167,139,250,0.06)", border: `1px solid ${joinCode.length >= 4 ? "rgba(167,139,250,0.5)" : "rgba(167,139,250,0.2)"}`, caretColor: "#a78bfa", letterSpacing: "0.25em", transition: "border-color 0.2s" }} />
              <button type="submit" disabled={joinCode.trim().length < 4}
                className="w-full py-4 rounded-2xl font-body font-bold text-base transition-all"
                style={{ background: joinCode.trim().length >= 4 ? "#a78bfa" : "rgba(167,139,250,0.15)", color: joinCode.trim().length >= 4 ? "#0a0a0f" : "#555577", cursor: joinCode.trim().length >= 4 ? "pointer" : "not-allowed" }}>
                Join league →
              </button>
            </form>
          </div>
        </>
      )}
    </main>
  );
}
