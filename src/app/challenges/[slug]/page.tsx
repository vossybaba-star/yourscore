"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import { getCompetitionBadgeUrl } from "@/lib/competitionImages";
import { slugify } from "@/lib/utils";
import type { Json } from "@/types/database";
import {
  LETTER_COLORS,
  DIFFICULTY_COLOR as DIFF_COLOR,
  DIFFICULTY_BG as DIFF_BG,
  RECORDS_EMOJI,
} from "@/lib/theme";
import {
  calculateBasePoints,
  calculateStreakBonus,
  calculateComebackBonus,
  calculatePerfectRoundBonus,
  maxPointsForDifficulty,
  getSpeedLabel,
} from "@/lib/scoring";

// Solo challenge question window — the reference duration for speed band calculation.
// Players can answer at any time; elapsed is capped at this value for scoring purposes.
const CHALLENGE_WINDOW_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────

interface QuizPack {
  id: string;
  name: string;
  type: string;
  parameter: string;
  question_count: number;
}

interface RawQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: string;
  difficulty: string;
  category: string;
}

interface AnswerRecord {
  idx: number;
  selected: Letter;
  correct: boolean;
  points: number;
  elapsed_ms: number;
}

type Letter = "A" | "B" | "C" | "D";
type Phase = "loading" | "intro" | "playing" | "results";

// ── Timer helpers ─────────────────────────────────────────────────────────

function timerColor(ms: number): string {
  if (ms < 5_000) return "#00ff87";
  if (ms < 10_000) return "#ffb800";
  return "#ff4757";
}

function timerDisplay(ms: number): string {
  return (ms / 1000).toFixed(2) + "s";
}

// ── Misc helpers ──────────────────────────────────────────────────────────

const LETTERS: Letter[] = ["A", "B", "C", "D"];

function scoreData(score: number, max: number) {
  const p = score / max;
  if (p >= 0.9) return { emoji: "🏆", label: "Elite Knowledge", color: "#ffb800" };
  if (p >= 0.75) return { emoji: "⚡", label: "Sharp.", color: "#00ff87" };
  if (p >= 0.55) return { emoji: "⚽", label: "Decent.", color: "#4fc3f7" };
  if (p >= 0.35) return { emoji: "📚", label: "Keep watching.", color: "#a78bfa" };
  return { emoji: "😬", label: "Back to basics.", color: "#ff4757" };
}

// ── ChallengeAFriendButton ────────────────────────────────────────────────

interface ChallengeAFriendButtonProps {
  packId: string;
  packName: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  maxScore: number;
  challengerId: string;
}

function ChallengeAFriendButton({
  packId,
  packName,
  score,
  correctCount,
  totalQuestions,
  maxScore,
  challengerId,
}: ChallengeAFriendButtonProps) {
  const [status, setStatus] = useState<"idle" | "creating" | "created">("idle");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const link = challengeId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/h2h/${challengeId}`
    : "";

  async function handleCreate() {
    if (status !== "idle") return;
    setStatus("creating");
    try {
      const supabase = createClient();

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", challengerId)
        .single();

      const challengerName = profile?.display_name ?? "Someone";

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from("h2h_challenges")
        .insert({
          quiz_pack_id: packId,
          quiz_pack_name: packName,
          challenger_id: challengerId,
          challenger_name: challengerName,
          challenger_score: score,
          challenger_correct: correctCount,
          total_questions: totalQuestions,
          max_score: maxScore,
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (error || !data) {
        setStatus("idle");
        return;
      }

      setChallengeId(data.id);
      setStatus("created");
    } catch {
      setStatus("idle");
    }
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const waText = encodeURIComponent(
    `I scored ${score.toLocaleString()} on "${packName}" — can you beat it? ${link}`
  );

  if (status === "idle") {
    return (
      <button
        onClick={handleCreate}
        className="w-full rounded-2xl py-4 font-display text-sm tracking-widest active:scale-[0.97] transition-transform text-green"
        style={{
          background: "transparent",
          border: "1.5px solid rgba(0,255,135,0.35)",
        }}
      >
        ⚔️ Challenge a friend
      </button>
    );
  }

  if (status === "creating") {
    return (
      <div className="w-full rounded-2xl py-4 flex items-center justify-center gap-3"
        style={{ background: "rgba(0,255,135,0.07)", border: "1px solid rgba(0,255,135,0.2)" }}>
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "#00ff87", borderTopColor: "transparent" }} />
        <span className="font-body text-sm text-text-muted">Creating challenge…</span>
      </div>
    );
  }

  // created
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.2)" }}>
      <div className="flex items-center gap-2">
        <span className="text-lg">⚔️</span>
        <div>
          <p className="font-display text-sm tracking-wide text-green">Challenge created!</p>
          <p className="font-body text-xs text-text-muted">Share the link with a friend</p>
        </div>
      </div>

      <div className="rounded-xl px-3 py-2.5 font-body text-xs break-all bg-bg border border-border"
        style={{ color: "#7777aa" }}>
        {link}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 rounded-xl py-3 font-display text-xs tracking-widest active:scale-[0.97] transition-transform"
          style={{
            background: copied ? "rgba(0,255,135,0.15)" : "rgba(255,255,255,0.07)",
            border: copied ? "1px solid rgba(0,255,135,0.4)" : "1px solid rgba(255,255,255,0.1)",
            color: copied ? "#00ff87" : "#aaaacc",
          }}
        >
          {copied ? "✓ COPIED" : "COPY LINK"}
        </button>

        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl py-3 font-display text-xs tracking-widest text-center active:scale-[0.97] transition-transform"
          style={{
            background: "rgba(37,211,102,0.12)",
            border: "1px solid rgba(37,211,102,0.3)",
            color: "#25d366",
          }}
        >
          WHATSAPP
        </a>
      </div>

      <a
        href="/challenges"
        className="block w-full text-center rounded-xl py-3 font-display text-xs tracking-widest active:scale-[0.97] transition-transform border border-border"
        style={{
          background: "transparent",
          color: "#555577",
        }}
      >
        ← MORE CHALLENGES
      </a>
    </div>
  );
}

// ── PackLeaderboard ───────────────────────────────────────────────────────

interface LeaderEntry {
  user_id: string;
  score: number;
  correct_count: number;
  display_name: string | null;
}

// Shape of a quiz_attempts row joined with profiles, as read at the query boundary.
interface LeaderRow {
  user_id: string;
  score: number;
  correct_count: number;
  profiles: { display_name: string | null } | null;
}

function PackLeaderboard({ entries, userId, accent, loading }: {
  entries: LeaderEntry[];
  userId: string | null;
  accent: string;
  loading?: boolean;
}) {
  const userRank = userId ? entries.findIndex(e => e.user_id === userId) + 1 : 0;
  const MEDALS = ["🥇", "🥈", "🥉"];
  const RANK_COLORS = ["#ffb800", "#aaaacc", "#cd7f32"];

  return (
    <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <p className="font-display text-xs tracking-widest" style={{ color: "#555577" }}>LEADERBOARD</p>
        {userRank > 0 && (
          <span className="font-display text-xs px-2 py-0.5 rounded-full"
            style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}>
            YOU #{userRank}
          </span>
        )}
      </div>
      {loading ? (
        <div className="px-5 pb-5 text-center">
          <p className="font-body text-xs" style={{ color: "#555577" }}>Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-5 pb-5 text-center">
          <p className="font-body text-sm text-white mb-1">No scores yet</p>
          <p className="font-body text-xs" style={{ color: "#555577" }}>Be the first to set a score!</p>
        </div>
      ) : (
        <div className="pb-2">
          {entries.map((entry, idx) => {
            const rank = idx + 1;
            const isUser = entry.user_id === userId;
            return (
              <div key={entry.user_id + idx}
                className="flex items-center gap-3 px-5 py-3 transition-colors"
                style={{
                  background: isUser ? `${accent}0f` : undefined,
                  borderLeft: isUser ? `3px solid ${accent}` : "3px solid transparent",
                }}>
                <span className="font-display text-sm w-7 text-center flex-shrink-0"
                  style={{ color: rank <= 3 ? RANK_COLORS[rank - 1] : "#44446a" }}>
                  {rank <= 3 ? MEDALS[rank - 1] : rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm truncate" style={{ color: isUser ? "#ffffff" : "#aaaacc" }}>
                    {isUser
                      ? `You${entry.display_name ? ` (${entry.display_name})` : ""}`
                      : (entry.display_name ?? "Player")}
                  </p>
                  <p className="font-body text-xs mt-0.5" style={{ color: "#555577" }}>
                    {entry.correct_count} correct
                  </p>
                </div>
                <span className="font-display text-sm flex-shrink-0"
                  style={{ color: isUser ? accent : "#8888aa" }}>
                  {entry.score.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ChallengePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [pack, setPack] = useState<QuizPack | null>(null);
  const [questions, setQuestions] = useState<RawQuestion[]>([]);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [priorAttempt, setPriorAttempt] = useState<{ score: number; max_score: number; correct_count: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [leaderLoading, setLeaderLoading] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answerLog, setAnswerLog] = useState<AnswerRecord[]>([]);
  const [score, setScore] = useState(0);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [lastSpeedLabel, setLastSpeedLabel] = useState<string | null>(null);
  const [lastStreakBonus, setLastStreakBonus] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [saved, setSaved] = useState(false);
  // Streak tracking for bonuses
  const [correctStreak, setCorrectStreak] = useState(0);
  const [wrongStreak, setWrongStreak] = useState(0);

  // ── Timer ──────────────────────────────────────────────────────────────
  const [timerMs, setTimerMs] = useState(0);
  const questionStartRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    questionStartRef.current = Date.now();
    setTimerMs(0);
    timerIntervalRef.current = setInterval(() => {
      setTimerMs(Date.now() - questionStartRef.current);
    }, 30); // ~33fps — smooth enough for two decimal places
  }, [stopTimer]);

  // Start/reset timer whenever the question index changes (or phase enters playing)
  useEffect(() => {
    if (phase === "playing") startTimer();
    return stopTimer;
  }, [currentIdx, phase, startTimer, stopTimer]);

  // Re-fetch leaderboard after score saved so the user sees their position
  useEffect(() => {
    if (!saved || !pack) return;
    const sb = createClient();
    setLeaderLoading(true);
    sb.from("quiz_attempts")
      .select("user_id, score, correct_count, profiles(display_name)")
      .eq("pack_id", pack.id)
      .order("score", { ascending: false })
      .limit(25)
      .then(({ data }) => {
        if (data) {
          const rows = data as unknown as LeaderRow[];
          setLeaderboard(rows.map((r) => ({
            user_id: r.user_id,
            score: r.score,
            correct_count: r.correct_count,
            display_name: r.profiles?.display_name ?? null,
          })));
        }
        setLeaderLoading(false);
      });
  }, [saved, pack]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load pack + auth ───────────────────────────────────────────────────
  useEffect(() => {
    if (!slug) return;
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      const sb = supabase;

      const { data: packs } = await sb
        .from("quiz_packs")
        .select("id, name, type, parameter, question_count, questions")
        .eq("status", "published");

      const match = ((packs ?? []) as unknown as (QuizPack & { questions: RawQuestion[] })[]).find(
        (p) => slugify(p.name) === slug
      );
      if (!match) { router.replace("/challenges"); return; }

      setPack(match);
      setQuestions(match.questions ?? []);

      if (match.type === "club") {
        getTeamBadgeUrl(match.name).then((u: string | null) => { if (u) setBadgeUrl(u); });
      } else if (match.type === "end_of_season" && match.parameter) {
        // End-of-season packs (e.g. "Arsenal Are Champions") store the team name in `parameter`
        getTeamBadgeUrl(match.parameter).then((u: string | null) => {
          if (u) { setBadgeUrl(u); return; }
          getCompetitionBadgeUrl(match.name).then((cu: string | null) => { if (cu) setBadgeUrl(cu); });
        });
      } else {
        getCompetitionBadgeUrl(match.name).then((u: string | null) => { if (u) setBadgeUrl(u); });
      }

      if (uid) {
        const { data: attempt } = await sb
          .from("quiz_attempts")
          .select("score, max_score, correct_count")
          .eq("user_id", uid)
          .eq("pack_id", match.id)
          .single();
        if (attempt) setPriorAttempt(attempt);
      }

      // Fetch leaderboard
      setLeaderLoading(true);
      const { data: lbRows } = await sb
        .from("quiz_attempts")
        .select("user_id, score, correct_count, profiles(display_name)")
        .eq("pack_id", match.id)
        .order("score", { ascending: false })
        .limit(25);
      if (lbRows) {
        setLeaderboard((lbRows as unknown as LeaderRow[]).map((r) => ({
          user_id: r.user_id,
          score: r.score,
          correct_count: r.correct_count,
          display_name: r.profiles?.display_name ?? null,
        })));
      }
      setLeaderLoading(false);

      setPhase("intro");
    });
  }, [slug, router]);

  const currentQ = questions[currentIdx];
  // Max score: sum of Lightning-speed points per question by difficulty
  const maxScore = questions.reduce((s, q) => s + maxPointsForDifficulty(q.difficulty ?? "medium"), 0);

  // ── Answer handler ─────────────────────────────────────────────────────
  async function handleAnswer(letter: Letter) {
    if (selected || revealed || advancing) return;

    stopTimer();
    const elapsed = Date.now() - questionStartRef.current;
    const isCorrect = letter === (currentQ.answer as Letter);
    const difficulty = currentQ.difficulty ?? "medium";

    const base         = calculateBasePoints(isCorrect, elapsed, difficulty, CHALLENGE_WINDOW_MS);
    const streakBonus  = calculateStreakBonus(correctStreak, isCorrect);
    const comebackBonus = calculateComebackBonus(wrongStreak, isCorrect);
    const pts = base + streakBonus + comebackBonus;

    // Update streaks
    if (isCorrect) {
      setCorrectStreak((s) => s + 1);
      setWrongStreak(0);
    } else {
      setCorrectStreak(0);
      setWrongStreak((s) => s + 1);
    }

    setSelected(letter);
    setRevealed(true);
    setLastPoints(isCorrect ? pts : null);
    setLastSpeedLabel(isCorrect ? getSpeedLabel(elapsed, CHALLENGE_WINDOW_MS) : null);
    setLastStreakBonus(streakBonus + comebackBonus);
    if (isCorrect) setScore((s) => s + pts);

    const record: AnswerRecord = { idx: currentIdx, selected: letter, correct: isCorrect, points: pts, elapsed_ms: elapsed };
    const newLog = [...answerLog, record];
    setAnswerLog(newLog);

    setAdvancing(true);
    setTimeout(async () => {
      if (currentIdx + 1 >= questions.length) {
        const correctCount = newLog.filter((r) => r.correct).length;
        const perfectBonus = calculatePerfectRoundBonus(correctCount, questions.length);
        const finalScore = newLog.reduce((s, r) => s + r.points, 0) + perfectBonus;
        if (userId && pack && !priorAttempt) {
          const { error } = await createClient()
            .from("quiz_attempts")
            .insert({ user_id: userId, pack_id: pack.id, score: finalScore, max_score: maxScore, correct_count: correctCount, answers: newLog as unknown as Json });
          if (!error) setSaved(true);
        }
        setScore(finalScore);
        setPhase("results");
      } else {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setRevealed(false);
        setLastPoints(null);
        setLastSpeedLabel(null);
        setLastStreakBonus(0);
      }
      setAdvancing(false);
    }, 1800);
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#ffb800", borderTopColor: "transparent" }} />
          <p className="font-display text-xs tracking-widest text-text-muted">LOADING…</p>
        </div>
      </div>
    );
  }

  // ── Intro ─────────────────────────────────────────────────────────────────
  if (phase === "intro" && pack) {
    const isRecords = pack.type === "records";
    const accent = isRecords ? "#a78bfa" : "#ffb800";
    const accentDim = isRecords ? "rgba(167,139,250,0.15)" : "rgba(255,184,0,0.15)";
    const accentBorder = isRecords ? "rgba(167,139,250,0.35)" : "rgba(255,184,0,0.35)";
    const gradientHero = isRecords
      ? "linear-gradient(175deg, #1a0f30 0%, #130e22 50%, #0a0a0f 100%)"
      : "linear-gradient(175deg, #1f1400 0%, #17100a 50%, #0a0a0f 100%)";
    const diffCounts = questions.reduce((acc, q) => {
      const d = q.difficulty?.toLowerCase() ?? "medium";
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (
      <div className="min-h-screen flex flex-col bg-bg">
        <div className="relative" style={{ background: gradientHero }}>
          <button
            onClick={() => router.back()}
            className="absolute top-12 left-5 flex items-center gap-1.5 font-body text-xs z-10"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Challenges
          </button>

          <div className="flex flex-col items-center pt-24 pb-8 px-6">
            <div className="relative flex items-center justify-center mb-5"
              style={{ width: 110, height: 110, borderRadius: 28, background: accentDim, border: `1.5px solid ${accentBorder}` }}>
              <div style={{ position: "absolute", inset: -8, borderRadius: 36,
                background: isRecords ? "rgba(167,139,250,0.12)" : "rgba(255,184,0,0.12)", filter: "blur(12px)" }} />
              {badgeUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={badgeUrl} alt={pack.name} width={80} height={80}
                  style={{ objectFit: "contain", position: "relative", zIndex: 1,
                    filter: `drop-shadow(0 4px 16px ${isRecords ? "rgba(167,139,250,0.5)" : "rgba(255,184,0,0.5)"})` }} />
              ) : (
                <span className="text-5xl relative z-1">{RECORDS_EMOJI[pack.name] ?? (isRecords ? "📊" : pack.name[0])}</span>
              )}
            </div>

            <h1 className="font-display text-2xl text-white text-center leading-tight mb-1">{pack.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-body text-xs px-3 py-1 rounded-full"
                style={{ background: accentDim, color: accent, border: `1px solid ${accentBorder}` }}>
                {isRecords ? "All-Time Records" : "2025/26 Season Game"}
              </span>
              <span className="font-body text-xs px-3 py-1 rounded-full"
                style={{ background: "rgba(255,255,255,0.06)", color: "#aaaacc" }}>
                {questions.length} questions
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 px-5 py-6 flex flex-col gap-4">
          {priorAttempt && (
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{ background: "rgba(0,255,135,0.07)", border: "1px solid rgba(0,255,135,0.2)" }}>
              <span className="text-lg">🏆</span>
              <div className="flex-1 min-w-0">
                <p className="font-display text-xs tracking-widest mb-0.5 text-green">YOUR LEADERBOARD SCORE</p>
                <p className="font-body text-xs text-text-muted">
                  <span className="font-display text-base text-white">{priorAttempt.score.toLocaleString()}</span>
                  {" "}pts · {priorAttempt.correct_count}/{questions.length} correct
                </p>
              </div>
            </div>
          )}

          <>
            <div className="rounded-2xl p-4 flex items-center gap-0 bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                {(["easy", "medium", "hard"] as const).map((d, i) => (
                  <div key={d} className="flex flex-col items-center flex-1"
                    style={{ borderRight: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                    <span className="font-display text-2xl" style={{ color: DIFF_COLOR[d] }}>{diffCounts[d] ?? 0}</span>
                    <span className="font-body text-xs mt-1 capitalize px-2 py-0.5 rounded-full"
                      style={{ background: DIFF_BG[d], color: DIFF_COLOR[d] }}>{d}</span>
                  </div>
                ))}
              </div>

              {/* Scoring explainer */}
              <div className="rounded-2xl px-4 py-4 bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">⚡</span>
                  <p className="font-display text-sm text-white tracking-wide">Speed scoring</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {[
                    { time: "Instant", pts: "1,000", color: "#00ff87" },
                    { time: "~5s", pts: "775", color: "#ffb800" },
                    { time: "~10s", pts: "550", color: "#ff4757" },
                  ].map(({ time, pts, color }) => (
                    <div key={time} className="flex-1 rounded-xl py-2.5 px-2 text-center"
                      style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
                      <p className="font-display text-sm" style={{ color }}>{pts}</p>
                      <p className="font-body text-xs mt-0.5" style={{ color: "#7777aa" }}>{time}</p>
                    </div>
                  ))}
                </div>
              </div>

              <PackLeaderboard entries={leaderboard} userId={userId} accent={accent} loading={leaderLoading} />

              <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.2)" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 5v4M8 10.5v.5" stroke="#ff4757" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p className="font-body text-sm font-semibold text-danger">
                  {priorAttempt
                    ? "Play again for practice — your leaderboard score is locked in."
                    : "Your first score goes on the leaderboard — it’s final once you start."}
                </p>
              </div>

              <button
                onClick={() => setPhase("playing")}
                className="w-full rounded-2xl py-4 font-display text-lg tracking-widest transition-transform active:scale-[0.97] mt-1 text-white"
                style={{
                  background: isRecords
                    ? "linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)"
                    : "linear-gradient(135deg, #e65c00 0%, #ffb800 100%)",
                  boxShadow: isRecords ? "0 4px 24px rgba(124,58,237,0.4)" : "0 4px 24px rgba(255,140,0,0.35)",
                }}
              >
                START GAME
              </button>

              {!userId && (
                <p className="font-body text-xs text-center" style={{ color: "#555577" }}>
                  Playing as guest —{" "}
                  <Link href={`/auth/sign-in?next=/challenges/${slug}`}
                    style={{ color: "#a78bfa", textDecoration: "underline" }}>sign in first</Link>
                  {" "}to save your score
                </p>
              )}
          </>
        </div>
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  if (phase === "playing" && currentQ) {
    const progressFilled = ((currentIdx + (revealed ? 1 : 0)) / questions.length) * 100;
    const diff = currentQ.difficulty?.toLowerCase() ?? "medium";
    const diffColor = DIFF_COLOR[diff] ?? "#ffb800";
    const diffBg = DIFF_BG[diff] ?? "rgba(255,184,0,0.12)";
    const isRecords = pack?.type === "records";
    const accent = isRecords ? "#a78bfa" : "#ffb800";
    const tColor = timerColor(timerMs);

    return (
      <div className="min-h-screen flex flex-col bg-bg">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 pt-safe"
          style={{ background: "rgba(10,10,15,0.98)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          {/* Progress bar */}
          <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full transition-all duration-700 ease-out"
              style={{ width: `${progressFilled}%`,
                background: isRecords ? "linear-gradient(90deg, #7c3aed, #a78bfa)" : "linear-gradient(90deg, #e65c00, #ffb800)" }} />
          </div>

          <div className="px-5 py-3 flex items-center justify-between gap-3">
            {/* Quit */}
            <button
              onClick={() => {
                if (window.confirm("Quit? Your progress won't be saved.")) {
                  stopTimer();
                  setPhase("intro"); setCurrentIdx(0); setSelected(null);
                  setRevealed(false); setScore(0); setAnswerLog([]); setLastPoints(null); setTimerMs(0);
                }
              }}
              className="flex items-center gap-1.5 font-body text-xs flex-shrink-0"
              style={{ color: "#555577" }}
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Quit
            </button>

            {/* Timer — counts up, colour-coded */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl flex-1 justify-center"
              style={{ background: `${tColor}10`, border: `1px solid ${tColor}28` }}>
              {/* Pulse dot */}
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: tColor, display: "inline-block",
                boxShadow: revealed ? "none" : `0 0 6px ${tColor}`,
                opacity: revealed ? 0.4 : 1,
              }} />
              <span className="font-display text-base tabular-nums" style={{ color: tColor, letterSpacing: "0.02em" }}>
                {timerDisplay(timerMs)}
              </span>
            </div>

            {/* Score */}
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl flex-shrink-0"
              style={{ background: `${accent}12`, border: `1px solid ${accent}25` }}>
              <span className="font-display text-sm" style={{ color: accent }}>{score.toLocaleString()}</span>
              <span className="font-body text-xs" style={{ color: "#666688" }}>pts</span>
            </div>
          </div>

          {/* Question counter */}
          <div className="px-5 pb-2.5 flex items-center gap-2">
            {badgeUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={badgeUrl} alt="" width={18} height={18} style={{ objectFit: "contain", opacity: 0.6 }} />
            )}
            <span className="font-body text-xs" style={{ color: "#555577" }}>
              Question <span className="text-white">{currentIdx + 1}</span> of {questions.length}
            </span>
            <span className="ml-auto font-display text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider"
              style={{ background: diffBg, color: diffColor, border: `1px solid ${diffColor}30` }}>
              {diff}
            </span>
          </div>
        </div>

        {/* Question body */}
        <div className="flex-1 px-5 pb-10 pt-4 flex flex-col">
          {currentQ.category && (
            <span className="font-body text-xs px-2.5 py-1 rounded-full capitalize mb-4 self-start"
              style={{ background: "rgba(255,255,255,0.05)", color: "#7777aa" }}>
              {currentQ.category.replace(/_/g, " ")}
            </span>
          )}

          {/* Question card */}
          <div className="rounded-2xl p-5 mb-5"
            style={{ background: "linear-gradient(145deg, #14141f 0%, #1a1a2c 100%)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 100 }}>
            <p className="font-body text-base font-semibold text-white leading-relaxed">{currentQ.question}</p>
          </div>

          {/* Answer buttons */}
          <div className="space-y-3">
            {LETTERS.map((letter) => {
              const optionText = currentQ.options[letter];
              const isSelected = selected === letter;
              const isCorrectAnswer = revealed && letter === (currentQ.answer as Letter);
              const isWrong = revealed && isSelected && !isCorrectAnswer;
              const isDimmed = revealed && !isCorrectAnswer && letter !== selected;
              const lColor = LETTER_COLORS[letter];

              let cardBg = "rgba(255,255,255,0.03)";
              let cardBorder = "rgba(255,255,255,0.09)";
              let textColor = "#e0e0f0";
              let chipBg = `${lColor}18`;
              let chipColor = lColor;

              if (isCorrectAnswer) {
                cardBg = "rgba(0,255,135,0.1)"; cardBorder = "#00ff87"; textColor = "#00ff87";
                chipBg = "#00ff87"; chipColor = "#0a0a0f";
              } else if (isWrong) {
                cardBg = "rgba(255,71,87,0.08)"; cardBorder = "rgba(255,71,87,0.5)"; textColor = "#ff4757";
                chipBg = "rgba(255,71,87,0.2)"; chipColor = "#ff4757";
              } else if (isDimmed) {
                cardBg = "transparent"; cardBorder = "rgba(255,255,255,0.04)"; textColor = "#444466";
                chipBg = "rgba(255,255,255,0.03)"; chipColor = "#444466";
              } else if (isSelected && !revealed) {
                cardBg = `${accent}10`; cardBorder = `${accent}50`; textColor = accent;
                chipBg = `${accent}25`; chipColor = accent;
              }

              return (
                <button key={letter} onClick={() => handleAnswer(letter)} disabled={!!selected}
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.98]"
                  style={{ background: cardBg, border: `1.5px solid ${cardBorder}`, color: textColor, minHeight: 58 }}>
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center font-display text-sm flex-shrink-0 transition-all"
                    style={{ background: chipBg, color: chipColor }}>
                    {isCorrectAnswer ? "✓" : isWrong ? "✗" : letter}
                  </span>
                  <span className="font-body text-sm font-medium leading-snug">{optionText}</span>
                </button>
              );
            })}
          </div>

          {/* Reveal banner */}
          {revealed && (
            <div className="mt-4 rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{
                background: selected === (currentQ.answer as Letter) ? "rgba(0,255,135,0.08)" : "rgba(255,71,87,0.08)",
                border: `1px solid ${selected === (currentQ.answer as Letter) ? "rgba(0,255,135,0.22)" : "rgba(255,71,87,0.22)"}`,
              }}>
              <div>
                <span className="font-display text-lg tracking-wider"
                  style={{ color: selected === (currentQ.answer as Letter) ? "#00ff87" : "#ff4757" }}>
                  {selected === (currentQ.answer as Letter) ? "✓ CORRECT" : "✗ WRONG"}
                </span>
                {selected !== (currentQ.answer as Letter) && (
                  <p className="font-body text-xs mt-0.5 text-text-muted">
                    Answer: <span className="text-white">{currentQ.options[currentQ.answer as Letter]}</span>
                  </p>
                )}
              </div>
              {lastPoints !== null && (
                <div className="text-right">
                  <div className="font-display text-2xl text-amber">+{lastPoints.toLocaleString()}</div>
                  {lastSpeedLabel && (
                    <div className="font-body text-xs mt-0.5 text-text-muted">{lastSpeedLabel}</div>
                  )}
                  {lastStreakBonus > 0 && (
                    <div className="font-body text-xs" style={{ color: "#a78bfa" }}>+{lastStreakBonus} bonus</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Results ───────────────────────────────────────────────────────────────
  if (phase === "results" && pack) {
    const correctCount = answerLog.filter((r) => r.correct).length;
    const perfectBonus = calculatePerfectRoundBonus(correctCount, questions.length);
    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const isRecords = pack.type === "records";
    const accent = isRecords ? "#a78bfa" : "#ffb800";
    const { emoji, label, color } = scoreData(score, maxScore);
    const avgTime = answerLog.length
      ? Math.round(answerLog.reduce((s, r) => s + r.elapsed_ms, 0) / answerLog.length)
      : 0;
    const fastestMs = answerLog.length ? Math.min(...answerLog.map(r => r.elapsed_ms)) : 0;

    const byDiff = (["easy", "medium", "hard"] as const).map((d) => {
      const dQs = questions.map((q, i) => ({ q, i })).filter(({ q }) => (q.difficulty?.toLowerCase() ?? "medium") === d);
      const correct = dQs.filter(({ i }) => answerLog.find((r) => r.idx === i)?.correct).length;
      return { d, correct, total: dQs.length };
    }).filter(({ total }) => total > 0);

    return (
      <div className="min-h-screen flex flex-col bg-bg" style={{ paddingBottom: 40 }}>
        {/* Hero */}
        <div className="relative flex flex-col items-center pt-16 pb-10 px-6"
          style={{ background: isRecords
            ? "linear-gradient(175deg, #1a0f30 0%, #0e0c1a 60%, #0a0a0f 100%)"
            : "linear-gradient(175deg, #1f1200 0%, #12100a 60%, #0a0a0f 100%)" }}>
          {badgeUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeUrl} alt={pack.name} width={52} height={52}
              style={{ objectFit: "contain", marginBottom: 16, opacity: 0.85,
                filter: `drop-shadow(0 4px 12px ${isRecords ? "rgba(167,139,250,0.4)" : "rgba(255,184,0,0.4)"})` }} />
          )}

          <div className="font-display text-7xl mb-1" style={{ color: accent }}>
            {score.toLocaleString()}
          </div>
          <p className="font-body text-sm mb-3 text-text-muted">
            out of {maxScore.toLocaleString()} pts
          </p>

          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full"
            style={{ background: `${color}15`, border: `1px solid ${color}35` }}>
            <span className="text-xl">{emoji}</span>
            <span className="font-display text-base tracking-wide" style={{ color }}>{label}</span>
          </div>

          {perfectBonus > 0 && (
            <div className="flex items-center gap-2 mt-3 px-4 py-2 rounded-full"
              style={{ background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.25)" }}>
              <span className="text-base">🏆</span>
              <span className="font-body text-xs font-semibold text-green">
                Perfect round +{perfectBonus} pts
              </span>
            </div>
          )}

          <div className="flex items-center gap-6 mt-5">
            <div className="text-center">
              <div className="font-display text-2xl text-white">{correctCount}/{questions.length}</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#7777aa" }}>Correct</div>
            </div>
            <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-display text-2xl" style={{ color: accent }}>{pct}%</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#7777aa" }}>Accuracy</div>
            </div>
            <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-display text-2xl text-green">{timerDisplay(fastestMs)}</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#7777aa" }}>Fastest</div>
            </div>
          </div>
        </div>

        <div className="px-5 flex flex-col gap-4 mt-2">
          {/* Timing stats */}
          <div className="rounded-2xl p-5 bg-surface"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#555577" }}>YOUR TIMING</p>
            <div className="flex items-center justify-around">
              {[
                { label: "Avg time", value: timerDisplay(avgTime), color: "#aaaacc" },
                { label: "Fastest", value: timerDisplay(fastestMs), color: "#00ff87" },
                { label: "Points/Q", value: Math.round(score / Math.max(correctCount, 1)).toLocaleString(), color: accent },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <div className="font-display text-xl" style={{ color }}>{value}</div>
                  <div className="font-body text-xs mt-1" style={{ color: "#666688" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard */}
          <PackLeaderboard entries={leaderboard} userId={userId} accent={accent} loading={leaderLoading} />

          {/* Difficulty breakdown */}
          <div className="rounded-2xl p-5 bg-surface"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#555577" }}>BY DIFFICULTY</p>
            <div className="space-y-4">
              {byDiff.map(({ d, correct, total }) => (
                <div key={d} className="flex items-center gap-3">
                  <span className="font-body text-xs capitalize w-14 flex-shrink-0" style={{ color: DIFF_COLOR[d] }}>{d}</span>
                  <div className="flex-1 relative" style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 99 }}>
                    <div className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(correct / total) * 100}%`, background: DIFF_COLOR[d] }} />
                  </div>
                  <span className="font-display text-xs w-10 text-right text-text-muted">{correct}/{total}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sign-up / saved */}
          {userId ? (
            priorAttempt ? (
              <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
                style={{ background: "rgba(255,184,0,0.07)", border: "1px solid rgba(255,184,0,0.2)" }}>
                <span className="text-xl">🎯</span>
                <div>
                  <p className="font-display text-sm tracking-wide text-amber">Practice run</p>
                  <p className="font-body text-xs text-text-muted">
                    Your leaderboard score is still{" "}
                    <span className="text-white font-semibold">{priorAttempt.score.toLocaleString()}</span> pts
                  </p>
                </div>
              </div>
            ) : saved ? (
              <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
                style={{ background: "rgba(0,255,135,0.07)", border: "1px solid rgba(0,255,135,0.2)" }}>
                <span className="text-xl">✓</span>
                <div>
                  <p className="font-display text-sm tracking-wide text-green">Score saved ✓</p>
                  <p className="font-body text-xs text-text-muted">You&apos;re on the leaderboard</p>
                </div>
              </div>
            ) : null
          ) : (
            <div className="rounded-2xl p-5"
              style={{ background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.22)" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-2xl px-3 py-2 font-display text-xl"
                  style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>
                  {score.toLocaleString()}
                </div>
                <div>
                  <p className="font-body text-sm font-semibold text-white">Save your score</p>
                  <p className="font-body text-xs text-text-muted">See where you rank against everyone</p>
                </div>
              </div>
              <Link href={`/auth/sign-in?next=/challenges/${slug}`}
                className="block w-full rounded-xl py-3.5 text-center font-display text-sm tracking-widest active:scale-[0.97] transition-transform text-white"
                style={{ background: "linear-gradient(135deg, #7c3aed, #a78bfa)" }}>
                SIGN UP &amp; SAVE SCORE
              </Link>
            </div>
          )}

          {userId && (
            <ChallengeAFriendButton
              packId={pack.id}
              packName={pack.name}
              score={score}
              correctCount={correctCount}
              totalQuestions={questions.length}
              maxScore={maxScore}
              challengerId={userId}
            />
          )}

          <button onClick={() => router.push("/challenges")}
            className="w-full rounded-2xl py-4 font-display text-sm tracking-widest active:scale-[0.97] transition-transform text-white"
            style={{
              background: isRecords ? "linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)" : "linear-gradient(135deg, #e65c00 0%, #ffb800 100%)",
              boxShadow: isRecords ? "0 4px 24px rgba(124,58,237,0.3)" : "0 4px 24px rgba(255,140,0,0.25)",
            }}>
            MORE CHALLENGES →
          </button>
        </div>
      </div>
    );
  }

  return null;
}
