/**
 * Quiz "stat highlight" tiles for Matchweek → Live Quiz — the tweet-shaped cards
 * that turn a played question into a talking point ("73% of fans nailed this —
 * only 9% got the next one"). They sell the game by showing the crowd playing it.
 *
 * Source (prod): a job aggregates quiz_attempts answer distributions per halftime
 * question and writes the top few most-interesting into ONE quiz_highlights doc
 * (biggest split, most-missed, near-universal) that /api/pl/quiz-highlights reads.
 * Pre-season there are no halftime attempts yet, so the doc is seeded with
 * illustrative highlights until real games produce real numbers.
 */

export interface QuizHighlight {
  id: string;
  /** The question, verbatim. */
  question: string;
  /** The correct answer. */
  answer: string;
  /** % of players who got it right (0–100). */
  correctPct: number;
  /** How many players answered — the "n" that makes the % honest. */
  sampleSize: number;
  /** Optional fixture the question came from, e.g. "Arsenal v Chelsea". */
  fixture?: string;
}

export interface QuizHighlightsDoc {
  items: QuizHighlight[];
  updatedAt: string | null;
}

/** Framing: a near-universal answer reads "nailed", a rare one "stumped". The
 *  cut is deliberate — 40% right is still "most got it wrong". */
export function angleFor(pct: number): { label: string; tone: "good" | "hard" } {
  return pct >= 55 ? { label: "Fans nailed this", tone: "good" } : { label: "This one stumped fans", tone: "hard" };
}
