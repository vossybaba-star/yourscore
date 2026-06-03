/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SignInWithGoogle } from "@/components/auth/AuthButton";

// ── Types ─────────────────────────────────────────────────────────────────

interface H2HChallenge {
  id: string;
  quiz_pack_id: string;
  quiz_pack_name: string;
  challenger_id: string;
  challenger_name: string;
  challenger_score: number;
  challenger_correct: number;
  total_questions: number;
  max_score: number;
  opponent_id: string | null;
  opponent_score: number | null;
  opponent_correct: number | null;
  created_at: string;
  expires_at: string;
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

type PageState =
  | "loading"
  | "not_found"
  | "own_challenge"
  | "results"
  | "ready_to_play"
  | "sign_in_needed"
  | "playing";

// ── Scoring constants ──────────────────────────────────────────────────────

const MAX_PTS = 1000;
const MIN_PTS = 100;
const DECAY_MS = 20_000;

function calcPoints(elapsedMs: number): number {
  if (elapsedMs <= 0) return MAX_PTS;
  const ratio = Math.min(elapsedMs / DECAY_MS, 1);
  return Math.max(MIN_PTS, Math.round(MAX_PTS - ratio * (MAX_PTS - MIN_PTS)));
}

function timerColor(ms: number): string {
  if (ms < 5_000) return "#00ff87";
  if (ms < 10_000) return "#ffb800";
  return "#ff4757";
}

function timerDisplay(ms: number): string {
  return (ms / 1000).toFixed(2) + "s";
}

const LETTERS: Letter[] = ["A", "B", "C", "D"];

const LETTER_COLORS: Record<Letter, string> = {
  A: "#4fc3f7",
  B: "#a78bfa",
  C: "#ffb800",
  D: "#f97316",
};

const DIFF_COLOR: Record<string, string> = {
  easy: "#00ff87",
  medium: "#ffb800",
  hard: "#ff4757",
};

const DIFF_BG: Record<string, string> = {
  easy: "rgba(0,255,135,0.12)",
  medium: "rgba(255,184,0,0.12)",
  hard: "rgba(255,71,87,0.12)",
};

// ── Share card helper ──────────────────────────────────────────────────────

function ShareCard({ challenge }: { challenge: H2HChallenge }) {
  const [copied, setCopied] = useState(false);

  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/h2h/${challenge.id}`
      : `/h2h/${challenge.id}`;

  const waText = encodeURIComponent(
    `I scored ${challenge.challenger_score.toLocaleString()} on "${challenge.quiz_pack_name}" — can you beat it? ${link}`
  );

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.2)" }}>
      <div className="rounded-xl px-3 py-2.5 font-body text-xs break-all"
        style={{ background: "#0a0a0f", border: "1px solid rgba(255,255,255,0.08)", color: "#7777aa" }}>
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
    </div>
  );
}

// ── Avatar initial ─────────────────────────────────────────────────────────

function Avatar({ name, color, size = 48 }: { name: string; color: string; size?: number }) {
  return (
    <div
      className="flex items-center justify-center font-display text-lg font-bold rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: `${color}20`,
        border: `2px solid ${color}40`,
        color,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function H2HPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [pageState, setPageState] = useState<PageState>("loading");
  const [challenge, setChallenge] = useState<H2HChallenge | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [opponentName, setOpponentName] = useState<string>("You");

  // Quiz engine state
  const [questions, setQuestions] = useState<RawQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answerLog, setAnswerLog] = useState<AnswerRecord[]>([]);
  const [score, setScore] = useState(0);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);

  // Timer
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
    }, 30);
  }, [stopTimer]);

  useEffect(() => {
    if (pageState === "playing") startTimer();
    return stopTimer;
  }, [currentIdx, pageState, startTimer, stopTimer]);

  // ── Initial load ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;

    const supabase = createClient() as any;

    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid: string | null = userData.user?.id ?? null;
      setUserId(uid);

      if (uid) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", uid)
          .single();
        setOpponentName(profile?.display_name ?? "You");
      }

      const { data: ch } = await supabase
        .from("h2h_challenges")
        .select("*")
        .eq("id", id)
        .single();

      if (!ch) {
        setPageState("not_found");
        return;
      }

      // Check expiry
      if (new Date(ch.expires_at) < new Date()) {
        setPageState("not_found");
        return;
      }

      setChallenge(ch);

      // Determine state
      if (ch.opponent_score !== null) {
        setPageState("results");
      } else if (uid === ch.challenger_id) {
        setPageState("own_challenge");
      } else if (!uid) {
        setPageState("sign_in_needed");
      } else {
        setPageState("ready_to_play");
      }
    }

    load();
  }, [id]);

  // ── Fetch questions when transitioning to playing ──────────────────────
  async function startPlaying() {
    if (!challenge) return;
    const supabase = createClient() as any;
    const { data: pack } = await supabase
      .from("quiz_packs")
      .select("questions")
      .eq("id", challenge.quiz_pack_id)
      .single();

    if (!pack?.questions) return;

    setQuestions(pack.questions);
    setCurrentIdx(0);
    setSelected(null);
    setRevealed(false);
    setAnswerLog([]);
    setScore(0);
    setLastPoints(null);
    setPageState("playing");
  }

  // ── Answer handler ─────────────────────────────────────────────────────
  async function handleAnswer(letter: Letter) {
    if (!challenge || selected || revealed || advancing) return;
    const currentQ = questions[currentIdx];
    if (!currentQ) return;

    stopTimer();
    const elapsed = Date.now() - questionStartRef.current;
    const isCorrect = letter === (currentQ.answer as Letter);
    const pts = isCorrect ? calcPoints(elapsed) : 0;

    setSelected(letter);
    setRevealed(true);
    setLastPoints(isCorrect ? pts : null);
    if (isCorrect) setScore((s) => s + pts);

    const record: AnswerRecord = {
      idx: currentIdx,
      selected: letter,
      correct: isCorrect,
      points: pts,
      elapsed_ms: elapsed,
    };
    const newLog = [...answerLog, record];
    setAnswerLog(newLog);

    setAdvancing(true);
    setTimeout(async () => {
      if (currentIdx + 1 >= questions.length) {
        // Local tally for immediate display; the server re-grades authoritatively.
        let finalScore = newLog.reduce((s, r) => s + r.points, 0);
        let correctCount = newLog.filter((r) => r.correct).length;

        if (userId) {
          // Server grades the answers against the pack and writes the score.
          // The client can no longer set opponent_score directly.
          const res = await fetch("/api/h2h/play", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challengeId: challenge.id,
              answers: newLog.map((r) => ({
                letter: r.selected,
                elapsedMs: r.elapsed_ms,
              })),
            }),
          });

          if (res.ok) {
            const data = await res.json();
            finalScore = data.opponentScore;
            correctCount = data.opponentCorrect;
            setChallenge((prev) =>
              prev
                ? {
                    ...prev,
                    opponent_id: userId,
                    opponent_score: finalScore,
                    opponent_correct: correctCount,
                  }
                : prev
            );
          }
        }

        setScore(finalScore);
        setPageState("results");
      } else {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setRevealed(false);
        setLastPoints(null);
      }
      setAdvancing(false);
    }, 1800);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Renders
  // ──────────────────────────────────────────────────────────────────────

  const gridBg = {
    background: `
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px),
      #0a0a0f
    `,
    backgroundSize: "40px 40px",
    minHeight: "100vh",
  };

  // ── Loading ────────────────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a0f" }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#ffb800", borderTopColor: "transparent" }}
          />
          <p className="font-display text-xs tracking-widest" style={{ color: "#8888aa" }}>
            LOADING…
          </p>
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────
  if (pageState === "not_found") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4" style={gridBg}>
        <p className="font-display text-2xl text-white text-center">Challenge expired or not found</p>
        <p className="font-body text-sm text-center" style={{ color: "#8888aa" }}>
          This challenge link is no longer valid.
        </p>
        <Link
          href="/challenges"
          className="rounded-2xl px-6 py-3 font-display text-sm tracking-widest"
          style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.1)", color: "#aaaacc" }}
        >
          ← Browse Challenges
        </Link>
      </div>
    );
  }

  // ── Own challenge (no opponent yet) ───────────────────────────────────
  if (pageState === "own_challenge" && challenge) {
    return (
      <div className="min-h-screen flex flex-col px-5 py-12 gap-6" style={gridBg}>
        <div>
          <p className="font-display text-xs tracking-widest mb-1" style={{ color: "#00ff87" }}>
            YOUR CHALLENGE IS LIVE
          </p>
          <h1 className="font-display text-3xl text-white leading-tight">
            {challenge.quiz_pack_name}
          </h1>
        </div>

        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <Avatar name={challenge.challenger_name} color="#00ff87" size={52} />
          <div>
            <p className="font-display text-3xl text-white">
              {challenge.challenger_score.toLocaleString()}
            </p>
            <p className="font-body text-xs mt-0.5" style={{ color: "#8888aa" }}>
              {challenge.challenger_correct}/{challenge.total_questions} correct
            </p>
          </div>
        </div>

        <div>
          <p className="font-body text-xs mb-3" style={{ color: "#555577" }}>
            Share this link so someone can try to beat your score:
          </p>
          <ShareCard challenge={challenge} />
        </div>

        <Link
          href="/challenges"
          className="w-full rounded-2xl py-4 font-display text-sm tracking-widest text-center active:scale-[0.97] transition-transform"
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#aaaacc",
          }}
        >
          Play on Challenges →
        </Link>
      </div>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────
  if (pageState === "results" && challenge) {
    const opponentScore = challenge.opponent_score ?? score;
    const opponentCorrect =
      challenge.opponent_correct ?? answerLog.filter((r) => r.correct).length;
    const challengerScore = challenge.challenger_score;

    const diff = Math.abs(opponentScore - challengerScore);

    // Determine result from current user's perspective
    let resultLabel = "";
    let resultColor = "";
    let resultGlow = "";
    let resultSub = "";

    if (userId && userId !== challenge.challenger_id) {
      // user is the opponent
      if (opponentScore > challengerScore) {
        resultLabel = "YOU WIN";
        resultColor = "#00ff87";
        resultGlow = "0 0 60px rgba(0,255,135,0.25)";
        resultSub = `You won by ${diff.toLocaleString()} points`;
      } else if (opponentScore < challengerScore) {
        resultLabel = "SO CLOSE";
        resultColor = "#8888aa";
        resultGlow = "none";
        resultSub = `Beaten by ${diff.toLocaleString()} points`;
      } else {
        resultLabel = "IT'S A TIE";
        resultColor = "#a78bfa";
        resultGlow = "0 0 60px rgba(167,139,250,0.2)";
        resultSub = "Exact same score!";
      }
    } else if (userId && userId === challenge.challenger_id) {
      // user is the challenger looking at results
      if (challengerScore > opponentScore) {
        resultLabel = "YOU WIN";
        resultColor = "#00ff87";
        resultGlow = "0 0 60px rgba(0,255,135,0.25)";
        resultSub = `You won by ${diff.toLocaleString()} points`;
      } else if (challengerScore < opponentScore) {
        resultLabel = "NICE TRY";
        resultColor = "#8888aa";
        resultGlow = "none";
        resultSub = `Beaten by ${diff.toLocaleString()} points`;
      } else {
        resultLabel = "IT'S A TIE";
        resultColor = "#a78bfa";
        resultGlow = "0 0 60px rgba(167,139,250,0.2)";
        resultSub = "Exact same score!";
      }
    } else {
      // viewer not involved
      if (challengerScore > opponentScore) {
        resultLabel = `${challenge.challenger_name} WINS`;
        resultColor = "#00ff87";
        resultGlow = "0 0 60px rgba(0,255,135,0.2)";
        resultSub = `Won by ${diff.toLocaleString()} points`;
      } else if (challengerScore < opponentScore) {
        resultLabel = "CHALLENGER BEATEN";
        resultColor = "#a78bfa";
        resultGlow = "0 0 60px rgba(167,139,250,0.2)";
        resultSub = `Lost by ${diff.toLocaleString()} points`;
      } else {
        resultLabel = "IT'S A TIE";
        resultColor = "#a78bfa";
        resultGlow = "0 0 60px rgba(167,139,250,0.2)";
        resultSub = "Exact same score!";
      }
    }

    const opponentDisplayName =
      userId && userId !== challenge.challenger_id ? opponentName : "Opponent";

    return (
      <div className="min-h-screen flex flex-col pb-12" style={gridBg}>
        {/* Result banner */}
        <div
          className="flex flex-col items-center pt-16 pb-10 px-6"
          style={{
            background: "linear-gradient(175deg, #12121e 0%, #0a0a0f 100%)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            boxShadow: resultGlow,
          }}
        >
          <p
            className="font-display text-xs tracking-widest mb-3"
            style={{ color: "#555577" }}
          >
            {challenge.quiz_pack_name}
          </p>
          <div
            className="font-display text-5xl mb-2"
            style={{ color: resultColor }}
          >
            {resultLabel}
          </div>
          <p className="font-body text-sm" style={{ color: "#8888aa" }}>
            {resultSub}
          </p>
        </div>

        <div className="px-5 mt-6 flex flex-col gap-4">
          {/* Score comparison */}
          <div
            className="rounded-2xl p-5"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p
              className="font-display text-xs tracking-widest mb-5"
              style={{ color: "#555577" }}
            >
              HEAD-TO-HEAD
            </p>
            <div className="flex items-start gap-4">
              {/* Challenger */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <Avatar name={challenge.challenger_name} color="#ffb800" size={44} />
                <p
                  className="font-body text-xs text-center"
                  style={{ color: "#8888aa" }}
                >
                  {challenge.challenger_name}
                </p>
                <p
                  className="font-display text-3xl"
                  style={{ color: "#ffb800" }}
                >
                  {challengerScore.toLocaleString()}
                </p>
                <p className="font-body text-xs" style={{ color: "#666688" }}>
                  {challenge.challenger_correct}/{challenge.total_questions} correct
                </p>
              </div>

              {/* VS divider */}
              <div className="flex flex-col items-center justify-center pt-8 gap-1">
                <div
                  style={{
                    width: 1,
                    height: 20,
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
                <span
                  className="font-display text-xs"
                  style={{ color: "#444466" }}
                >
                  VS
                </span>
                <div
                  style={{
                    width: 1,
                    height: 20,
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
              </div>

              {/* Opponent */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <Avatar name={opponentDisplayName} color="#a78bfa" size={44} />
                <p
                  className="font-body text-xs text-center"
                  style={{ color: "#8888aa" }}
                >
                  {opponentDisplayName}
                </p>
                <p
                  className="font-display text-3xl"
                  style={{ color: "#a78bfa" }}
                >
                  {opponentScore.toLocaleString()}
                </p>
                <p className="font-body text-xs" style={{ color: "#666688" }}>
                  {opponentCorrect}/{challenge.total_questions} correct
                </p>
              </div>
            </div>
          </div>

          <Link
            href="/challenges"
            className="w-full rounded-2xl py-4 font-display text-sm tracking-widest text-center active:scale-[0.97] transition-transform"
            style={{
              background: "linear-gradient(135deg, #e65c00 0%, #ffb800 100%)",
              color: "#ffffff",
              boxShadow: "0 4px 24px rgba(255,140,0,0.25)",
            }}
          >
            Play another challenge →
          </Link>
        </div>
      </div>
    );
  }

  // ── Sign in needed ─────────────────────────────────────────────────────
  if (pageState === "sign_in_needed" && challenge) {
    const scoreBarPct = Math.round((challenge.challenger_score / (challenge.total_questions * 1000)) * 100);

    return (
      <div className="min-h-screen flex flex-col" style={gridBg}>
        {/* Top bar — brand */}
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="font-display text-lg tracking-wider text-white">
            YOUR<span style={{ color: "#ffb800" }}>SCORE</span>
          </span>
          <span className="font-body text-xs px-3 py-1 rounded-full"
            style={{ background: "rgba(255,184,0,0.1)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.2)" }}>
            ⚡ Football Knowledge
          </span>
        </div>

        {/* Challenge hero */}
        <div className="px-5 pt-6 pb-8"
          style={{ background: "linear-gradient(175deg, #1a0e00 0%, #0d0b00 60%, transparent 100%)" }}>
          <p className="font-display text-xs tracking-widest mb-3" style={{ color: "#a78bfa" }}>
            YOU&apos;VE BEEN CHALLENGED
          </p>
          <h1 className="font-display text-4xl text-white leading-tight mb-5">
            {challenge.quiz_pack_name}
          </h1>

          {/* Challenger card */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.18)" }}>
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={challenge.challenger_name} color="#ffb800" size={52} />
              <div>
                <p className="font-body text-xs mb-0.5" style={{ color: "#8888aa" }}>
                  {challenge.challenger_name} played this quiz and scored
                </p>
                <p className="font-display text-4xl text-white leading-none">
                  {challenge.challenger_score.toLocaleString()}
                </p>
                <p className="font-body text-xs mt-1.5" style={{ color: "#8888aa" }}>
                  {challenge.challenger_correct} / {challenge.total_questions} correct
                </p>
              </div>
            </div>

            {/* Score bar */}
            <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                width: `${scoreBarPct}%`, height: "100%", borderRadius: 99,
                background: "linear-gradient(90deg, #e65c00, #ffb800)",
                transition: "width 0.8s ease",
              }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="font-body text-xs" style={{ color: "#555577" }}>0</span>
              <span className="font-body text-xs" style={{ color: "#ffb800" }}>
                {scoreBarPct}% of max score
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 flex flex-col gap-4 pb-10">
          {/* What you're getting into */}
          <div className="rounded-2xl p-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#555577" }}>HOW IT WORKS</p>
            <div className="flex flex-col gap-3">
              {[
                { icon: "❓", title: `${challenge.total_questions} questions`, sub: `All about ${challenge.quiz_pack_name}` },
                { icon: "⚡", title: "Speed scoring", sub: "Answer fast — points decay the longer you wait" },
                { icon: "🏆", title: "One attempt", sub: "Your score is final. Can you beat theirs?" },
              ].map(({ icon, title, sub }) => (
                <div key={title} className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
                  <div>
                    <p className="font-display text-sm text-white tracking-wide">{title}</p>
                    <p className="font-body text-xs mt-0.5" style={{ color: "#8888aa" }}>{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sign-in CTA */}
          <div className="rounded-2xl p-5"
            style={{ background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.22)" }}>
            <p className="font-display text-base text-white tracking-wide mb-1">
              Sign in to accept
            </p>
            <p className="font-body text-xs mb-4" style={{ color: "#8888aa" }}>
              Free forever — takes 10 seconds
            </p>
            <SignInWithGoogle redirectTo={`/h2h/${id}`} />
          </div>

          {/* Social proof nudge */}
          <p className="font-body text-xs text-center" style={{ color: "#444466" }}>
            Join thousands of fans testing their football knowledge
          </p>
        </div>
      </div>
    );
  }

  // ── Ready to play ──────────────────────────────────────────────────────
  if (pageState === "ready_to_play" && challenge) {
    const scoreBarPct = Math.round((challenge.challenger_score / (challenge.total_questions * 1000)) * 100);

    return (
      <div className="min-h-screen flex flex-col" style={gridBg}>
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="font-display text-lg tracking-wider text-white">
            YOUR<span style={{ color: "#ffb800" }}>SCORE</span>
          </span>
          <span className="font-body text-xs px-3 py-1 rounded-full"
            style={{ background: "rgba(255,184,0,0.1)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.2)" }}>
            ⚡ Football Knowledge
          </span>
        </div>

        {/* Challenge hero */}
        <div className="px-5 pt-6 pb-8"
          style={{ background: "linear-gradient(175deg, #1a0e00 0%, #0d0b00 60%, transparent 100%)" }}>
          <p className="font-display text-xs tracking-widest mb-3" style={{ color: "#ffb800" }}>
            YOU&apos;VE BEEN CHALLENGED
          </p>
          <h1 className="font-display text-4xl text-white leading-tight mb-5">
            {challenge.quiz_pack_name}
          </h1>

          {/* Challenger card */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.18)" }}>
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={challenge.challenger_name} color="#ffb800" size={52} />
              <div>
                <p className="font-body text-xs mb-0.5" style={{ color: "#8888aa" }}>
                  {challenge.challenger_name} scored
                </p>
                <p className="font-display text-4xl text-white leading-none">
                  {challenge.challenger_score.toLocaleString()}
                </p>
                <p className="font-body text-xs mt-1.5" style={{ color: "#8888aa" }}>
                  {challenge.challenger_correct} / {challenge.total_questions} correct · {challenge.total_questions}Q
                </p>
              </div>
            </div>

            {/* Score bar */}
            <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                width: `${scoreBarPct}%`, height: "100%", borderRadius: 99,
                background: "linear-gradient(90deg, #e65c00, #ffb800)",
              }} />
            </div>
            <p className="font-body text-xs mt-1.5 text-right" style={{ color: "#ffb800" }}>
              {scoreBarPct}% of max — can you beat it?
            </p>
          </div>
        </div>

        <div className="px-5 flex flex-col gap-4 pb-10">
          {/* Quick rules */}
          <div className="rounded-2xl px-5 py-4 flex items-center justify-around"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            {[
              { val: `${challenge.total_questions}`, label: "Questions" },
              { val: "⚡", label: "Speed pts" },
              { val: "1×", label: "One attempt" },
            ].map(({ val, label }) => (
              <div key={label} className="text-center">
                <div className="font-display text-xl text-white">{val}</div>
                <div className="font-body text-xs mt-0.5" style={{ color: "#7777aa" }}>{label}</div>
              </div>
            ))}
          </div>

          <button
            onClick={startPlaying}
            className="w-full rounded-2xl py-5 font-display text-lg tracking-widest active:scale-[0.97] transition-transform"
            style={{
              background: "linear-gradient(135deg, #e65c00 0%, #ffb800 100%)",
              color: "#ffffff",
              boxShadow: "0 4px 24px rgba(255,140,0,0.35)",
            }}
          >
            ACCEPT CHALLENGE →
          </button>

          <p className="font-body text-xs text-center" style={{ color: "#444466" }}>
            Answer fast — points decay with every second
          </p>
        </div>
      </div>
    );
  }

  // ── Playing ────────────────────────────────────────────────────────────
  if (pageState === "playing" && questions.length > 0) {
    const currentQ = questions[currentIdx];
    if (!currentQ) return null;

    const progressFilled = ((currentIdx + (revealed ? 1 : 0)) / questions.length) * 100;
    const diff = currentQ.difficulty?.toLowerCase() ?? "medium";
    const diffColor = DIFF_COLOR[diff] ?? "#ffb800";
    const diffBg = DIFF_BG[diff] ?? "rgba(255,184,0,0.12)";
    const tColor = timerColor(timerMs);
    const accent = "#ffb800";

    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0f" }}>
        {/* Sticky header */}
        <div
          className="sticky top-0 z-10"
          style={{
            background: "rgba(10,10,15,0.98)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {/* Progress bar */}
          <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${progressFilled}%`,
                background: "linear-gradient(90deg, #e65c00, #ffb800)",
              }}
            />
          </div>

          <div className="px-5 py-3 flex items-center justify-between gap-3">
            {/* Quit */}
            <button
              onClick={() => {
                if (window.confirm("Quit? Your progress won't be saved.")) {
                  stopTimer();
                  setPageState("ready_to_play");
                  setCurrentIdx(0);
                  setSelected(null);
                  setRevealed(false);
                  setScore(0);
                  setAnswerLog([]);
                  setLastPoints(null);
                  setTimerMs(0);
                }
              }}
              className="flex items-center gap-1.5 font-body text-xs flex-shrink-0"
              style={{ color: "#555577" }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 18 18"
                fill="none"
              >
                <path
                  d="M11 4L6 9l5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Quit
            </button>

            {/* Timer */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl flex-1 justify-center"
              style={{
                background: `${tColor}10`,
                border: `1px solid ${tColor}28`,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: tColor,
                  display: "inline-block",
                  boxShadow: revealed ? "none" : `0 0 6px ${tColor}`,
                  opacity: revealed ? 0.4 : 1,
                }}
              />
              <span
                className="font-display text-base tabular-nums"
                style={{ color: tColor, letterSpacing: "0.02em" }}
              >
                {timerDisplay(timerMs)}
              </span>
            </div>

            {/* Score */}
            <div
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl flex-shrink-0"
              style={{
                background: `${accent}12`,
                border: `1px solid ${accent}25`,
              }}
            >
              <span
                className="font-display text-sm"
                style={{ color: accent }}
              >
                {score.toLocaleString()}
              </span>
              <span className="font-body text-xs" style={{ color: "#666688" }}>
                pts
              </span>
            </div>
          </div>

          {/* Question counter */}
          <div className="px-5 pb-2.5 flex items-center gap-2">
            <span className="font-body text-xs" style={{ color: "#555577" }}>
              Question{" "}
              <span className="text-white">{currentIdx + 1}</span> of{" "}
              {questions.length}
            </span>
            <span
              className="ml-auto font-display text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider"
              style={{
                background: diffBg,
                color: diffColor,
                border: `1px solid ${diffColor}30`,
              }}
            >
              {diff}
            </span>
          </div>
        </div>

        {/* Question body */}
        <div className="flex-1 px-5 pb-10 pt-4 flex flex-col">
          {currentQ.category && (
            <span
              className="font-body text-xs px-2.5 py-1 rounded-full capitalize mb-4 self-start"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "#7777aa",
              }}
            >
              {currentQ.category.replace(/_/g, " ")}
            </span>
          )}

          {/* Question card */}
          <div
            className="rounded-2xl p-5 mb-5"
            style={{
              background:
                "linear-gradient(145deg, #14141f 0%, #1a1a2c 100%)",
              border: "1px solid rgba(255,255,255,0.08)",
              minHeight: 100,
            }}
          >
            <p className="font-body text-base font-semibold text-white leading-relaxed">
              {currentQ.question}
            </p>
          </div>

          {/* Answer buttons */}
          <div className="space-y-3">
            {LETTERS.map((letter) => {
              const optionText = currentQ.options[letter];
              const isSelected = selected === letter;
              const isCorrectAnswer =
                revealed && letter === (currentQ.answer as Letter);
              const isWrong =
                revealed && isSelected && !isCorrectAnswer;
              const isDimmed =
                revealed && !isCorrectAnswer && letter !== selected;
              const lColor = LETTER_COLORS[letter];

              let cardBg = "rgba(255,255,255,0.03)";
              let cardBorder = "rgba(255,255,255,0.09)";
              let textColor = "#e0e0f0";
              let chipBg = `${lColor}18`;
              let chipColor = lColor;

              if (isCorrectAnswer) {
                cardBg = "rgba(0,255,135,0.1)";
                cardBorder = "#00ff87";
                textColor = "#00ff87";
                chipBg = "#00ff87";
                chipColor = "#0a0a0f";
              } else if (isWrong) {
                cardBg = "rgba(255,71,87,0.08)";
                cardBorder = "rgba(255,71,87,0.5)";
                textColor = "#ff4757";
                chipBg = "rgba(255,71,87,0.2)";
                chipColor = "#ff4757";
              } else if (isDimmed) {
                cardBg = "transparent";
                cardBorder = "rgba(255,255,255,0.04)";
                textColor = "#444466";
                chipBg = "rgba(255,255,255,0.03)";
                chipColor = "#444466";
              } else if (isSelected && !revealed) {
                cardBg = `${accent}10`;
                cardBorder = `${accent}50`;
                textColor = accent;
                chipBg = `${accent}25`;
                chipColor = accent;
              }

              return (
                <button
                  key={letter}
                  onClick={() => handleAnswer(letter)}
                  disabled={!!selected}
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.98]"
                  style={{
                    background: cardBg,
                    border: `1.5px solid ${cardBorder}`,
                    color: textColor,
                    minHeight: 58,
                  }}
                >
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center font-display text-sm flex-shrink-0 transition-all"
                    style={{ background: chipBg, color: chipColor }}
                  >
                    {isCorrectAnswer ? "✓" : isWrong ? "✗" : letter}
                  </span>
                  <span className="font-body text-sm font-medium leading-snug">
                    {optionText}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Reveal banner */}
          {revealed && (
            <div
              className="mt-4 rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{
                background:
                  selected === (currentQ.answer as Letter)
                    ? "rgba(0,255,135,0.08)"
                    : "rgba(255,71,87,0.08)",
                border: `1px solid ${
                  selected === (currentQ.answer as Letter)
                    ? "rgba(0,255,135,0.22)"
                    : "rgba(255,71,87,0.22)"
                }`,
              }}
            >
              <div>
                <span
                  className="font-display text-lg tracking-wider"
                  style={{
                    color:
                      selected === (currentQ.answer as Letter)
                        ? "#00ff87"
                        : "#ff4757",
                  }}
                >
                  {selected === (currentQ.answer as Letter)
                    ? "✓ CORRECT"
                    : "✗ WRONG"}
                </span>
                {selected !== (currentQ.answer as Letter) && (
                  <p
                    className="font-body text-xs mt-0.5"
                    style={{ color: "#8888aa" }}
                  >
                    Answer:{" "}
                    <span style={{ color: "#ffffff" }}>
                      {currentQ.options[currentQ.answer as Letter]}
                    </span>
                  </p>
                )}
              </div>
              {lastPoints !== null && (
                <div className="text-right">
                  <div
                    className="font-display text-2xl"
                    style={{ color: "#ffb800" }}
                  >
                    +{lastPoints.toLocaleString()}
                  </div>
                  <div
                    className="font-body text-xs"
                    style={{ color: "#8888aa" }}
                  >
                    {timerDisplay(timerMs)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
