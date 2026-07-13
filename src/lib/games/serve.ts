/**
 * Quiz "game types" — standalone play surfaces (Higher or Lower, Guess the
 * Player) that live alongside the normal packs in the Quiz picker.
 *
 * SERVER-ONLY. The question source is the SportMonks-fed pool built by
 * scripts/gates/build-pool.sh (src/data/gates/pool.json) — the SAME clean,
 * validated generators used by the Fantasy gates, reused here as evergreen quiz
 * content. The pool carries answers, so this module (and only server code that
 * imports it) must never reach the client: the play page fetches answer-free
 * questions from /api/games/[type] and grading happens here.
 *
 * Anti-cheat by construction (mirrors the WC practice-quiz): a round is DERIVED
 * deterministically from a random seed (same seed → same selection + order), the
 * client gets it answer-free alongside the seed, and grading re-derives the same
 * round from that seed. Nothing is persisted; no answer key is ever shipped.
 */

import poolData from "@/data/gates/pool.json";
import { seededRng, shuffle } from "@/lib/gates/rng";

export const GAME_TYPES = ["higher-lower", "guess-the-player"] as const;
export type GameType = (typeof GAME_TYPES)[number];

export function isGameType(v: string): v is GameType {
  return (GAME_TYPES as readonly string[]).includes(v);
}

/** How many questions in one round of a game type. */
export const ROUND_SIZE = 10;

/** Question window (ms) for the speed-scoring bands. */
export const GAME_WINDOW_MS = 25_000;

interface PoolOption {
  id: number;
  label: string;
}

interface PoolQuestion {
  format: string;
  prompt: string;
  options: PoolOption[];
  answerId: number;
  stat?: string;
  difficulty: number; // 0–100
  positions: string[];
  meta?: Record<string, string | number>;
}

const ALL_QUESTIONS = (poolData as unknown as { questions: PoolQuestion[] }).questions;

/**
 * Higher-or-Lower TOPICS — the selectable stats. Each pairs same-position players
 * (a keeper is never compared to a striker). "Mixed" spans several across a round.
 */
export const HL_TOPICS = [
  { key: "goals", label: "Goals", emoji: "⚽" },
  { key: "assists", label: "Assists", emoji: "🅰️" },
  { key: "appearances", label: "Appearances", emoji: "👕" },
  { key: "age", label: "Age", emoji: "🎂" },
] as const;

export type HlTopic = (typeof HL_TOPICS)[number]["key"];
const HL_TOPIC_KEYS = HL_TOPICS.map((t) => t.key) as readonly string[];

export function isHlTopic(v: string): v is HlTopic {
  return HL_TOPIC_KEYS.includes(v);
}

/** Position code → plural label for the "which of these <forwards>" chip. */
const POSITION_LABEL: Record<string, string> = {
  GK: "Goalkeepers",
  DEF: "Defenders",
  MID: "Midfielders",
  FWD: "Forwards",
};

/**
 * Which pool questions belong to each game type.
 * - Higher or Lower: same-position stat comparisons across the four topics. The
 *   FPL "price"/"points" questions are excluded (they feed the Fantasy gates).
 * - Guess the Player: the two first-person "who am I" formats (drip-clue bio +
 *   Premier League career path).
 */
const BELONGS: Record<GameType, (q: PoolQuestion) => boolean> = {
  "higher-lower": (q) => q.format === "higher-lower" && typeof q.stat === "string" && isHlTopic(q.stat),
  "guess-the-player": (q) => q.format === "who-am-i" || q.format === "career-path",
};

export function poolFor(type: GameType): PoolQuestion[] {
  return ALL_QUESTIONS.filter(BELONGS[type]);
}

/** Total questions available for a type (for the picker "Q" chip / availability). */
export function poolSize(type: GameType): number {
  return poolFor(type).length;
}

/**
 * The Higher-or-Lower topic is baked into the round seed ("goals:<uuid>") so a
 * round rebuilt from the seed at GRADE time reproduces the exact same questions —
 * the client never has to (and can't) re-supply the topic. "mixed" (or any
 * non-topic prefix) means span every topic.
 */
export function topicFromSeed(seed: string): string {
  return seed.split(":", 1)[0] ?? "";
}

/**
 * Deterministically build one round from a seed: optional topic filter (from the
 * seed prefix), seeded shuffle, take ROUND_SIZE, then order easy → hard so each
 * round warms the player up. Pure + reproducible — grading rebuilds the identical
 * round from the seed.
 */
export function buildRound(type: GameType, seed: string, count = ROUND_SIZE): PoolQuestion[] {
  const pool = poolFor(type);
  let use = pool;
  if (type === "higher-lower") {
    const topic = topicFromSeed(seed);
    if (isHlTopic(topic)) {
      const scoped = pool.filter((q) => q.stat === topic);
      if (scoped.length >= 2) use = scoped; // fall back to mixed if a topic is thin
    }
  }
  const rand = seededRng(`games:${type}:${seed}`);
  const picked = shuffle(use, rand).slice(0, Math.min(count, use.length));
  picked.sort((a, b) => a.difficulty - b.difficulty);
  return picked;
}

/** Map the generator's 0–100 difficulty to a scoring band (scoring.ts). */
export function difficultyBand(d: number): string {
  if (d < 30) return "easy";
  if (d < 55) return "medium";
  if (d < 75) return "hard";
  if (d < 90) return "expert";
  return "master";
}

/**
 * Visual clues shown DURING a Who-am-I question (nationality flag + shirt
 * number). These are clues by design — the same facts the text prompt used to
 * spell out — so they're safe to send pre-answer. The answer's photo + name are
 * NOT here; they're only revealed on grade.
 */
export interface QuestionClue {
  nationality?: string;
  flagUrl?: string;
  jersey?: number;
}

/** What the client is allowed to see: NO answerId, NO answer name, NO photo. */
export interface ServedQuestion {
  idx: number;
  format: string;
  prompt: string;
  difficulty: string; // banded label (also drives the difficulty chip)
  options: { id: number; label: string }[];
  clue?: QuestionClue; // Who-am-I only
  topic?: string; // Higher-or-Lower stat key (drives the topic chip in mixed rounds)
  position?: string; // Higher-or-Lower position label, e.g. "Forwards"
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function clientRound(round: readonly PoolQuestion[]): ServedQuestion[] {
  return round.map((q, idx) => {
    const base: ServedQuestion = {
      idx,
      format: q.format,
      prompt: q.prompt,
      difficulty: difficultyBand(q.difficulty),
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    };
    // Who-am-I ships the flag + shirt number as visual clues (never the answer).
    if (q.format === "who-am-i" && q.meta) {
      const jersey = typeof q.meta.jersey === "number" && q.meta.jersey > 0 ? q.meta.jersey : undefined;
      base.clue = { nationality: str(q.meta.nationality), flagUrl: str(q.meta.flag), jersey };
    }
    // Higher-or-Lower carries its topic + the shared position (same-position pair).
    if (q.format === "higher-lower") {
      base.topic = q.stat;
      base.position = POSITION_LABEL[q.positions[0]] ?? undefined;
    }
    return base;
  });
}

/** Grade one answer server-side against a round rebuilt from its seed. */
export function gradeAnswer(
  round: readonly PoolQuestion[],
  idx: number,
  optionId: number,
): { correct: boolean; answerId: number } | null {
  const q = round[idx];
  if (!q) return null;
  if (!q.options.some((o) => o.id === optionId)) return null; // not an offered option
  return { correct: optionId === q.answerId, answerId: q.answerId };
}

/** The reveal payload (post-answer): the correct player's name + photo, if known. */
export function revealFor(
  round: readonly PoolQuestion[],
  idx: number,
): { name?: string; photoUrl?: string } {
  const q = round[idx];
  if (!q || !q.meta) return {};
  return { name: str(q.meta.answer), photoUrl: str(q.meta.photo) };
}
