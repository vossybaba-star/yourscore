"use client";

// Universal in-game header (2026-08-07 simplification, phase 2). One sticky
// chrome for every question-based game: progress bar, Quit, timer, score,
// question count, difficulty. Extracted from the identical hand-rolled headers
// in challenges/[slug] and play/game/[type] so a new game gets the exact same
// in-play shell for free and exits stop varying per game.

export function timerColor(ms: number): string {
  if (ms < 6000) return "#aeea00";
  if (ms < 12000) return "#00d8c0";
  return "#ff4757";
}

export function timerDisplay(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`.toUpperCase();
}

export function GameHeader({
  accent,
  progressPct,
  progressGradient,
  onQuit,
  timerMs,
  timerFrozen,
  score,
  current,
  total,
  difficulty,
  difficultyColor,
  difficultyBg,
}: {
  accent: string;
  /** 0..100 */
  progressPct: number;
  /** optional CSS gradient for the progress bar; defaults to the accent */
  progressGradient?: string;
  onQuit: () => void;
  timerMs: number;
  /** dims the timer dot once the answer is revealed */
  timerFrozen?: boolean;
  score?: number;
  current: number;
  total: number;
  difficulty?: string;
  difficultyColor?: string;
  difficultyBg?: string;
}) {
  const tColor = timerColor(timerMs);
  return (
    <div
      className="sticky top-0 z-10 pt-safe"
      style={{ background: "rgba(10,10,15,0.98)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
        <div
          className="h-full transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%`, background: progressGradient ?? `linear-gradient(90deg, ${accent}, ${accent})` }}
        />
      </div>

      <div className="px-5 py-3 flex items-center justify-between gap-3">
        <button
          onClick={onQuit}
          className="flex items-center gap-1.5 font-body text-xs flex-shrink-0"
          style={{ color: "#586058" }}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
            <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Quit
        </button>

        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl flex-1 justify-center"
          style={{ background: `${tColor}10`, border: `1px solid ${tColor}28` }}
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: "50%", background: tColor, display: "inline-block",
              boxShadow: timerFrozen ? "none" : `0 0 6px ${tColor}`, opacity: timerFrozen ? 0.4 : 1,
            }}
          />
          <span className="font-display text-base tabular-nums" style={{ color: tColor }}>{timerDisplay(timerMs)}</span>
        </div>

        {typeof score === "number" && (
          <div
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl flex-shrink-0"
            style={{ background: `${accent}12`, border: `1px solid ${accent}25` }}
          >
            <span className="font-display text-sm" style={{ color: accent }}>{score.toLocaleString()}</span>
            <span className="font-body text-xs" style={{ color: "#5b645e" }}>pts</span>
          </div>
        )}
      </div>

      <div className="px-5 pb-2.5 flex items-center gap-2">
        <span className="font-body text-xs" style={{ color: "#586058" }}>
          Question <span className="text-white">{current}</span> of {total}
        </span>
        {difficulty && (
          <span
            className="ml-auto font-display text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider"
            style={{
              background: difficultyBg ?? `${accent}20`,
              color: difficultyColor ?? accent,
              border: `1px solid ${difficultyColor ?? accent}30`,
            }}
          >
            {difficulty}
          </span>
        )}
      </div>
    </div>
  );
}
