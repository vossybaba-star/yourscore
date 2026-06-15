"use client";

import { useState, useCallback } from "react";
import { CountdownTimer } from "./CountdownTimer";

export interface ActiveQuestion {
  eventId: string;
  questionId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  difficulty: "easy" | "medium" | "hard";
  category: string | null;
  explanation: string | null;
  startTime: Date;
  totalSeconds: number;
}

interface QuestionCardProps {
  question: ActiveQuestion;
  onAnswer: (letter: "a" | "b" | "c" | "d") => Promise<{ isCorrect: boolean; points: number; correctAnswer: "a" | "b" | "c" | "d" }>;
  onExpire: () => void;
}

type RevealState = {
  selected: "a" | "b" | "c" | "d";
  isCorrect: boolean;
  points: number;
  correctAnswer: "a" | "b" | "c" | "d";
} | null;

const LABELS = ["A", "B", "C", "D"] as const;
const LETTERS = ["a", "b", "c", "d"] as const;

export function QuestionCard({ question, onAnswer, onExpire }: QuestionCardProps) {
  const [selected, setSelected] = useState<"a" | "b" | "c" | "d" | null>(null);
  const [reveal, setReveal] = useState<RevealState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expired, setExpired] = useState(false);

  const options = [question.optionA, question.optionB, question.optionC, question.optionD];

  async function handleSelect(letter: "a" | "b" | "c" | "d") {
    if (selected || submitting || expired) return;
    setSelected(letter);
    setSubmitting(true);

    try {
      const result = await onAnswer(letter);
      setReveal({ selected: letter, ...result });
    } catch {
      setReveal(null);
      setSelected(null);
    } finally {
      setSubmitting(false);
    }
  }

  const handleExpire = useCallback(() => {
    setExpired(true);
    onExpire();
  }, [onExpire]);

  function optionStyle(letter: "a" | "b" | "c" | "d") {
    if (!reveal && !expired) {
      if (selected === letter) {
        return {
          bg: "rgba(174,234,0,0.08)",
          border: "rgba(174,234,0,0.5)",
          text: "#ffffff",
          labelBg: "rgba(174,234,0,0.2)",
        };
      }
      return {
        bg: "rgba(255,255,255,0.03)",
        border: "rgba(255,255,255,0.08)",
        text: "#ffffff",
        labelBg: "rgba(255,255,255,0.06)",
      };
    }

    const correct = reveal?.correctAnswer ?? null;
    const isCorrect = letter === correct;
    const isSelected = letter === reveal?.selected;

    if (isCorrect) {
      return {
        bg: "rgba(174,234,0,0.12)",
        border: "#aeea00",
        text: "#aeea00",
        labelBg: "#aeea00",
        labelText: "#0a0a0f",
      };
    }
    if (isSelected && !isCorrect) {
      return {
        bg: "rgba(255,71,87,0.1)",
        border: "rgba(255,71,87,0.5)",
        text: "#ff4757",
        labelBg: "rgba(255,71,87,0.2)",
      };
    }
    return {
      bg: "transparent",
      border: "rgba(255,255,255,0.04)",
      text: "#8a948f",
      labelBg: "rgba(255,255,255,0.04)",
    };
  }

  const difficultyColor = { easy: "#aeea00", medium: "#ffb800", hard: "#ff4757" }[question.difficulty];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: "rgba(10,10,15,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="rounded-t-3xl overflow-hidden"
        style={{
          background: "#0e1611",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          animation: "slideUp 0.35s cubic-bezier(0.16,1,0.3,1) forwards",
          maxHeight: "92dvh",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 sticky top-0"
          style={{ background: "#0e1611", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-body font-semibold uppercase tracking-widest px-2 py-1 rounded-full"
              style={{ background: `${difficultyColor}18`, color: difficultyColor, border: `1px solid ${difficultyColor}30` }}
            >
              {question.difficulty}
            </span>
            {question.category && (
              <span className="text-xs font-body text-text-muted capitalize">
                {question.category.replace("_", " ")}
              </span>
            )}
          </div>
          <CountdownTimer
            totalSeconds={question.totalSeconds}
            startTime={question.startTime}
            onExpire={handleExpire}
            size={56}
          />
        </div>

        {/* Question */}
        <div className="px-5 py-5">
          <p className="font-body text-white text-lg font-semibold leading-snug">
            {question.questionText}
          </p>
        </div>

        {/* Options */}
        <div className="px-4 pb-4 space-y-2.5">
          {LETTERS.map((letter, i) => {
            const s = optionStyle(letter);
            return (
              <button
                key={letter}
                onClick={() => handleSelect(letter)}
                disabled={!!selected || expired}
                className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98]"
                style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  color: s.text,
                  minHeight: 56,
                }}
              >
                <span
                  className="w-8 h-8 rounded-xl flex items-center justify-center font-display text-base flex-shrink-0"
                  style={{
                    background: s.labelBg,
                    color: s.labelText ?? s.text,
                  }}
                >
                  {LABELS[i]}
                </span>
                <span className="font-body text-sm font-medium leading-snug">
                  {options[i]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Result reveal */}
        {reveal && (
          <div
            className="mx-4 mb-6 rounded-2xl p-4"
            style={{
              background: reveal.isCorrect ? "rgba(174,234,0,0.08)" : "rgba(255,71,87,0.08)",
              border: `1px solid ${reveal.isCorrect ? "rgba(174,234,0,0.2)" : "rgba(255,71,87,0.2)"}`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="font-display text-2xl"
                style={{ color: reveal.isCorrect ? "#aeea00" : "#ff4757" }}
              >
                {reveal.isCorrect ? "CORRECT!" : "WRONG"}
              </span>
              {reveal.points > 0 && (
                <span
                  className="font-display text-2xl"
                  style={{ color: "#aeea00" }}
                >
                  +{reveal.points}
                </span>
              )}
            </div>
            {question.explanation && (
              <p className="font-body text-sm text-text-muted leading-relaxed">
                {question.explanation}
              </p>
            )}
          </div>
        )}

        {/* Expired with no answer */}
        {expired && !reveal && (
          <div
            className="mx-4 mb-6 rounded-2xl p-4"
            style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.15)" }}
          >
            <p className="font-display text-xl" style={{ color: "#ffb800" }}>
              TIME&apos;S UP
            </p>
            {question.explanation && (
              <p className="font-body text-sm text-text-muted mt-1 leading-relaxed">
                {question.explanation}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
