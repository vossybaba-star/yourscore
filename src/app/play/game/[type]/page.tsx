"use client";

import { useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { haptic } from "@/lib/haptics";
import { BottomNav } from "@/components/ui/BottomNav";
import { Button } from "@/components/ui/Button";
import { useHideGamesNav } from "@/lib/gamesNav";
import { useGameLoop } from "@/lib/useGameLoop";
import {
  scoreAnswer,
  calculatePerfectRoundBonus,
  getSpeedLabel,
  maxPointsForDifficulty,
} from "@/lib/scoring";
import { DIFFICULTY_COLOR as DIFF_COLOR, DIFFICULTY_BG as DIFF_BG } from "@/lib/theme";

// ── Game type config ────────────────────────────────────────────────────────

type GameType = "higher-lower" | "guess-the-player";

const GAME_CONFIG: Record<GameType, {
  title: string;
  tagline: string;
  accent: string;
  how: string;
}> = {
  // Accents are each game's OWN section colour (founder ruling 2026-07-18:
  // separate games next to Quiz and 38-0) — they match the GameSwitcher tabs,
  // not Quiz teal / 38-0 lime as before.
  "higher-lower": {
    title: "Higher or Lower",
    tagline: "Two same-position players, one stat — pick the bigger number.",
    accent: "#ff7800",
    how: "Each question shows two Premier League players in the same position. Tap the one with more — faster answers score more.",
  },
  "guess-the-player": {
    title: "Guess the Player",
    tagline: "Clues drip in — name the mystery footballer.",
    accent: "#4fc3f7",
    how: "Each question gives you clues (or a career path) and four players. Pick who it is — the quicker, the better.",
  },
};

// ── Types ─────────────────────────────────────────────────────────────────

interface ServedQuestion {
  idx: number;
  format: string;
  prompt: string;
  difficulty: string;
  options: { id: number; label: string }[];
  clue?: { nationality?: string; flagUrl?: string; jersey?: number };
  topic?: string;
  position?: string;
}

// Higher-or-Lower topics (mirrors HL_TOPICS in serve.ts) + the Mixed default.
const HL_TOPICS = [
  { key: "mixed", label: "Mixed" },
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "appearances", label: "Appearances" },
  { key: "age", label: "Age" },
] as const;

/** Small SVG glyph per topic — no emojis (founder Jul 11). */
function TopicGlyph({ topic, size = 15 }: { topic?: string; size?: number }) {
  const c = { width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor" as const, strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (topic) {
    case "goals":
      return (
        <svg {...c} strokeWidth={1.3}><circle cx="8" cy="8" r="6" /><path d="M8 4.4 l2.7 2 -1 3.2 -3.4 0 -1 -3.2 z" fill="currentColor" stroke="none" /></svg>
      );
    case "assists":
      return (
        <svg {...c}><path d="M2 11 C 5 5.5, 9 4.5, 13.2 5.4" /><path d="M10.2 3.6 L13.4 5.4 L11.9 8.4" /></svg>
      );
    case "appearances":
      return (
        <svg {...c} strokeWidth={1.2}><path d="M6 2.6 L3 4 L2 7 L4 7.6 L4 13.4 L12 13.4 L12 7.6 L14 7 L13 4 L10 2.6 L9 3.6 Q8 4.7 7 3.6 Z" /></svg>
      );
    case "age":
      return (
        <svg {...c} strokeWidth={1.35}><circle cx="8" cy="9.2" r="4.8" /><path d="M8 9.2 V6.3" /><path d="M6.4 2.6 h3.2" /><path d="M8 2.6 V4.4" /></svg>
      );
    default: // mixed / shuffle
      return (
        <svg {...c} strokeWidth={1.4}><path d="M2 5 h7 l-2 -2 M9 5 l-2 2" /><path d="M14 11 h-7 l2 -2 M7 11 l2 2" /></svg>
      );
  }
}

interface AnswerRecord {
  idx: number;
  correct: boolean;
  points: number;
  elapsedMs: number;
}

type Phase = "intro" | "loading" | "playing" | "results";

// ── Timer helpers (shared look with the solo challenge screen) ──────────────

function timerColor(ms: number): string {
  if (ms < 5_000) return "#aeea00";
  if (ms < 10_000) return "#00d8c0";
  return "#ff4757";
}
function timerDisplay(ms: number): string {
  return (ms / 1000).toFixed(2) + "s";
}

function scoreData(pct: number) {
  if (pct >= 0.9) return { emoji: "🏆", label: "Elite Knowledge", color: "#00d8c0" };
  if (pct >= 0.75) return { emoji: "⚡", label: "Sharp.", color: "#aeea00" };
  if (pct >= 0.55) return { emoji: "⚽", label: "Decent.", color: "#4fc3f7" };
  if (pct >= 0.35) return { emoji: "📚", label: "Keep watching.", color: "#aeea00" };
  return { emoji: "😬", label: "Back to basics.", color: "#ff4757" };
}

// ── Option button (generic — 2 for Higher/Lower, 4 for Guess the Player) ─────

function OptionButton({
  label,
  optionId,
  selectedId,
  revealed,
  answerId,
  accent,
  onPick,
}: {
  label: string;
  optionId: number;
  selectedId: number | null;
  revealed: boolean;
  answerId: number | null;
  accent: string;
  onPick: (id: number) => void;
}) {
  const isSelected = selectedId === optionId;
  const isCorrect = revealed && answerId === optionId;
  const isWrong = revealed && isSelected && !isCorrect;
  const isDimmed = revealed && !isCorrect && !isSelected;

  let bg = "rgba(255,255,255,0.03)";
  let border = "rgba(255,255,255,0.09)";
  let color = "#eef2f0";
  let chip = "";

  if (isCorrect) {
    bg = "rgba(174,234,0,0.1)"; border = "#aeea00"; color = "#aeea00"; chip = "✓";
  } else if (isWrong) {
    bg = "rgba(255,71,87,0.08)"; border = "rgba(255,71,87,0.5)"; color = "#ff4757"; chip = "✗";
  } else if (isDimmed) {
    bg = "transparent"; border = "rgba(255,255,255,0.04)"; color = "#3a423d";
  } else if (isSelected && !revealed) {
    bg = `${accent}10`; border = `${accent}50`; color = accent;
  }

  return (
    <button
      onClick={() => onPick(optionId)}
      disabled={selectedId !== null}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.98]"
      style={{ background: bg, border: `1.5px solid ${border}`, color, minHeight: 60 }}
    >
      {chip && (
        <span className="w-8 h-8 rounded-xl flex items-center justify-center font-display text-sm flex-shrink-0"
          style={{ background: isCorrect ? "#aeea00" : "rgba(255,71,87,0.2)", color: isCorrect ? "#0a0a0f" : "#ff4757" }}>
          {chip}
        </span>
      )}
      <span className="font-body text-base font-semibold leading-snug">{label}</span>
    </button>
  );
}

// ── Who-am-I visual clues ────────────────────────────────────────────────

/** Nationality flag + country name. */
function FlagClue({ nationality, flagUrl }: { nationality?: string; flagUrl?: string }) {
  if (!nationality && !flagUrl) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
      {flagUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={flagUrl} alt={nationality ?? "flag"} width={30} height={20}
          style={{ width: 30, height: 20, objectFit: "cover", borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.5)" }} />
      ) : null}
      <div className="leading-tight">
        <div className="font-body text-xs" style={{ color: "#586058" }}>Nationality</div>
        <div className="font-body text-sm font-semibold text-white">{nationality ?? "—"}</div>
      </div>
    </div>
  );
}

/** Shirt-back graphic with the squad number. */
function ShirtNumber({ n, accent }: { n: number; accent: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
      <svg width="34" height="34" viewBox="0 0 64 64" fill="none" style={{ flexShrink: 0 }}>
        <path d="M23 6 L10 13 L5 27 L15 31 L15 59 L49 59 L49 31 L59 27 L54 13 L41 6 L38 9 Q32 14 26 9 Z"
          fill={`${accent}1f`} stroke={accent} strokeWidth="2.5" strokeLinejoin="round" />
        <text x="32" y="44" textAnchor="middle" fontSize="26" fontWeight="800" fill="#ffffff"
          fontFamily="ui-sans-serif, system-ui, sans-serif">{n}</text>
      </svg>
      <div className="leading-tight">
        <div className="font-body text-xs" style={{ color: "#586058" }}>Shirt number</div>
        <div className="font-body text-sm font-semibold text-white">No. {n}</div>
      </div>
    </div>
  );
}

/** The revealed player headshot (post-answer). */
function RevealPhoto({ url, name }: { url: string; name?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name ?? "player"} width={52} height={52}
      style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover",
        border: "2px solid rgba(255,255,255,0.15)", background: "#0b1310", flexShrink: 0 }} />
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function GameTypePage() {
  const params = useParams<{ type: string }>();
  const router = useRouter();
  const type = params.type as GameType;
  const config = GAME_CONFIG[type];

  const [phase, setPhase] = useState<Phase>("intro");
  // "loading" here is the post-START deal — already part of the run, so the
  // persistent GamesNav steps away for it too, not just for "playing".
  useHideGamesNav(phase === "playing" || phase === "loading");
  const [topic, setTopic] = useState<string>("mixed"); // Higher-or-Lower topic
  const [seed, setSeed] = useState<string>("");
  const [windowMs, setWindowMs] = useState(25_000);
  const [questions, setQuestions] = useState<ServedQuestion[]>([]);
  const [loadError, setLoadError] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revealAnswerId, setRevealAnswerId] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const [score, setScore] = useState(0);
  const [answerLog, setAnswerLog] = useState<AnswerRecord[]>([]);
  const [correctStreak, setCorrectStreak] = useState(0);
  const [wrongStreak, setWrongStreak] = useState(0);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [lastSpeedLabel, setLastSpeedLabel] = useState<string | null>(null);
  const [lastStreakBonus, setLastStreakBonus] = useState(0);
  const [revealPhoto, setRevealPhoto] = useState<string | null>(null);
  const [revealName, setRevealName] = useState<string | null>(null);

  const advanceRef = useRef(false);

  const { timerMs, setTimerMs, questionStartRef, stopTimer } = useGameLoop(
    phase === "playing",
    currentIdx,
  );

  // Unknown type → bounce back to the picker.
  if (!config) {
    if (typeof window !== "undefined") router.replace("/play");
    return null;
  }

  const currentQ = questions[currentIdx];
  // Max = every question at Lightning speed for its difficulty band.
  const maxScore = questions.reduce((s, q) => s + maxPointsForDifficulty(q.difficulty), 0);

  function resetRoundState() {
    setCurrentIdx(0);
    setSelectedId(null);
    setRevealed(false);
    setRevealAnswerId(null);
    setAdvancing(false);
    setScore(0);
    setAnswerLog([]);
    setCorrectStreak(0);
    setWrongStreak(0);
    setLastPoints(null);
    setLastSpeedLabel(null);
    setLastStreakBonus(0);
    setRevealPhoto(null);
    setRevealName(null);
    setTimerMs(0);
  }

  async function startRound() {
    setPhase("loading");
    setLoadError(false);
    try {
      const res = await fetch(`/api/games/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draw", topic }),
      });
      if (!res.ok) throw new Error("draw failed");
      const data = await res.json();
      if (!Array.isArray(data.questions) || data.questions.length === 0) throw new Error("empty round");
      setSeed(data.seed);
      setWindowMs(typeof data.window === "number" ? data.window : 25_000);
      setQuestions(data.questions as ServedQuestion[]);
      resetRoundState();
      setPhase("playing");
    } catch {
      setLoadError(true);
      setPhase("intro");
    }
  }

  async function handlePick(optionId: number) {
    if (selectedId !== null || revealed || advancing || !currentQ) return;
    stopTimer();
    const elapsed = Date.now() - questionStartRef.current;
    setSelectedId(optionId);

    let correct = false;
    let answerId: number | null = null;
    let basePoints = 0;
    let photoUrl: string | null = null;
    let name: string | null = null;
    try {
      const res = await fetch(`/api/games/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", seed, idx: currentIdx, optionId, elapsedMs: elapsed }),
      });
      if (res.ok) {
        const g = await res.json();
        correct = Boolean(g.correct);
        answerId = typeof g.answerId === "number" ? g.answerId : null;
        basePoints = typeof g.points === "number" ? g.points : 0;
        photoUrl = typeof g.photoUrl === "string" ? g.photoUrl : null;
        name = typeof g.name === "string" ? g.name : null;
      }
    } catch {
      /* network error — reveal without a highlight, treated as wrong */
    }

    // Streak/comeback bonuses computed client-side for display flair (v1 is
    // unranked; correctness + base points are server-authoritative).
    const { streakBonus, comebackBonus, nextCorrectStreak, nextWrongStreak } = scoreAnswer({
      isCorrect: correct,
      elapsedMs: elapsed,
      difficulty: currentQ.difficulty,
      correctStreak,
      wrongStreak,
      windowMs,
    });
    const pts = basePoints + streakBonus + comebackBonus;

    void haptic(correct ? "correct" : "wrong");
    setRevealAnswerId(answerId);
    setRevealPhoto(photoUrl);
    setRevealName(name);
    setRevealed(true);
    setCorrectStreak(nextCorrectStreak);
    setWrongStreak(nextWrongStreak);
    setLastPoints(correct ? pts : null);
    setLastSpeedLabel(correct ? getSpeedLabel(elapsed, windowMs) : null);
    setLastStreakBonus(streakBonus + comebackBonus);
    if (correct) setScore((s) => s + pts);

    const record: AnswerRecord = { idx: currentIdx, correct, points: correct ? pts : 0, elapsedMs: elapsed };
    const newLog = [...answerLog, record];
    setAnswerLog(newLog);

    setAdvancing(true);
    advanceRef.current = true;
    setTimeout(() => {
      if (currentIdx + 1 >= questions.length) {
        const correctCount = newLog.filter((r) => r.correct).length;
        if (correctCount === questions.length) void haptic("win");
        const perfectBonus = calculatePerfectRoundBonus(correctCount, questions.length);
        setScore((s) => s + perfectBonus);
        setPhase("results");
      } else {
        setCurrentIdx((i) => i + 1);
        setSelectedId(null);
        setRevealed(false);
        setRevealAnswerId(null);
        setRevealPhoto(null);
        setRevealName(null);
        setLastPoints(null);
        setLastSpeedLabel(null);
        setLastStreakBonus(0);
      }
      setAdvancing(false);
      advanceRef.current = false;
    }, 1600);
  }

  const accent = config.accent;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: accent, borderTopColor: "transparent" }} />
          <p className="font-display text-xs tracking-widest text-text-muted">DEALING QUESTIONS…</p>
        </div>
      </div>
    );
  }

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
        {/* The persistent GamesNav (root layout) is the section header. */}
        {/* No back button — the nav above IS the navigation (founder
            2026-07-18: own tab, no back buttons on game sections). */}
        <div className="relative flex flex-col items-center pt-8 pb-8 px-6"
          style={{ background: `linear-gradient(175deg, ${accent}14 0%, #0e1611 55%, #0a0a0f 100%)` }}>
          <div className="w-full mb-5"
            style={{ maxWidth: 340, borderRadius: 18, overflow: "hidden", border: `1.5px solid ${accent}40`, boxShadow: `0 12px 40px ${accent}22` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/game-covers/${type}.webp`} alt={config.title} className="block w-full h-auto" />
          </div>
          <h1 className="font-display text-3xl text-white text-center leading-tight mb-2">{config.title}</h1>
          <p className="font-body text-sm text-center px-2" style={{ color: "#9aa39d", lineHeight: 1.5 }}>{config.tagline}</p>
          <div className="flex items-center gap-2 mt-3">
            <span className="font-body text-xs px-3 py-1 rounded-full"
              style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}40` }}>
              Premier League
            </span>
            <span className="font-body text-xs px-3 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.06)", color: "#9aa39d" }}>
              10 questions
            </span>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-5 py-6 flex flex-col gap-4">
          <div className="rounded-2xl px-4 py-4 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-sm text-white tracking-wide mb-1.5">How it works</p>
            <p className="font-body text-sm" style={{ color: "#9aa39d", lineHeight: 1.6 }}>{config.how}</p>
          </div>

          {/* Topic picker (Higher or Lower). Mixed = a few topics across the round. */}
          {type === "higher-lower" && (
            <div>
              <p className="font-display text-xs tracking-widest mb-2.5" style={{ color: "#586058" }}>CHOOSE A TOPIC</p>
              <div className="flex flex-wrap gap-2">
                {HL_TOPICS.map((t) => {
                  const on = topic === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTopic(t.key)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full font-body text-sm transition-all active:scale-[0.97]"
                      style={{
                        background: on ? `${accent}1f` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${on ? accent : "rgba(255,255,255,0.1)"}`,
                        color: on ? accent : "#9aa39d",
                      }}
                    >
                      <TopicGlyph topic={t.key} /> {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {loadError && (
            <p className="font-body text-sm text-center" style={{ color: "#ff6b78" }}>
              Couldn&apos;t load questions — try again.
            </p>
          )}

          <Button variant="primary" tone="teal" size="lg" fullWidth onClick={startRound}>
            START · 10 Qs
          </Button>
        </div>

        <BottomNav />
      </div>
    );
  }

  // ── Playing ──────────────────────────────────────────────────────────────
  if (phase === "playing" && currentQ) {
    const progressFilled = ((currentIdx + (revealed ? 1 : 0)) / questions.length) * 100;
    const diff = currentQ.difficulty.toLowerCase();
    const diffColor = DIFF_COLOR[diff] ?? accent;
    const diffBg = DIFF_BG[diff] ?? `${accent}20`;
    const tColor = timerColor(timerMs);

    return (
      <div className="min-h-screen flex flex-col bg-bg">
        <div className="sticky top-0 z-10 pt-safe"
          style={{ background: "rgba(10,10,15,0.98)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full transition-all duration-700 ease-out"
              style={{ width: `${progressFilled}%`, background: `linear-gradient(90deg, ${accent}, ${accent})` }} />
          </div>

          <div className="px-5 py-3 flex items-center justify-between gap-3">
            <button
              onClick={() => { stopTimer(); setPhase("intro"); resetRoundState(); }}
              className="flex items-center gap-1.5 font-body text-xs flex-shrink-0"
              style={{ color: "#586058" }}
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Quit
            </button>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl flex-1 justify-center"
              style={{ background: `${tColor}10`, border: `1px solid ${tColor}28` }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: tColor, display: "inline-block",
                boxShadow: revealed ? "none" : `0 0 6px ${tColor}`, opacity: revealed ? 0.4 : 1 }} />
              <span className="font-display text-base tabular-nums" style={{ color: tColor }}>{timerDisplay(timerMs)}</span>
            </div>

            <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl flex-shrink-0"
              style={{ background: `${accent}12`, border: `1px solid ${accent}25` }}>
              <span className="font-display text-sm" style={{ color: accent }}>{score.toLocaleString()}</span>
              <span className="font-body text-xs" style={{ color: "#5b645e" }}>pts</span>
            </div>
          </div>

          <div className="px-5 pb-2.5 flex items-center gap-2">
            <span className="font-body text-xs" style={{ color: "#586058" }}>
              Question <span className="text-white">{currentIdx + 1}</span> of {questions.length}
            </span>
            <span className="ml-auto font-display text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider"
              style={{ background: diffBg, color: diffColor, border: `1px solid ${diffColor}30` }}>
              {diff}
            </span>
          </div>
        </div>

        <div className="flex-1 px-5 pb-10 pt-4 flex flex-col max-w-lg mx-auto w-full">
          {/* Who-am-I visual clues: nationality flag + shirt number */}
          {currentQ.clue && (currentQ.clue.flagUrl || currentQ.clue.nationality || typeof currentQ.clue.jersey === "number") && (
            <div className="flex gap-2.5 mb-3 flex-wrap">
              <FlagClue nationality={currentQ.clue.nationality} flagUrl={currentQ.clue.flagUrl} />
              {typeof currentQ.clue.jersey === "number" && <ShirtNumber n={currentQ.clue.jersey} accent={accent} />}
            </div>
          )}

          {/* Higher-or-Lower position chip — both players share this position */}
          {currentQ.position && (
            <div className="mb-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-xs font-semibold"
                style={{ background: `${accent}14`, border: `1px solid ${accent}30`, color: accent }}>
                <TopicGlyph topic={currentQ.topic} size={13} /> {currentQ.position}
              </span>
            </div>
          )}

          <div className="rounded-2xl p-5 mb-5"
            style={{ background: "linear-gradient(145deg, #0e1611 0%, #15211a 100%)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 96 }}>
            <p className="font-body text-lg font-semibold text-white leading-relaxed whitespace-pre-line">{currentQ.prompt}</p>
          </div>

          <div className="space-y-3">
            {currentQ.options.map((o) => (
              <OptionButton
                key={o.id}
                label={o.label}
                optionId={o.id}
                selectedId={selectedId}
                revealed={revealed}
                answerId={revealAnswerId}
                accent={accent}
                onPick={handlePick}
              />
            ))}
          </div>

          {revealed && (
            <div className="mt-4 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3"
              style={{
                background: lastPoints !== null ? "rgba(174,234,0,0.08)" : "rgba(255,71,87,0.08)",
                border: `1px solid ${lastPoints !== null ? "rgba(174,234,0,0.22)" : "rgba(255,71,87,0.22)"}`,
              }}>
              <div className="flex items-center gap-3 min-w-0">
                {revealPhoto && <RevealPhoto url={revealPhoto} name={revealName ?? undefined} />}
                <div className="min-w-0">
                  <span className="font-display text-lg tracking-wider"
                    style={{ color: lastPoints !== null ? "#aeea00" : "#ff4757" }}>
                    {lastPoints !== null ? "✓ CORRECT" : "✗ WRONG"}
                  </span>
                  {revealName && (
                    <div className="font-body text-sm font-semibold text-white truncate">{revealName}</div>
                  )}
                </div>
              </div>
              {lastPoints !== null && (
                <div className="text-right flex-shrink-0">
                  <div className="font-display text-2xl" style={{ color: accent }}>+{lastPoints.toLocaleString()}</div>
                  {lastSpeedLabel && <div className="font-body text-xs mt-0.5 text-text-muted">{lastSpeedLabel}</div>}
                  {lastStreakBonus > 0 && <div className="font-body text-xs" style={{ color: "#aeea00" }}>+{lastStreakBonus} bonus</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────
  if (phase === "results") {
    const correctCount = answerLog.filter((r) => r.correct).length;
    const total = questions.length;
    const pct = maxScore > 0 ? score / maxScore : 0;
    const accPct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const fastestMs = answerLog.length ? Math.min(...answerLog.map((r) => r.elapsedMs)) : 0;
    const { label, color } = scoreData(pct);

    return (
      <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
        <div className="relative flex flex-col items-center pt-16 pb-10 px-6"
          style={{ background: `linear-gradient(175deg, ${accent}14 0%, #0e1611 60%, #0a0a0f 100%)` }}>
          <div className="mb-4" style={{ width: 132, borderRadius: 12, overflow: "hidden", border: `1px solid ${accent}33` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/game-covers/${type}.webp`} alt={config.title} className="block w-full h-auto" />
          </div>
          <div className="font-display text-7xl mb-1" style={{ color: accent }}>{score.toLocaleString()}</div>
          <p className="font-body text-sm mb-3 text-text-muted">out of {maxScore.toLocaleString()} pts</p>
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full"
            style={{ background: `${color}15`, border: `1px solid ${color}35` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
            <span className="font-display text-base tracking-wide" style={{ color }}>{label}</span>
          </div>

          <div className="flex items-center gap-6 mt-6">
            <div className="text-center">
              <div className="font-display text-2xl text-white">{correctCount}/{total}</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>Correct</div>
            </div>
            <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-display text-2xl" style={{ color: accent }}>{accPct}%</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>Accuracy</div>
            </div>
            <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-display text-2xl text-green">{timerDisplay(fastestMs)}</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>Fastest</div>
            </div>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-5 flex flex-col gap-3 mt-5">
          <Button variant="primary" tone="teal" size="lg" fullWidth onClick={startRound}>
            PLAY AGAIN →
          </Button>
          <Button variant="ghost" tone="teal" size="lg" fullWidth onClick={() => router.push("/play")}>
            MORE GAMES
          </Button>
          <p className="font-body text-xs text-center mt-1" style={{ color: "#586058" }}>
            Practice mode — these don&apos;t count on the leaderboard yet.
          </p>
        </div>

        <BottomNav />
      </div>
    );
  }

  return null;
}
