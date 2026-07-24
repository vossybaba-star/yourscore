"use client";

/**
 * The quiz gate — the question a player answers to unlock a pick in a gated draft.
 *
 * Lifted from the World Cup Mastermind draft (/38-0/wc) so 38-0's PL Pro mode shows the
 * identical thing: same clock, same reveal, same streak language. Parametrised only by
 * accent colour and the verb on the header ("SCOUT" for the WC's nation slates, "SPIN" for
 * the league draft's club-season reel).
 *
 * Presentational only — the parent owns the question, the clock and the grading, because
 * grading is a server round-trip (the answers are server-only; see lib/draft/pl-quiz.ts).
 *
 * NOTE: the WC page still renders its own copy inline. Migrating it onto this component is
 * a deliberate follow-up — it's a live ranked competition and not worth the risk in the
 * same change that introduces the PL gate.
 */

import type { ServedQuestion } from "@/lib/draft/wc-quiz-public";

export type QuizGateProps = {
  question: ServedQuestion;
  /** The option index the player locked in, or null before they've answered. -1 = timeout. */
  answered: number | null;
  /** Seconds left on this question's clock. */
  timeLeft: number;
  /** The clock's full duration, for the draining bar. */
  totalSeconds: number;
  /** Correct-answer streak BEFORE this question — drives the header nudge. */
  streak: number;
  /** Post-grade result, shown under the options for the beat before the spin. */
  feedback: { correct: boolean; streak: number } | null;
  onAnswer: (index: number) => void;
  /** Accent for the panel: the competition's colour. */
  accent?: string;
  /** The verb this gate unlocks — "SCOUT" (WC) or "SPIN" (league). */
  verb?: string;
};

export function QuizGate({
  question, answered, timeLeft, totalSeconds, streak, feedback, onAnswer,
  accent = "#ffb800", verb = "SPIN",
}: QuizGateProps) {
  const locked = answered !== null;
  // Answers grade on the SERVER: correctIndex stays -1 until the result arrives. Until then
  // the pick is just "selected" (accent) — never red — so a correct answer can't flash wrong
  // first.
  const graded = question.correctIndex >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.72)" }}>
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 pb-8" style={{ background: "#13131c", border: `1px solid ${accent}4d` }}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-display tracking-wide" style={{ fontSize: 13, color: accent }}>⚽ ANSWER TO {verb}</span>
          <span className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>
            {streak >= 1 ? `🔥 Streak ×${streak}, keep it going` : "Get it right for better players"}
          </span>
        </div>

        {!locked && (
          <div className="mb-3">
            <div className="flex items-center justify-end mb-1">
              <span className="font-display tabular-nums" style={{ fontSize: 12, color: timeLeft <= 5 ? "#ff4757" : accent }}>⏱ {timeLeft}s</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="h-full rounded-full"
                style={{ width: `${(timeLeft / totalSeconds) * 100}%`, background: timeLeft <= 5 ? "#ff4757" : accent, transition: "width 1s linear" }} />
            </div>
          </div>
        )}

        <p className="font-body mb-4" style={{ fontSize: 16, color: "#fff", lineHeight: 1.35 }}>{question.prompt}</p>

        <div className="flex flex-col gap-2">
          {question.options.map((opt, i) => {
            const isCorrect = graded && i === question.correctIndex;
            const isPicked = i === answered;
            const pickedPending = isPicked && locked && !graded;
            const bg = !locked
              ? "rgba(255,255,255,0.05)"
              : isCorrect ? "rgba(0,255,135,0.16)"
              : pickedPending ? `${accent}2e`
              : isPicked ? "rgba(255,71,87,0.16)"
              : "rgba(255,255,255,0.04)";
            const border = !locked
              ? "rgba(255,255,255,0.12)"
              : isCorrect ? "rgba(0,255,135,0.6)"
              : pickedPending ? `${accent}99`
              : isPicked ? "rgba(255,71,87,0.6)"
              : "rgba(255,255,255,0.08)";
            return (
              <button key={i} onClick={() => onAnswer(i)} disabled={locked}
                className="w-full text-left rounded-xl px-4 py-3 font-body active:scale-[0.99] transition-transform"
                style={{ background: bg, border: `1px solid ${border}`, color: "#fff", fontSize: 15 }}>
                {opt}
                {graded && isCorrect && <span style={{ color: "#00ff87" }}> ✓</span>}
                {graded && isPicked && !isCorrect && <span style={{ color: "#ff7a88" }}> ✗</span>}
              </button>
            );
          })}
        </div>

        {/* A way out. The gate had none: once it opened, the only exits were answering or
            letting the 25s clock run down, which grades as a miss anyway. Under the halftime
            condition (pub, one hand, someone talking at you) that's a trap with a penalty
            attached. This costs exactly what the timeout already cost, just without the wait,
            and says so — so skipping is a choice rather than something you discover. */}
        {!locked && (
          <button
            onClick={() => onAnswer(-1)}
            className="w-full mt-3 py-2 text-center transition-opacity hover:opacity-80"
          >
            <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>
              Skip this one (counts as a miss)
            </span>
          </button>
        )}

        {feedback && (
          <p className="mt-3 text-center font-body" style={{ fontSize: 13, color: feedback.correct ? "#00ff87" : "#ff8a3d" }}>
            {feedback.correct
              ? feedback.streak >= 2 ? `🔥 Correct. Streak ×${feedback.streak}, elite players unlocked.` : "✅ Correct. Strong players unlocked."
              : "❌ Not quite. A thinner pool this pick, streak reset."}
          </p>
        )}
      </div>
    </div>
  );
}
