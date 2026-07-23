import type { Attributes } from "@/components/profile/PlayerCard";

/**
 * Turning raw play history into the six card attributes.
 *
 * Two rules hold this together:
 *  1. Nothing here is game-specific. Every attribute is something a YourScore
 *     player is, not something one game measures — so a new game feeds the
 *     existing six rather than needing its own slot.
 *  2. Nobody scores zero. A new player is a genuine 40-rated Rookie, not a card
 *     full of blanks. A gap in a trophy cabinet reads as "go win that"; a gap in
 *     a stat block reads as "this app is broken".
 */

/** Every player starts here, so the card is never empty. */
const FLOOR = 38;
const MAX = 99;

/** Map a 0..1 ratio onto FLOOR..MAX. */
function scale(ratio: number): number {
  const r = Math.max(0, Math.min(1, ratio));
  return Math.round(FLOOR + r * (MAX - FLOOR));
}

/**
 * Diminishing-returns curve for open-ended counts (games, friends, streak days).
 * `soft` is the value that should feel like "solidly good" — roughly 75.
 * Linear scaling would make the 200th game worth as much as the 2nd; it isn't.
 */
function curve(value: number, soft: number): number {
  if (value <= 0) return FLOOR;
  return scale(1 - Math.exp(-value / soft));
}

export type CardInputs = {
  /** Lifetime quiz accuracy, 0..1 — from get_profile_accuracy. */
  accuracy: number | null;
  /** Total answers behind that accuracy; low volume shouldn't mint a 99. */
  answered: number;
  /** Mean answer time in ms across graded answers. */
  avgAnswerMs: number | null;
  wins: number;
  draws: number;
  losses: number;
  /** Consecutive UK days played — from @/lib/streak. */
  dayStreak: number;
  /** Distinct game types played at least once. */
  gameTypesPlayed: number;
  /** Game types currently available to play. */
  gameTypesTotal: number;
  friends: number;
  /** Games played against a named human (not a bot, not solo). */
  socialGames: number;
};

/**
 * Answer-speed bounds. Below FAST_MS is a 99, above SLOW_MS is the floor —
 * both taken from the spread of real answer times, not invented.
 */
const FAST_MS = 2_500;
const SLOW_MS = 15_000;

export function computeAttributes(i: CardInputs): Attributes {
  // Accuracy is only meaningful once there's volume behind it. Under 50 answers
  // we pull toward the floor, so a lucky 3/3 doesn't outrank a real 800-answer
  // record. Confidence reaches full weight at 200 answers.
  const confidence = Math.min(1, i.answered / 200);
  const KNO = i.accuracy === null ? FLOOR : scale(i.accuracy * confidence + 0.25 * (1 - confidence));

  const PAC =
    i.avgAnswerMs === null
      ? FLOOR
      : scale((SLOW_MS - Math.max(FAST_MS, Math.min(SLOW_MS, i.avgAnswerMs))) / (SLOW_MS - FAST_MS));

  // Draws are worth half a win, mirroring the points model in @/lib/rank.
  const played = i.wins + i.draws + i.losses;
  const WIN = played === 0 ? FLOOR : scale(((i.wins + i.draws * 0.5) / played) * Math.min(1, played / 20));

  // ~3 weeks of daily play should feel excellent; the streak window caps at 45.
  const CON = curve(i.dayStreak, 12);

  const RNG = i.gameTypesTotal === 0 ? FLOOR : scale(i.gameTypesPlayed / i.gameTypesTotal);

  // Both halves matter: having friends, and actually playing them.
  const SOC = Math.round((curve(i.friends, 8) + curve(i.socialGames, 25)) / 2);

  return { KNO, PAC, WIN, CON, RNG, SOC };
}

/**
 * Overall is the mean of the six, weighted toward performance over participation
 * — otherwise a player could reach Gold by adding friends and logging in.
 */
export function computeOvr(a: Attributes): number {
  const weighted =
    a.KNO * 0.25 + a.WIN * 0.25 + a.PAC * 0.15 + a.CON * 0.15 + a.RNG * 0.12 + a.SOC * 0.08;
  return Math.round(weighted);
}

/**
 * Your archetype is your leading attribute — so two players on the same OVR
 * still read as different players, which a single rank number can never do.
 */
const ARCHETYPES: Record<keyof Attributes, string> = {
  KNO: "SCHOLAR",
  PAC: "QUICK",
  WIN: "WINNER",
  CON: "REGULAR",
  RNG: "ALL-ROUND",
  SOC: "SOCIAL",
};

export function computeArchetype(a: Attributes): string {
  const entries = Object.entries(a) as [keyof Attributes, number][];
  const [top, second] = entries.sort((x, y) => y[1] - x[1]);
  // Everything still at the floor means no record yet — not a flat skill set.
  // Without this, a brand-new player reads as "COMPLETE", the opposite of true.
  if (top[1] <= FLOOR + 4) return "ROOKIE";
  // Nothing clearly leads → they're a genuine all-rounder, not a specialist.
  if (top[1] - second[1] < 4) return "COMPLETE";
  return ARCHETYPES[top[0]];
}

/** The weakest attribute, for the "what to work on" nudge under the card. */
export function weakestAttribute(a: Attributes): keyof Attributes {
  return (Object.entries(a) as [keyof Attributes, number][]).sort((x, y) => x[1] - y[1])[0][0];
}
