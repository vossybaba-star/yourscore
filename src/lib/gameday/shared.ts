/**
 * Gameday Quiz — shared types + pure logic.
 *
 * DELIBERATELY IMPORT-FREE, same discipline as src/lib/halftime/shared.ts: the
 * state machine, publish_at derivation, pack naming and answer shuffle are all
 * pure functions/types, so they can be unit-tested with `node --test` and no
 * bundler, no path aliases, no DB. Anything that does I/O belongs in
 * sportmonks.ts, publish.ts or a route handler.
 *
 * Not sharing code with src/lib/halftime/shared.ts on purpose: that module is
 * still live (the prediction poll's phase classification, London-day helpers)
 * and this one must stay independently testable without dragging its state
 * machine along. A few helpers (London matchday math, the answer shuffle) are
 * intentionally duplicated rather than imported — see docs/gameday-quiz-spec.md
 * §0.5 on why the two concerns must not share meaning.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * scheduled -> base_ready -> approved -> published, single direction.
 * Any pre-publish state can go to cancelled (postponement, or unapproved by
 * its publish_at deadline) or failed (bounded-retry exhaustion). Nothing
 * leaves published except manual founder action. `cancelled` is terminal for
 * everything EXCEPT the one automatic reschedule path: a postponed fixture
 * that reappears in the sync window on a new date re-enters at `scheduled`
 * (FIX P2-a) — see sync-fixtures.mjs, the only caller of that transition.
 *
 * 'staged' / 'released' / 'released_late' are NOT part of this machine — they
 * remain in the halftime_releases.state CHECK constraint only because the
 * Halftime Prediction poll's settlement bookkeeping still uses them. A
 * GamedayState value is never compared against those three.
 */
export type GamedayState =
  | "scheduled"
  | "base_ready"
  | "approved"
  | "published"
  | "cancelled"
  | "failed";

export type Difficulty = "easy" | "medium" | "hard";
export type Letter = "A" | "B" | "C" | "D";

/** The shape every quiz pack in this codebase stores in quiz_packs.questions. */
export interface QuizQuestion {
  question: string;
  options: Record<Letter, string>;
  answer: Letter;
  difficulty: Difficulty;
}

export type GamedayKind = "fixture" | "recap";

/** A halftime_releases row, gameday columns only (the table is not in the
 * generated DB types; physical name stays halftime_releases — see the
 * migration header for why). */
export interface GamedayRow {
  id: string;
  fixture_id: number;
  season_id: number | null;
  round_name: string | null;
  gameweek: number | null;
  pack_id: string | null;
  home: string;
  away: string;
  kickoff_at: string;
  publish_at: string | null;
  state: GamedayState;
  kind: GamedayKind;
  base_questions: QuizQuestion[] | null;
  /** The approved, frozen 10 — written at the gate, copied verbatim at publish. */
  questions: QuizQuestion[] | null;
  published_at: string | null;
  second_half_started_at: string | null;
}

export const LETTERS: Letter[] = ["A", "B", "C", "D"];
export const PACK_QUESTION_COUNT = 10;

// ── State machine ────────────────────────────────────────────────────────────

const TRANSITIONS: Record<GamedayState, readonly GamedayState[]> = {
  scheduled: ["base_ready", "cancelled", "failed"],
  base_ready: ["approved", "scheduled", "cancelled", "failed"],
  approved: ["published", "cancelled", "failed"],
  published: [],
  // NOT fully terminal (FIX P2-a): a fixture cancelled for postponement can
  // reappear in the sync window on a new date and must re-enter the pipeline
  // — sync-fixtures.mjs is the only caller of this transition, gated on the
  // incoming kickoff actually differing from the cancelled row's kickoff.
  // Nothing else may leave `cancelled`.
  cancelled: ["scheduled"],
  failed: ["scheduled"],
};

export function canTransition(from: GamedayState, to: GamedayState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function isPublished(state: GamedayState): boolean {
  return state === "published";
}

/** States a fixture can still be published from. */
export function isPublishable(state: GamedayState): boolean {
  return state === "approved";
}

// ── Europe/London day helpers ────────────────────────────────────────────────
// Duplicated from src/lib/halftime/shared.ts (deliberately — see file header).

function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(date)) p[type] = value;
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUTC - date.getTime();
}

/** The Europe/London calendar date (YYYY-MM-DD) an instant falls on. */
export function londonMatchday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * UTC instants bounding a Europe/London calendar day: [start, end). Used to
 * select "today's fixtures"/"today's pushes" by timestamp.
 */
export function londonDayRange(matchday: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = matchday.split("-").map(Number);

  const resolve = (year: number, month: number, day: number): Date => {
    const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const once = new Date(guess.getTime() - tzOffsetMs(guess, "Europe/London"));
    return new Date(guess.getTime() - tzOffsetMs(once, "Europe/London"));
  };

  const start = resolve(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = resolve(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());

  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/** The instant (UTC) that is a given Europe/London wall-clock time on a given
 * YYYY-MM-DD Europe/London calendar date. DST-correct: iterates once to
 * account for the offset shifting the guessed instant across a DST boundary. */
function londonWallClockToUtc(matchday: string, hour: number, minute = 0): Date {
  const [y, m, d] = matchday.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0));
  const once = new Date(guess.getTime() - tzOffsetMs(guess, "Europe/London"));
  return new Date(guess.getTime() - tzOffsetMs(once, "Europe/London"));
}

/**
 * publish_at = 09:00 Europe/London on the MORNING OF kickoff_at's
 * Europe/London date. Recomputed whenever kickoff_at moves (§2.2) — a fixture
 * whose kickoff moves to a different day gets a new publish_at.
 */
export function publishAtFor(kickoffAtIso: string): string {
  // 09:00 Europe/London on the MORNING OF the fixture (founder 2026-07-25: the
  // pack drops at 9am on match day itself, not the day before). PL kickoffs are
  // never before ~12:30, so 09:00 is always safely ahead of kick-off, giving a
  // several-hour play window in the run-up to the game.
  const kickoffDay = londonMatchday(new Date(kickoffAtIso));
  return londonWallClockToUtc(kickoffDay, 9, 0).toISOString();
}

// ── Pack naming ──────────────────────────────────────────────────────────────

/**
 * Pack name. The date is part of the name on purpose (same rule as the old
 * halftime pack): slugs are resolved by name in /api/challenges/pack, and a
 * reverse fixture in a later season would otherwise collide with this one's
 * slug and serve the wrong pack.
 */
export function packName(row: Pick<GamedayRow, "home" | "away" | "kickoff_at">): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(row.kickoff_at));
  return `Gameday: ${row.home} v ${row.away}, ${day}`;
}

export function packDescription(row: Pick<GamedayRow, "home" | "away">): string {
  return `Ten questions on ${row.home} v ${row.away}. Live the morning of the match.`;
}

// ── Recap Quiz (§6) ──────────────────────────────────────────────────────────
//
// One pack per completed gameweek, built from that gameweek's match events.
// `fixture_id` is `not null unique` on halftime_releases (migration 93), so a
// recap row — which has no real fixture — still needs a value there. The spec
// (§6, open item 3) leaves the choice between a synthetic id and a `kind`
// column to the build; migration 110 already added `kind` (`'fixture'|
// 'recap'`), so this is BOTH: kind='recap' discriminates it for every reader
// that filters on kind, and the sentinel below satisfies the unique
// constraint and is deterministic, so re-running gen-recap.mjs for the same
// gameweek resolves to the same row rather than creating a duplicate.
// Negative and season/gameweek-derived so it can never collide with a real
// SportMonks fixture id (always positive).

/** Deterministic, collision-free placeholder fixture_id for a recap row. */
export function recapSentinelFixtureId(seasonId: number, gameweek: number): number {
  return -(Number(seasonId) * 1000 + Number(gameweek));
}

export function recapPackName(row: { gameweek: number | null; season_id: number | null }): string {
  return `Gameday Recap: Gameweek ${row.gameweek ?? "?"}`;
}

export function recapPackDescription(row: { gameweek: number | null }): string {
  return `Ten questions on what actually happened in Gameweek ${row.gameweek ?? "?"} — goals, cards, records, milestones.`;
}

// ── Push ─────────────────────────────────────────────────────────────────────

export const GAMEDAY_PUSH_PREFIX = "gameday:";

/** Per-fixture, exactly-once push dedup key (notification_log.key). */
export function pushDedupeKey(fixtureId: number): string {
  return `${GAMEDAY_PUSH_PREFIX}${fixtureId}`;
}

/**
 * Push copy. Locked vocabulary, never mentions the delivery mechanism. The
 * match has not happened yet at publish time, so — unlike the old halftime
 * push — there is nothing to spoil; the copy names the fixture plainly.
 */
export function pushCopy(row: Pick<GamedayRow, "home" | "away">): {
  title: string;
  body: string;
} {
  return {
    title: `${row.home} v ${row.away}`,
    body: "Your quiz pack is live. Ten questions, play it before kick-off.",
  };
}

/** Deep link to the published pack. */
export function packUrl(slug: string, packId: string): string {
  return `/challenges/${slug}?pid=${packId}`;
}

// ── Deterministic answer shuffle ─────────────────────────────────────────────
// Same construction as src/lib/halftime/shared.ts / scripts/seed-daily-quiz.mjs
// — FNV-1a + mulberry32, seeded from the fixture id so re-assembling the same
// fixture yields the same pack.

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle one question's option positions and recompute its answer letter. */
export function shuffleOptions<T extends QuizQuestion>(q: T, index: number, seed: string | number): T {
  if (!q?.options || !LETTERS.every((k) => q.options[k]) || !LETTERS.includes(q.answer)) {
    return q; // malformed — leave it; validatePackQuestions() will reject the pack
  }
  const rng = mulberry32(hashSeed(`${seed}-${index}-${q.question}`));
  const order: Letter[] = [...LETTERS];
  for (let j = order.length - 1; j > 0; j--) {
    const k = Math.floor(rng() * (j + 1));
    [order[j], order[k]] = [order[k], order[j]];
  }
  const options = {} as Record<Letter, string>;
  LETTERS.forEach((slot, i) => {
    options[slot] = q.options[order[i]];
  });
  const answer = LETTERS[order.indexOf(q.answer)];
  return { ...q, options, answer };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

function toPackQuestion(q: QuizQuestion): QuizQuestion {
  return {
    question: q.question,
    options: q.options,
    answer: q.answer,
    difficulty: q.difficulty,
  };
}

/**
 * Freeze a fixture's final 10 questions from the approved base slate. Base
 * only — there is no fresh/lineup slice in the Gameday pipeline (§0.1: no
 * lineups exist the day before).
 */
export function assembleQuestions(
  base: QuizQuestion[] | null | undefined,
  fixtureId: number,
): QuizQuestion[] {
  const chosen = (base ?? []).slice(0, PACK_QUESTION_COUNT).map(toPackQuestion);
  return chosen.map((q, i) => shuffleOptions(q, i, fixtureId));
}

/**
 * The 10 questions a fixture publishes with — the exact snapshot frozen at
 * the approve gate (row.questions), never regenerated at publish. Publish is
 * a copy, not a generation (AC5).
 */
export function questionsForPublish(
  row: Pick<GamedayRow, "fixture_id" | "base_questions" | "questions">,
): QuizQuestion[] {
  const frozen = row.questions ?? null;
  if (frozen && frozen.length > 0) return frozen;
  return assembleQuestions(row.base_questions, row.fixture_id);
}

/**
 * Gate a pack before it can be approved or published. Returns [] when valid.
 * A pack that fails this must never reach a player.
 */
export function validatePackQuestions(questions: unknown): string[] {
  const errs: string[] = [];
  if (!Array.isArray(questions)) return ["questions must be an array"];
  if (questions.length !== PACK_QUESTION_COUNT) {
    errs.push(`expected ${PACK_QUESTION_COUNT} questions, got ${questions.length}`);
  }
  questions.forEach((raw, i) => {
    const q = raw as Partial<QuizQuestion>;
    const at = `q${i + 1}`;
    if (!q || typeof q.question !== "string" || !q.question.trim()) {
      errs.push(`${at}: missing question text`);
      return;
    }
    if (!q.options || !LETTERS.every((k) => typeof q.options?.[k] === "string" && q.options[k].trim())) {
      errs.push(`${at}: needs options A-D`);
    }
    if (!q.answer || !LETTERS.includes(q.answer)) {
      errs.push(`${at}: answer must be A-D`);
    }
    if (!q.difficulty || !["easy", "medium", "hard"].includes(q.difficulty)) {
      errs.push(`${at}: difficulty must be easy|medium|hard`);
    }
  });
  return errs;
}
