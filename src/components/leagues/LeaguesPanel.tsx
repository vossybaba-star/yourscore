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
import { Button } from "@/components/ui/Button";
import { PublicLeaguesRail } from "@/components/leagues/PublicLeagueCard";
import { afLeagueCreate, afLeagueJoin } from "@/lib/analytics/appsflyerEvents";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  return { color: "#aeea00", bg: "rgba(174,234,0,0.1)", border: "rgba(174,234,0,0.2)", bar: "#aeea00" };
}

function playerInitial(name: string | null) { return (name ?? "?")[0].toUpperCase(); }

function playerColor(name: string | null) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#3a423d", text: "#aeea00" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const n = name ?? "?";
  return palettes[n.charCodeAt(0) % palettes.length];
}

// Carousel mockup: one MY LEAGUES list filtered by game chips + a DISCOVER view.
type LeaguesView = "mine" | "discover";
// Founder call: no "All" — you're either looking at 38-0 leagues or Quiz Battle
// leagues. The chips only apply to MY LEAGUES; Discover always shows everything
// (each card carries its own game badge).
type GameChip = "38-0" | "quiz";

function initView(): LeaguesView {
  if (typeof window === "undefined") return "mine";
  return new URLSearchParams(window.location.search).get("tab") === "discover" ? "discover" : "mine";
}

function initChip(): GameChip {
  if (typeof window === "undefined") return "38-0";
  const p = new URLSearchParams(window.location.search).get("tab");
  return p === "quiz" || p === "global" ? "quiz" : "38-0";
}

function initQuizSubTab(): QuizSubTab {
  if (typeof window === "undefined") return "mine";
  return new URLSearchParams(window.location.search).get("tab") === "global" ? "global" : "mine";
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Leagues hub (38-0 + Quiz boards). Standalone at /leagues and embedded in the
// Versus tab (embedded=true strips the page chrome + bottom nav).
export function LeaguesPanel({ embedded = false }: { embedded?: boolean }) {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  // ── Top-level controls: MY LEAGUES | DISCOVER + game chips ──
  const [view, setView] = useState<LeaguesView>(initView);
  const [gameChip, setGameChip] = useState<GameChip>(initChip);

  function selectView(v: LeaguesView) {
    setView(v);
    // Embedded in Versus: don't rewrite the URL — replaceState would drop the
    // parent's ?view=leagues param and bounce it back to the Play sub-tab.
    if (typeof window !== "undefined" && !embedded) {
      window.history.replaceState(null, "", v === "discover" ? "/leagues?tab=discover" : "/leagues");
    }
  }
  const show38 = view === "mine" && gameChip !== "quiz";
  const showQuiz = view === "mine" && gameChip !== "38-0";

  // ── 38-0 leagues state ──
  const [draftLeagues, setDraftLeagues] = useState<DraftLeague[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [draftPublic, setDraftPublic] = useState(false);
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
      const r = await fetch("/api/draft/league", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: draftName, isPublic: draftPublic }) });
      const d = await r.json();
      if (!r.ok) { setDraftErr(d.error ?? "Could not create"); setDraftBusy(false); return; }
      afLeagueCreate({ leagueType: "38-0" });
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
      afLeagueJoin({ leagueType: "38-0" });
      router.push(`/38-0/league/${d.code}`);
    } catch { setDraftErr("Network error"); setDraftBusy(false); }
  }

  // ── Quiz leagues state ──
  const [quizSubTab, setQuizSubTab] = useState<QuizSubTab>(initQuizSubTab);
  const [quizLeagues, setQuizLeagues] = useState<QuizLeague[]>([]);
  // Per-league chase gap (pts to the player directly above + their name), keyed
  // by league id. Computed from full standings so cards can show momentum.
  const [leagueGaps, setLeagueGaps] = useState<Record<string, { gap: number; aboveName: string }>>({});
  const [quizLoading, setQuizLoading] = useState(true);
  const [globalPlayers, setGlobalPlayers] = useState<GlobalPlayer[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalFetched, setGlobalFetched] = useState(false);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const joinInputRef = useRef<HTMLInputElement>(null);

  function selectQuizSubTab(t: QuizSubTab) {
    setQuizSubTab(t);
    if (typeof window !== "undefined" && !embedded) {
      window.history.replaceState(null, "", t === "global" ? "/leagues?tab=global" : "/leagues?tab=quiz");
    }
  }

  useEffect(() => {
    if (userLoading || !user || !process.env.NEXT_PUBLIC_SUPABASE_URL) { setQuizLoading(false); return; }
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();
      const [{ data }, { data: standings }] = await Promise.all([
        sb.rpc("get_my_leagues", { p_user_id: user.id }),
        sb.rpc("get_my_league_standings", { p_user_id: user.id, p_limit: 50 }),
      ]);
      setQuizLeagues((data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id), name: String(row.name), description: row.description as string | null,
        code: String(row.code), member_count: Number(row.member_count ?? 0),
        my_score: Number(row.my_score ?? 0), my_rank: Number(row.my_rank ?? 1),
      })));

      // Compute the gap to the player directly above me in each league.
      const byLeague = new Map<string, { uid: string; name: string; score: number }[]>();
      for (const r of (standings ?? []) as Record<string, unknown>[]) {
        const lid = String(r.league_id);
        if (!byLeague.has(lid)) byLeague.set(lid, []);
        byLeague.get(lid)!.push({ uid: String(r.user_id ?? ""), name: String(r.display_name ?? "Player"), score: Number(r.total_score ?? 0) });
      }
      const gaps: Record<string, { gap: number; aboveName: string }> = {};
      for (const [lid, members] of Array.from(byLeague.entries())) {
        const sorted = [...members].sort((a, b) => b.score - a.score);
        const idx = sorted.findIndex((m) => m.uid === user.id);
        if (idx > 0) gaps[lid] = { gap: Math.max(0, sorted[idx - 1].score - sorted[idx].score), aboveName: sorted[idx - 1].name };
      }
      setLeagueGaps(gaps);
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
    <main className={embedded ? "" : "min-h-dvh bg-bg pb-28"}>
      {!embedded && <GridBackground opacity={0.025} />}
      {!embedded && (
        <div className="fixed top-0 right-0 w-[400px] h-[400px] pointer-events-none"
          style={{ background: "radial-gradient(circle at 100% 0%, rgba(174,234,0,0.07) 0%, transparent 60%)" }} />
      )}

      {/* ── Sticky header (no page chrome when embedded in Versus) ─────────── */}
      <div className={embedded ? "" : "sticky top-0 z-30 pt-safe"} style={embedded ? undefined : { background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <nav className="flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          {!embedded && <span className="font-display text-2xl text-white tracking-wider">Leagues</span>}
        </nav>

        {/* ── View selector: MY LEAGUES | DISCOVER + game chips ──────────── */}
        <div className="px-5 pb-3 max-w-lg mx-auto">
          <div className="flex gap-6" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            {([["mine", "My Leagues"] as const, ["discover", "Discover"] as const]).map(([key, label]) => {
              const active = view === key;
              return (
                <button key={key} onClick={() => selectView(key)}
                  className="relative pb-2.5 font-display text-base tracking-wide transition-colors"
                  style={{ color: active ? "#eef2f0" : "#8a948f" }}>
                  {label}
                  {active && <span className="absolute left-0 right-0 -bottom-px h-[3px] rounded-t" style={{ background: key === "discover" ? "#00d8c0" : "#aeea00" }} />}
                </button>
              );
            })}
          </div>
          {view === "mine" && (
            <div className="flex gap-2 mt-3">
              {([["38-0", "38-0", "#aeea00"] as const, ["quiz", "Quiz Battle", "#00d8c0"] as const]).map(([key, label, accent]) => {
                const active = gameChip === key;
                return (
                  <button key={key} onClick={() => setGameChip(key)}
                    className="flex-1 font-body text-sm font-semibold py-2 rounded-lg transition-all text-center"
                    style={{
                      background: active ? accent + "22" : "rgba(255,255,255,0.04)",
                      color: active ? accent : "#8a948f",
                      border: `1px solid ${active ? accent + "55" : "transparent"}`,
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-4 space-y-4">

        {/* ════════════════════ DISCOVER ═════════════════════════════════════ */}
        {view === "discover" && (
          <>
            <PublicLeaguesRail showEmpty heading={false} />
            <p className="font-body text-xs text-text-muted leading-relaxed pt-1">
              Public leagues are open to everyone — join one and your points count on its board. Got a private code? Use <button onClick={() => setJoinSheetOpen(true)} className="underline" style={{ color: "#00d8c0" }}>join with code</button>.
            </p>
          </>
        )}

        {/* Quick actions (mine view): create or join */}
        {view === "mine" && user && (
          <div className="flex gap-2">
            <Link href="/league/new" className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 font-display text-sm tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#aeea00", color: "#13200a" }}>
              CREATE LEAGUE
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            </Link>
            <button onClick={() => setJoinSheetOpen(true)} className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 font-display text-sm tracking-wide active:scale-[0.98] transition-transform" style={{ background: "rgba(255,255,255,0.04)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.14)" }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><rect x="2" y="4.5" width="16" height="11" rx="2.5" stroke="#00d8c0" strokeWidth="1.5" /><path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01" stroke="#00d8c0" strokeWidth="2.4" strokeLinecap="round" /></svg>
              JOIN WITH CODE
            </button>
          </div>
        )}

        {/* ════════════════════ CLUB LEAGUES (cross-game, partner-owned) ════ */}
        {view === "mine" && clubLeagues.length > 0 && (
          <div>
            <p className="font-body text-xs uppercase tracking-widest mb-3" style={{ color: "#586058" }}>My club leagues</p>
            <div className="space-y-2">
              {clubLeagues.map((l) => {
                const brand = l.brand_color || "#aeea00";
                return (
                  <Link key={l.slug} href={`/l/${l.slug}`}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 active:scale-[0.98] transition-transform"
                    style={{ background: "#0e1611", border: `1px solid ${brand}33` }}>
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
                      <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>Club League · boards, events & feed</div>
                    </div>
                    <span className="font-display" style={{ fontSize: 20, color: brand }}>→</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════════════════ 38-0 TAB ════════════════════════════════════ */}
        {show38 && (
          <>
            {!user && !userLoading ? (
              <div className="rounded-2xl p-6 text-center" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.15)" }}>
                <div className="font-display tracking-wide mb-2" style={{ fontSize: 20, color: "#fff" }}>SIGN IN FOR LEAGUES</div>
                <p className="font-body mb-4" style={{ fontSize: 13, color: "#8a948f" }}>Create or join a private 38-0 league to compete with your group.</p>
                <Button href="/auth/sign-in" variant="primary" tone="lime" size="md">SIGN IN →</Button>
              </div>
            ) : (
              <>
                {draftErr && (
                  <div className="rounded-xl px-4 py-2 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{draftErr}</div>
                )}

                {/* Your leagues — lead with them when the user has any */}
                {draftLeagues.length > 0 && (
                  <div>
                    <p className="font-body text-xs font-bold uppercase tracking-widest mb-2.5" style={{ color: "#586058" }}>Your leagues</p>
                    <div className="space-y-2.5">
                      {draftLeagues.map((l) => (
                        <Link key={l.id} href={`/38-0/league/${l.code}`}
                          className="block rounded-2xl px-4 py-4 active:scale-[0.99] transition-all hover:opacity-90 bg-surface"
                          style={{ border: "1px solid rgba(174,234,0,0.18)" }}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.25)" }}>
                              <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                                <path d="M3 2h8v3L7 8l-4-3z" stroke="#aeea00" strokeWidth="1.4" strokeLinejoin="round" fill="rgba(174,234,0,0.2)" />
                                <path d="M4 5v5a3 3 0 0 0 6 0V5" stroke="#aeea00" strokeWidth="1.4" strokeLinecap="round" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-body text-sm font-bold text-white truncate">{l.name}</div>
                              <div className="font-body text-xs text-text-muted">
                                Private · {l.member_count} member{l.member_count === 1 ? "" : "s"} · 38-0
                              </div>
                            </div>
                            <span className="font-display text-[11px] tracking-wide px-3.5 py-2 rounded-lg flex-shrink-0"
                              style={{ background: "rgba(174,234,0,0.14)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.3)" }}>
                              VIEW LEAGUE →
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                            <span className="font-mono text-[11px] px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.05)", color: "#aeea00", letterSpacing: "0.1em" }}>{l.code}</span>
                            <span className="font-body text-[11px] text-text-muted">Share this code to bring your group in</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Create or join a 38-0 league — shown on its own chip only (the
                    top action row covers quiz create; this is the 38-0 path). */}
                <div className="rounded-2xl overflow-hidden" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.18)", display: gameChip === "38-0" ? undefined : "none" }}>
                  <div className="px-4 pt-4 pb-3">
                    <p className="font-display tracking-wide" style={{ fontSize: 16, color: "#aeea00" }}>
                      {draftLeagues.length > 0 ? "START ANOTHER LEAGUE" : "START A LEAGUE"}
                    </p>
                    <p className="font-body text-xs text-text-muted mt-0.5">Name it, share the code, compete all season.</p>
                    <div className="flex gap-2 mt-3">
                      <input value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={40} placeholder="League name"
                        onKeyDown={(e) => e.key === "Enter" && createDraftLeague()}
                        className="flex-1 rounded-xl px-3 py-3 font-body outline-none" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }} />
                      <Button onClick={createDraftLeague} disabled={draftBusy || !draftName.trim()} variant="primary" tone="lime" size="sm">
                        CREATE
                      </Button>
                    </div>
                    <button type="button" onClick={() => setDraftPublic((v) => !v)} className="flex items-center gap-2 mt-2.5">
                      <span className="w-4 h-4 rounded grid place-items-center flex-shrink-0 transition-all" style={{ border: `1.5px solid ${draftPublic ? "#aeea00" : "rgba(255,255,255,0.25)"}`, background: draftPublic ? "#aeea00" : "transparent" }}>
                        {draftPublic && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5 5 9l4.5-6" stroke="#0a120d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </span>
                      <span className="font-body text-xs" style={{ color: draftPublic ? "#eef2f0" : "#8a948f" }}>Public — anyone can find and join it in Discover</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-3 px-4">
                    <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                    <span className="font-body text-xs" style={{ color: "#586058" }}>or join</span>
                    <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                  </div>
                  <div className="px-4 pt-3 pb-4">
                    <div className="flex gap-2">
                      <input value={draftCode} onChange={(e) => setDraftCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123"
                        onKeyDown={(e) => e.key === "Enter" && joinDraftLeague()}
                        className="flex-1 rounded-xl px-3 py-3 font-display tracking-widest outline-none" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)", fontSize: 20 }} />
                      <Button onClick={joinDraftLeague} disabled={draftBusy || !draftCode.trim()} variant="ghost" size="sm">
                        JOIN
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Global 38-0 board — first-class, not a buried link */}
                <Link href="/38-0/leaderboard"
                  className="flex items-center gap-3 rounded-2xl px-4 py-4 active:scale-[0.99] transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.1), rgba(174,234,0,0.04))", border: "1px solid rgba(174,234,0,0.25)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                    style={{ background: "rgba(174,234,0,0.14)", border: "1px solid rgba(174,234,0,0.28)" }}>🌍</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-body text-sm font-bold text-white">Global 38-0 leaderboard</div>
                    <div className="font-body text-xs text-text-muted">See where you rank · daily + all-time</div>
                  </div>
                  <span className="font-display text-sm tracking-wide flex-shrink-0" style={{ color: "#aeea00" }}>VIEW →</span>
                </Link>

              </>
            )}
          </>
        )}

        {/* ════════════════════ QUIZ TAB ════════════════════════════════════ */}
        {showQuiz && (
          <>
            {/* Not signed in */}
            {!userLoading && !user && (
              <div className="rounded-2xl p-6" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.15)" }}>
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
                      ? { background: "#aeea00", color: "#0a0a0f" }
                      : { background: "transparent", color: "#8a948f" }
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
                    style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.1) 0%, rgba(174,234,0,0.04) 100%)", border: "1px solid rgba(174,234,0,0.18)" }}>
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
                            style={{ color: bestQuizRank === 1 ? "#ffd700" : bestQuizRank <= 3 ? "#e8945a" : "#aeea00" }}>
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
                      const gapInfo = leagueGaps[league.id];
                      const gapFromTop = isLeading
                        ? null
                        : gapInfo
                        ? `🎯 ${gapInfo.gap.toLocaleString()} pts behind ${gapInfo.aboveName}`
                        : league.member_count > 1
                        ? `#${rankNum} of ${league.member_count}`
                        : null;
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
                                <p className="font-body text-xs" style={{ color: "#3a423d" }}>
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
                                <p className="font-body text-xs" style={{ color: "#586058" }}>
                                  {isLeading ? "🏆 Leading the table" : gapFromTop ?? ""}
                                </p>
                                <p className="font-display text-lg" style={{ color: rs.color }}>
                                  {league.my_score.toLocaleString()} <span className="font-body text-xs" style={{ color: "#586058" }}>pts</span>
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
                      Create a league and invite your friends — your points stack across every match all season.
                    </p>
                    <Button href="/league/new" variant="primary" tone="teal" size="md">
                      Create your first league →
                    </Button>
                  </div>
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
                            { medal: "#aeea00", bg: "rgba(174,234,0,0.1)", border: "rgba(174,234,0,0.25)" },
                            { medal: "#e8945a", bg: "rgba(232,148,90,0.1)", border: "rgba(232,148,90,0.2)" },
                          ];
                          const visualPos = idx + 1;
                          const c = colors[visualPos - 1];
                          const pal = playerColor(p.display_name);
                          return (
                            <Link key={p.id} href={`/profile/${p.id}`}
                              className="rounded-2xl px-3 py-4 flex flex-col items-center gap-2 text-center transition-opacity hover:opacity-80 active:scale-[0.98]"
                              style={{ background: isMe ? "rgba(174,234,0,0.07)" : c.bg, border: `1px solid ${isMe ? "rgba(174,234,0,0.25)" : c.border}`, order: idx === 0 ? 1 : idx === 1 ? 0 : 2, marginTop: visualPos === 1 ? 0 : 12 }}>
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
                            style={{ background: isMe ? "rgba(174,234,0,0.06)" : "#0e1611", border: `1px solid ${isMe ? "rgba(174,234,0,0.2)" : "rgba(255,255,255,0.06)"}` }}>
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
                            <p className="font-display text-lg flex-shrink-0" style={{ color: isMe ? "#aeea00" : rank <= 3 ? rs.color : "#8a948f" }}>
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

      {!embedded && <BottomNav />}

      {/* ── Quiz Join Sheet ──────────────────────────────────────────────────── */}
      {joinSheetOpen && (
        <>
          {/* z-[60]: above the fixed BottomNav (z-50) so the sheet is never covered */}
          <div className="fixed inset-0 z-[55]" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setJoinSheetOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-3xl px-5 pt-5 bg-surface"
            style={{ border: "1px solid rgba(174,234,0,0.2)", borderBottom: "none", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: "rgba(255,255,255,0.12)" }} />
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="font-display text-xl text-white tracking-wide">Join a league</p>
                <p className="font-body text-xs mt-0.5 text-text-muted">Enter the code your friend shared</p>
              </div>
              <button onClick={() => setJoinSheetOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ background: "rgba(255,255,255,0.07)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="#9aa39d" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleJoinSubmit}>
              <input ref={joinInputRef} type="text" value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                placeholder="ENTER CODE" autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                className="w-full rounded-2xl px-5 font-display text-3xl text-center tracking-[0.25em] text-white outline-none mb-4"
                style={{ height: 72, background: "rgba(174,234,0,0.06)", border: `1px solid ${joinCode.length >= 4 ? "rgba(174,234,0,0.5)" : "rgba(174,234,0,0.2)"}`, caretColor: "#aeea00", letterSpacing: "0.25em", transition: "border-color 0.2s" }} />
              <Button type="submit" disabled={joinCode.trim().length < 4}
                variant="primary" tone="teal" size="lg" fullWidth>
                Join league →
              </Button>
            </form>
          </div>
        </>
      )}
    </main>
  );
}
