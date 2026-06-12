"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { trackGamePlay, trackGameComplete } from "@/lib/analytics/trackGame";
import Link from "next/link";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { REALTIME_ENABLED } from "@/lib/realtime";
import { QuestionCard, type ActiveQuestion } from "@/components/game/QuestionCard";
import { Leaderboard, type LeaderboardEntry } from "@/components/game/Leaderboard";
import { useUser } from "@/hooks/useUser";
import { AuthProviders } from "@/components/auth/AuthButton";
import { BottomNav } from "@/components/ui/BottomNav";
import { FlagImage } from "@/components/ui/FlagImage";
import { getPlayerCutoutUrl, COUNTRY_STAR } from "@/lib/playerImages";
import { GridBackground } from "@/components/ui/GridBackground";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MatchData {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  tournament: string;
  status: string;
  home_score: number;
  away_score: number;
}

// Shape of a match_scores row joined with profiles, as selected at runtime.
// The match_scores↔profiles relation isn't expressed in the generated DB types,
// so the joined select is coerced to this local type at the query boundary.
interface LeaderboardRow {
  user_id: string;
  total_score: number;
  correct_answers: number;
  total_answers: number | null;
  current_streak: number;
  avg_answer_speed_ms: number | null;
  fastest_answer_ms: number | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

// ── Scoreboard ────────────────────────────────────────────────────────────────

function MatchHeader({ match, playerCount }: { match: MatchData; playerCount: number }) {
  const [elapsed, setElapsed] = useState("LIVE");
  const [homeCutout, setHomeCutout] = useState<string | null>(null);
  const [awayCutout, setAwayCutout] = useState<string | null>(null);

  useEffect(() => {
    const hKey = COUNTRY_STAR[match.home_team];
    const aKey = COUNTRY_STAR[match.away_team];
    if (hKey) getPlayerCutoutUrl(hKey).then(url => { if (url) setHomeCutout(url); });
    if (aKey) getPlayerCutoutUrl(aKey).then(url => { if (url) setAwayCutout(url); });
  }, [match.home_team, match.away_team]);

  useEffect(() => {
    const tick = () => {
      const start = new Date(match.match_date).getTime();
      const diff = Date.now() - start;
      if (diff < 0) { setElapsed("PRE"); return; }
      const mins = Math.floor(diff / 60000);
      if (mins < 45) { setElapsed(`${mins}'`); return; }
      if (mins < 50) { setElapsed("HT"); return; }
      if (mins < 100) { setElapsed(`${mins - 5}'`); return; }
      setElapsed("FT");
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => clearInterval(iv);
  }, [match.match_date]);

  const statusLabel =
    elapsed === "HT" ? "Half Time" :
    elapsed === "FT" ? "Full Time" :
    elapsed === "PRE" ? "Pre Match" :
    `${elapsed} In Play`;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,255,135,0.15)" }}>
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "rgba(0,255,135,0.08)", borderBottom: "1px solid rgba(0,255,135,0.1)" }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#00ff87" }} />
          <span className="font-body text-xs font-semibold uppercase tracking-widest" style={{ color: "#00ff87" }}>
            {statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-body text-xs text-text-muted">{playerCount} playing</span>
          <span className="font-body text-xs text-text-muted">{match.tournament}</span>
        </div>
      </div>

      <div className="px-5 py-5" style={{ background: "#12121e", position: "relative" }}>
        {/* Home player cutout */}
        {homeCutout && (
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "clamp(80px, 22vw, 120px)", zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={homeCutout} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center", opacity: 0.42 }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, transparent 30%, #12121e 85%)" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, #12121e 0%, transparent 25%)" }} />
          </div>
        )}
        {/* Away player cutout */}
        {awayCutout && (
          <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "clamp(80px, 22vw, 120px)", zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={awayCutout} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center", opacity: 0.42, transform: "scaleX(-1)" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to left, transparent 30%, #12121e 85%)" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, #12121e 0%, transparent 25%)" }} />
          </div>
        )}
        <div className="flex items-center justify-between" style={{ position: "relative", zIndex: 1 }}>
          <div className="flex flex-col items-center gap-2 flex-1">
            <FlagImage team={match.home_team} size={48} />
            <p className="font-display text-sm text-white text-center">{match.home_team.toUpperCase()}</p>
          </div>
          <div className="flex items-center gap-4 px-4">
            <span className="font-display text-5xl text-white tabular-nums">{match.home_score}</span>
            <span className="font-display text-2xl text-text-muted">–</span>
            <span className="font-display text-5xl text-white tabular-nums">{match.away_score}</span>
          </div>
          <div className="flex flex-col items-center gap-2 flex-1">
            <FlagImage team={match.away_team} size={48} />
            <p className="font-display text-sm text-white text-center">{match.away_team.toUpperCase()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pre-match waiting state ───────────────────────────────────────────────────

function PreMatchBanner({ match }: { match: MatchData }) {
  const [diff, setDiff] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setDiff(new Date(match.match_date).getTime() - Date.now());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [match.match_date]);

  if (diff === null) return null;
  if (diff <= 0) return null;

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return (
    <div className="rounded-2xl p-5 text-center" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}>
      <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-2">Match starts in</p>
      <p className="font-display text-4xl text-white mb-1">
        {h > 0 && <>{h}h </>}{m}m {s}s
      </p>
      <p className="font-body text-xs text-text-muted">
        {new Date(match.match_date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

// ── Sign-in prompt ────────────────────────────────────────────────────────────

function SignInPrompt({ matchName }: { matchName: string }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-body text-sm font-semibold text-white mb-1">Sign in to play</p>
      <p className="font-body text-xs text-text-muted mb-4">
        Answer live questions during <span className="text-white">{matchName}</span> and earn points. Free. 10 seconds to join.
      </p>
      <AuthProviders />
    </div>
  );
}

// ── Share strip ───────────────────────────────────────────────────────────────

function ShareStrip({ matchId, matchName }: { matchId: string; matchName: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/match/${matchId}` : `/match/${matchId}`;

  function share() {
    const text = `Answer live questions during ${matchName} on YourScore!\n${url}`;
    if (navigator.share) { navigator.share({ text }).catch(() => {}); }
    else { navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  }

  return (
    <button onClick={share}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl font-body text-xs transition-opacity hover:opacity-80"
      style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.12)", color: "#00ff87" }}>
      <span className="font-semibold">{copied ? "Link copied!" : "Invite your mates"}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MatchPage({ params }: { params: { id: string } }) {
  const { user, loading: userLoading } = useUser();
  const [match, setMatch] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestion | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const supabaseRef = useRef<SupabaseClient<Database> | null>(null);
  // Per-game audience signals (Live-match quiz): "play" on the player's first answer
  // (so passive viewers don't count), "complete" once the match has ended.
  const livePlayedRef = useRef(false);
  const liveCompletedRef = useRef(false);

  const matchId = params.id;

  // ── Fetch match + leaderboard + realtime ──────────────────────────────────
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setLoading(false); return; }

    // Hoisted so the effect cleanup can remove the channel — a `return` inside
    // .then() goes to the promise, not to React, which leaked one live
    // subscription per match-page visit.
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    import("@/lib/supabase/client").then(({ createClient }) => {
      const sb = createClient();
      supabaseRef.current = sb;

      // Fetch match
      sb.from("matches")
        .select("id, home_team, away_team, match_date, tournament, status, home_score, away_score")
        .eq("id", matchId)
        .single()
        .then(({ data }) => {
          if (data) {
            setMatch({
              ...data,
              tournament: data.tournament ?? "",
              status: data.status ?? "",
              home_score: data.home_score ?? 0,
              away_score: data.away_score ?? 0,
            });
          }
          setLoading(false);
        });

      // Fetch leaderboard
      const fetchLeaderboard = () =>
        sb.from("match_scores")
          .select("*, profiles(display_name, avatar_url)")
          .eq("match_id", matchId)
          .order("total_score", { ascending: false })
          .limit(20)
          .then(({ data }) => {
            if (data) {
              const rows = data as unknown as LeaderboardRow[];
              setLeaderboard(
                rows.map((row, i) => ({
                  user_id: row.user_id,
                  display_name: row.profiles?.display_name ?? "Player",
                  avatar_url: row.profiles?.avatar_url ?? null,
                  total_score: row.total_score,
                  correct_answers: row.correct_answers,
                  total_answers: row.total_answers ?? 0,
                  current_streak: row.current_streak,
                  rank: i + 1,
                  avg_answer_speed_ms: row.avg_answer_speed_ms ?? null,
                  fastest_answer_ms: row.fastest_answer_ms ?? null,
                }))
              );
            }
          });
      fetchLeaderboard();

      // Realtime
      if (!REALTIME_ENABLED || cancelled) return;
      channel = sb.channel(`match:${matchId}`)
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "question_events",
          filter: `match_id=eq.${matchId}`,
        }, async (payload) => {
          const event = payload.new;
          if (event.status !== "live") return;
          const { data: q } = await sb.from("questions").select("*").eq("id", event.question_id).single();
          if (!q) return;
          // Bank questions store options as a jsonb {A,B,C,D} map and the answer
          // as a letter — map them onto the QuestionCard's flat fields.
          const opts = (q.options ?? {}) as Record<string, string>;
          setActiveQuestion({
            eventId: event.id, questionId: q.id, questionText: q.question,
            optionA: opts.A, optionB: opts.B, optionC: opts.C, optionD: opts.D,
            difficulty: (q.difficulty as "easy" | "medium" | "hard"), category: q.category,
            explanation: q.verification_note ?? null,
            startTime: new Date(event.fired_at), totalSeconds: 45,
          });
          setQuestionCount((n) => n + 1);
        })
        .on("postgres_changes", {
          event: "*", schema: "public", table: "match_scores",
          filter: `match_id=eq.${matchId}`,
        }, fetchLeaderboard)
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "matches",
          filter: `id=eq.${matchId}`,
        }, (payload) => {
          const u = payload.new;
          setMatch((prev) => prev ? {
            ...prev,
            status: u.status ?? prev.status,
            home_score: u.home_score ?? prev.home_score,
            away_score: u.away_score ?? prev.away_score,
          } : prev);
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel && supabaseRef.current) supabaseRef.current.removeChannel(channel);
    };
  }, [matchId]);

  // ── Answer handler ────────────────────────────────────────────────────────
  const handleAnswer = useCallback(async (letter: "a" | "b" | "c" | "d") => {
    if (!activeQuestion) throw new Error("No active question");
    const res = await fetch("/api/answer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionEventId: activeQuestion.eventId, selectedAnswer: letter }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    if (!livePlayedRef.current) { livePlayedRef.current = true; trackGamePlay("quiz", { mode: "live_match" }); }
    return res.json();
  }, [activeQuestion]);

  const handleQuestionExpire = useCallback(() => {
    setTimeout(() => setActiveQuestion(null), 4000);
  }, []);

  // "complete" once a played live match has ended (no longer live, kickoff in the past).
  useEffect(() => {
    if (!match || !livePlayedRef.current || liveCompletedRef.current) return;
    const ended = match.status !== "live" && new Date(match.match_date) <= new Date();
    if (ended) { liveCompletedRef.current = true; trackGameComplete("quiz", { mode: "live_match" }); }
  }, [match]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading || userLoading) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-t-green animate-spin" style={{ borderTopColor: "#00ff87", borderColor: "rgba(255,255,255,0.1)" }} />
      </main>
    );
  }

  if (!match) {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-6">
        <p className="font-display text-5xl mb-4">🤔</p>
        <h1 className="font-display text-3xl text-white mb-3">Match not found</h1>
        <Link href="/" className="font-body text-sm text-text-muted hover:text-white transition-colors">← Back to home</Link>
      </main>
    );
  }

  const matchName = `${match.home_team} vs ${match.away_team}`;
  const isPreMatch = new Date(match.match_date) > new Date();

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.025} />

      {/* Nav */}
      <nav className="relative z-10 pt-safe flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
        <Link href="/join" aria-label="Back to matches"
          className="flex items-center gap-2 -ml-1 px-2 py-1 rounded-lg transition-colors hover:bg-white/5">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#a78bfa" }} />
          </svg>
          <span className="font-body text-sm font-semibold" style={{ color: "#a78bfa" }}>Matches</span>
        </Link>
        <div className="flex items-center gap-2">
          {questionCount > 0 && (
            <span className="font-body text-xs text-text-muted">Q{questionCount}</span>
          )}
          <div className="px-2.5 py-1 rounded-full font-body text-xs font-semibold uppercase tracking-widest"
            style={{
              background: match.status === "live" ? "rgba(0,255,135,0.12)" : "rgba(255,255,255,0.06)",
              color: match.status === "live" ? "#00ff87" : "#888",
              border: `1px solid ${match.status === "live" ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.08)"}`,
            }}>
            {match.status === "live" ? "Live" : isPreMatch ? "Upcoming" : "Ended"}
          </div>
        </div>
      </nav>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4">

        {/* Scoreboard */}
        <MatchHeader match={match} playerCount={leaderboard.length} />

        {/* Pre-match countdown */}
        {isPreMatch && <PreMatchBanner match={match} />}

        {/* Sign-in prompt for guests */}
        {!user && !isPreMatch && <SignInPrompt matchName={matchName} />}

        {/* Next question pulse (logged in, match live, no active question) */}
        {user && match.status === "live" && !activeQuestion && !isPreMatch && (
          <div className="rounded-2xl px-5 py-4 flex items-center gap-4"
            style={{ background: "rgba(255,184,0,0.04)", border: "1px solid rgba(255,184,0,0.15)" }}>
            <div className="flex gap-1 flex-shrink-0">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-2 h-2 rounded-full" style={{ background: "#ffb800", animation: `pulse 1.4s ease-in-out ${i * 0.25}s infinite` }} />
              ))}
            </div>
            <div>
              <p className="font-body text-sm font-semibold text-white">Next question incoming</p>
              <p className="font-body text-xs text-text-muted">Stay here — questions fire without warning</p>
            </div>
          </div>
        )}

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="px-5 py-4 flex items-center justify-between"
              style={{ background: "#12121e", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest">Live Standings</p>
              <span className="font-body text-xs text-text-muted">{leaderboard.length} players</span>
            </div>
            <div className="p-3" style={{ background: "#12121e" }}>
              <Leaderboard entries={leaderboard} currentUserId={user?.id} maxVisible={10} />
            </div>
          </div>
        )}

        {/* My position */}
        {user && (() => {
          const me = leaderboard.find((e) => e.user_id === user.id);
          if (!me) return null;
          return (
            <div className="rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.12)" }}>
              <div>
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-0.5">Your position</p>
                <p className="font-body text-sm font-semibold text-white">
                  {me.current_streak >= 2 ? `🔥 ${me.current_streak}× streak · ` : ""}
                  {me.correct_answers} correct
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl" style={{ color: "#00ff87" }}>#{me.rank}</p>
                <p className="font-body text-xs text-text-muted">{me.total_score.toLocaleString()} pts</p>
              </div>
            </div>
          );
        })()}

        {/* Share */}
        <ShareStrip matchId={matchId} matchName={matchName} />
      </div>

      {/* Live question overlay */}
      {activeQuestion && user && (
        <QuestionCard question={activeQuestion} onAnswer={handleAnswer} onExpire={handleQuestionExpire} />
      )}

      {/* Question locked — not signed in */}
      {activeQuestion && !user && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4" style={{ background: "rgba(10,10,15,0.95)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="font-body text-sm font-semibold text-white mb-3">Question is live — sign in to answer</p>
          <AuthProviders />
        </div>
      )}

      <BottomNav />
    </main>
  );
}

// Event rooms feature removed for v1. The rooms tables and routes are dormant
// pending re-introduction with the live-match flow. Apple reviewer should not
// see any "Join room" links that lead to deleted /room/[id] routes.
