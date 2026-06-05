/**
 * Shared visual constants — single source of truth for the colour/emoji maps
 * that were previously copy-pasted across game pages. Covers all 5 difficulty
 * tiers defined in src/lib/scoring.ts (easy → master); the old per-page copies
 * only handled easy/medium/hard, so expert/master rendered with no colour.
 */

export type Letter = "A" | "B" | "C" | "D";

/** Answer-option accent colours, keyed by option letter. */
export const LETTER_COLORS: Record<Letter, string> = {
  A: "#4fc3f7",
  B: "#a78bfa",
  C: "#ffb800",
  D: "#f97316",
};

/** Foreground colour per difficulty tier. */
export const DIFFICULTY_COLOR: Record<string, string> = {
  easy: "#00ff87",
  medium: "#ffb800",
  hard: "#ff4757",
  expert: "#a78bfa",
  master: "#f97316",
};

/** Translucent background per difficulty tier (matches DIFFICULTY_COLOR). */
export const DIFFICULTY_BG: Record<string, string> = {
  easy: "rgba(0,255,135,0.12)",
  medium: "rgba(255,184,0,0.12)",
  hard: "rgba(255,71,87,0.12)",
  expert: "rgba(167,139,250,0.12)",
  master: "rgba(249,115,22,0.12)",
};

/** Helpers fall back to the medium tier for unknown difficulties. */
export const difficultyColor = (d: string): string =>
  DIFFICULTY_COLOR[d?.toLowerCase()] ?? DIFFICULTY_COLOR.medium;
export const difficultyBg = (d: string): string =>
  DIFFICULTY_BG[d?.toLowerCase()] ?? DIFFICULTY_BG.medium;

/** Emoji per solo "records" challenge category. */
export const RECORDS_EMOJI: Record<string, string> = {
  "Transfer Market Records": "💰",
  "Penalty Shootout Lore": "⚽",
  "Iconic Managers": "🎩",
  "Legendary Club Seasons": "📖",
  "Golden Boot & Individual Awards": "👟",
  "The Derbies — By Numbers": "🔥",
};
