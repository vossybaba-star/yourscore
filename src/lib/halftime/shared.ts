/**
 * Halftime Quiz Packs — shared types + pure logic.
 *
 * DELIBERATELY IMPORT-FREE. Every export here is a pure function or a type, so
 * the state machine / assembly / phase classification can be unit-tested by
 * running this file directly under `node --test` with no bundler, no path
 * aliases and no DB. (See shared.test.ts.) Anything that does I/O belongs in
 * sportmonks.ts or the route handlers.
 *
 * The one thing NOT duplicated here is slugify(): the routes import the
 * canonical one from "@/lib/utils" so pack slugs can never drift from the
 * slug resolution in /api/challenges/pack.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type HalftimeState =
  | "scheduled"
  | "base_ready"
  | "staged"
  | "released"
  | "released_late"
  | "cancelled"
  | "failed";

export type FreshState =
  | "none"
  | "pending_veto"
  | "approved"
  | "vetoed"
  | "killed"
  | "skipped";

export type Difficulty = "easy" | "medium" | "hard";
export type Letter = "A" | "B" | "C" | "D";

/** The shape every quiz pack in this codebase stores in quiz_packs.questions. */
export interface QuizQuestion {
  question: string;
  options: Record<Letter, string>;
  answer: Letter;
  difficulty: Difficulty;
}

export type FreshStatus = "pending" | "approved" | "vetoed" | "dropped";

/** A fresh-slice question: a quiz question plus its grounding + gate status. */
export interface FreshQuestion extends QuizQuestion {
  status: FreshStatus;
  /** Machine-checkable claims the validator re-resolves against SportMonks. */
  claims?: unknown[];
  /** The dossier line this question was written from (shown in the veto message). */
  fact?: string;
}

/** A halftime_releases row (the table is not in the generated DB types). */
export interface HalftimeRow {
  id: string;
  fixture_id: number;
  season_id: number | null;
  round_name: string | null;
  pack_id: string | null;
  home: string;
  away: string;
  kickoff_at: string;
  state: HalftimeState;
  base_questions: QuizQuestion[] | null;
  fresh_questions: FreshQuestion[] | null;
  /** The final 10, frozen at assembly (T-10) and copied verbatim at the whistle. */
  pack_questions: QuizQuestion[] | null;
  fresh_state: FreshState;
  veto_deadline_at: string | null;
  telegram_message_id: number | null;
  released_at: string | null;
}

export const LETTERS: Letter[] = ["A", "B", "C", "D"];
export const PACK_QUESTION_COUNT = 10;
/** Fresh questions REPLACE base questions, never extend the pack past 10. */
export const MAX_FRESH_QUESTIONS = 3;

// ── State machine ────────────────────────────────────────────────────────────

/**
 * Single-direction lifecycle:
 *   scheduled → base_ready → staged → released | released_late
 * Any pre-release state can go to `cancelled` (postponement) or `failed`
 * (bounded-retry exhaustion). Nothing leaves released/released_late/cancelled
 * except manual founder action (done in SQL, not through this machine).
 *
 * base_ready → scheduled is the "kickoff moved to another day" path: the
 * fixture drops out of today's slate and re-enters the pipeline on its new day.
 * failed → scheduled is the weekly-sync repair path.
 */
const TRANSITIONS: Record<HalftimeState, readonly HalftimeState[]> = {
  scheduled: ["base_ready", "cancelled", "failed"],
  base_ready: ["staged", "scheduled", "cancelled", "failed"],
  staged: ["released", "released_late", "cancelled", "failed"],
  released: [],
  released_late: [],
  cancelled: [],
  failed: ["scheduled"],
};

export function canTransition(from: HalftimeState, to: HalftimeState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export const RELEASED_STATES: readonly HalftimeState[] = ["released", "released_late"];

export function isReleased(state: HalftimeState): boolean {
  return RELEASED_STATES.includes(state);
}

/** States a fixture can still be released from. */
export function isReleasable(state: HalftimeState): boolean {
  return state === "staged";
}

// ── SportMonks match phase ───────────────────────────────────────────────────

/** Verified 2026-07-14 against GET /v3/football/states: halftime is id 3 (HT). */
export const HALFTIME_STATE_ID = 3;

export type MatchPhase =
  | "pre"
  | "first_half"
  | "halftime"
  | "past_halftime"
  | "abnormal"
  | "unknown";

/**
 * Everything at or past the second-half whistle. `BREAK` is the pre-extra-time
 * break, not halftime — mapping it to "halftime" would release a pack an hour
 * late and fire a push after full time, so it lives here.
 */
const PAST_HALFTIME_NAMES = new Set([
  "INPLAY_2ND_HALF", // 22
  "BREAK", // 4
  "EXTRA_TIME_BREAK", // 21
  "INPLAY_ET", // 6
  "INPLAY_ET_SECOND_HALF", // 23 — NOT "INPLAY_ET_2ND_HALF"; that name does not
  // exist in the catalogue, and the wrong spelling silently classified as
  // "unknown" (= take no action). Harmless for a PL fixture, which has no extra
  // time, but a lie in the code. Every name in these sets is asserted against
  // the recorded live catalogue by assertStateNamesExist() — see shared.test.ts.
  "PEN_BREAK", // 25
  "INPLAY_PENALTIES", // 9
  "FT", // 5
  "AET", // 7
  "FT_PEN", // 8
]);

/**
 * The match is over and has a final score. A strict subset of
 * PAST_HALFTIME_NAMES: prediction settlement needs FULL TIME specifically —
 * "past half-time" also covers the live second half, whose score is not final.
 * Every name here is already in PAST_HALFTIME_NAMES, so it is covered by the
 * catalogue assertion in shared.test.ts.
 */
const FINISHED_NAMES = new Set(["FT", "AET", "FT_PEN"]);

/** True once a fixture has finished (FT / after extra time / after penalties). */
export function isFinishedState(developerName?: string | null): boolean {
  return FINISHED_NAMES.has(String(developerName ?? "").trim().toUpperCase());
}

/**
 * Terminal, no-match-happened states. These flip a staged fixture to
 * `cancelled` — no pack is ever inserted and no push ever fires.
 * SUSPENDED / INTERRUPTED / DELAYED are deliberately NOT here: they can resume,
 * so they classify as "unknown" and the poller simply takes no action.
 */
const ABNORMAL_NAMES = new Set([
  "POSTPONED",
  "CANCELLED",
  "ABANDONED",
  "WO",
  "AWARDED",
  "DELETED",
]);

const PRE_NAMES = new Set(["NS", "TBA", "PENDING"]);

/**
 * Every developer_name this module claims to understand.
 *
 * Exported ONLY so the test suite can assert each one actually exists in the
 * SportMonks states catalogue (scripts/halftime/scenarios/states.json, recorded
 * from the live API). A misspelled name here does not throw — it silently falls
 * through to "unknown" and the poller takes no action, which is exactly the kind
 * of defect that hides until the one match where it matters. So we assert the
 * names against ground truth instead of trusting that they were typed correctly.
 */
export const CLASSIFIED_STATE_NAMES: readonly string[] = [
  ...Array.from(PRE_NAMES),
  "INPLAY_1ST_HALF",
  "HT",
  ...Array.from(PAST_HALFTIME_NAMES),
  ...Array.from(ABNORMAL_NAMES),
];

/**
 * Classify a fixture's SportMonks state. `developerName` comes from the states
 * catalogue fetched at runtime (GET /v3/football/states) — no id other than the
 * verified halftime id 3 is ever hardcoded.
 *
 * Unrecognised states return "unknown", which every caller treats as "do
 * nothing". Silence is the safe default: the watchdog re-checks every 5 minutes.
 */
export function classifyPhase(
  stateId: number,
  developerName?: string | null,
): MatchPhase {
  if (stateId === HALFTIME_STATE_ID) return "halftime";

  const name = String(developerName ?? "").trim().toUpperCase();
  if (!name) return "unknown";

  if (name === "HT") return "halftime"; // catalogue agrees with the id
  if (PRE_NAMES.has(name)) return "pre";
  if (name === "INPLAY_1ST_HALF") return "first_half";
  if (ABNORMAL_NAMES.has(name)) return "abnormal";
  if (PAST_HALFTIME_NAMES.has(name)) return "past_halftime";
  return "unknown";
}

// ── Europe/London matchday helpers ───────────────────────────────────────────

/** Offset (ms) between a timezone's wall clock and UTC at a given instant. */
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
    Number(p.hour) % 24, // some ICU builds render midnight as "24"
    Number(p.minute),
    Number(p.second),
  );
  return asUTC - date.getTime();
}

/** The Europe/London calendar date (YYYY-MM-DD) an instant falls on. */
export function londonMatchday(at: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * UTC instants bounding a Europe/London calendar day: [start, end).
 * Used to select "today's fixtures" by kickoff_at. DST-correct — a BST day
 * starts at 23:00 UTC the previous day, and this returns exactly that.
 */
export function londonDayRange(matchday: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = matchday.split("-").map(Number);

  const resolve = (year: number, month: number, day: number): Date => {
    const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    // Correct by the offset in effect, then re-derive at the corrected instant
    // so a DST boundary lands on the right side.
    const once = new Date(guess.getTime() - tzOffsetMs(guess, "Europe/London"));
    return new Date(guess.getTime() - tzOffsetMs(once, "Europe/London"));
  };

  const start = resolve(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d + 1)); // Date.UTC normalises overflow
  const end = resolve(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());

  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

// ── Pack naming ──────────────────────────────────────────────────────────────

/**
 * Pack name. The date is part of the name on purpose: slugs are resolved by
 * name in /api/challenges/pack, and a reverse fixture in a later season would
 * otherwise collide with this one's slug and serve the wrong pack.
 * e.g. "Halftime: Arsenal v Coventry, 22 Aug 2026"
 */
export function packName(row: Pick<HalftimeRow, "home" | "away" | "kickoff_at">): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(row.kickoff_at));
  return `Halftime: ${row.home} v ${row.away}, ${day}`;
}

export function packDescription(row: Pick<HalftimeRow, "home" | "away">): string {
  return `Ten questions on ${row.home} v ${row.away}. Every one of them set before kick-off.`;
}

// ── Push ─────────────────────────────────────────────────────────────────────

export const HALFTIME_PUSH_PREFIX = "halftime:";

/** Per-fixture, exactly-once push dedup key (notification_log.key). */
export function pushDedupeKey(fixtureId: number): string {
  return `${HALFTIME_PUSH_PREFIX}${fixtureId}`;
}

/**
 * Push copy. Spoiler-free BY RULE: no score, no first-half events, nothing that
 * happened after the kickoff whistle — people play this later in the day and a
 * push that leaks the scoreline ruins the match for them. Locked vocabulary
 * ("quiz pack"), and never a word about how the game is delivered.
 */
export function pushCopy(row: Pick<HalftimeRow, "home" | "away">): {
  title: string;
  body: string;
} {
  return {
    title: `Half time: ${row.home} v ${row.away}`,
    body: "Your quiz pack is live. Ten questions, see where you land.",
  };
}

/** Deep link to the released pack. */
export function packUrl(slug: string, packId: string): string {
  return `/challenges/${slug}?pid=${packId}`;
}

// ── Deterministic answer shuffle ─────────────────────────────────────────────
// Authors write the correct answer as option A every time, so an un-shuffled
// pack has the answer in slot A for all 10 questions. Same publish-time fix as
// the daily quiz (scripts/seed-daily-quiz.mjs) — FNV-1a + mulberry32, seeded
// from the fixture id so re-assembling the same fixture yields the same pack.

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
  // order[i] = the ORIGINAL letter now sitting in slot LETTERS[i].
  const options = {} as Record<Letter, string>;
  LETTERS.forEach((slot, i) => {
    options[slot] = q.options[order[i]];
  });
  const answer = LETTERS[order.indexOf(q.answer)];
  return { ...q, options, answer };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/** A question as it lands in quiz_packs — gate metadata (claims/status) stripped. */
function toPackQuestion(q: QuizQuestion): QuizQuestion {
  return {
    question: q.question,
    options: q.options,
    answer: q.answer,
    difficulty: q.difficulty,
  };
}

/**
 * Freeze a fixture's final 10 questions.
 *
 * Approved fresh questions lead the pack (they are the "how did they know
 * that" hook), then base questions fill to exactly 10 in authored order. Fresh
 * REPLACES base — it never extends the pack past 10.
 *
 * `baseOnly` is the degraded path: no lineups, validator dropped everything,
 * founder vetoed all, kill switch, Telegram down, or the watchdog assembling
 * after the poller died. A base-only pack is a completely normal outcome.
 */
export function assembleQuestions(
  base: QuizQuestion[] | null | undefined,
  fresh: FreshQuestion[] | null | undefined,
  fixtureId: number,
  opts: { baseOnly?: boolean } = {},
): QuizQuestion[] {
  const approvedFresh = opts.baseOnly
    ? []
    : (fresh ?? [])
        .filter((q) => q.status === "approved")
        .slice(0, MAX_FRESH_QUESTIONS);

  const need = PACK_QUESTION_COUNT - approvedFresh.length;
  const chosen = [
    ...approvedFresh.map(toPackQuestion),
    ...(base ?? []).slice(0, Math.max(0, need)).map(toPackQuestion),
  ];

  return chosen.map((q, i) => shuffleOptions(q, i, fixtureId));
}

/**
 * The 10 questions a fixture releases with.
 *
 * Normally the EXACT snapshot frozen at assembly — release is a copy, not a
 * generation, which is what makes first-half contamination impossible by
 * construction (AC3b: the released pack is byte-identical to the T-10 snapshot).
 *
 * Two deviations, both of which only ever REMOVE content or substitute in
 * already-approved, day-before base questions — never author anything new:
 *   - a founder veto landing after the deadline but before the whistle;
 *   - the matchday kill switch (fresh_state = 'killed').
 * And one fallback: no frozen snapshot at all (the poller died before assembly)
 * → base-only, never fresh.
 */
export function questionsForRelease(
  row: Pick<HalftimeRow, "fixture_id" | "base_questions" | "fresh_questions" | "pack_questions" | "fresh_state">,
): QuizQuestion[] {
  const frozen = row.pack_questions ?? null;
  const fresh: FreshQuestion[] = row.fresh_questions ?? [];
  const baseOnly = row.fresh_state === "killed";

  if (!frozen || frozen.length === 0) {
    return assembleQuestions(row.base_questions, fresh, row.fixture_id, { baseOnly: true });
  }

  const vetoed = new Set(fresh.filter((q) => q.status === "vetoed").map((q) => q.question));
  const lateVeto = vetoed.size > 0 && frozen.some((q) => vetoed.has(q.question));

  if (!lateVeto && !baseOnly) return frozen;

  return assembleQuestions(row.base_questions, fresh, row.fixture_id, { baseOnly });
}

/**
 * Gate a pack before it can be staged or released. Returns [] when valid.
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
