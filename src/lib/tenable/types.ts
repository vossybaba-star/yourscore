/**
 * Football Tenable — shared types.
 *
 * Tenable (a LukePingu-signature format): each board is a hidden "top 10" list.
 * The player names as many of the 10 as they can; every guess that ISN'T on the
 * list costs one of their 5 lives. Run out of lives → the round ends. The order
 * is hidden during play and revealed slot-by-slot as answers are found.
 *
 * Designed for a weekly SHARED SEED: everyone plays the identical board that
 * week, so scores are directly comparable and shareable ("can you beat Luke?").
 */

export interface TenableAnswer {
  /** Real ranking position, 1 (highest) … 10. Shown on reveal, hidden in play. */
  rank: number;
  /** Canonical display name, e.g. "Alan Shearer". */
  label: string;
  /** The stat revealed alongside the answer, e.g. "260 goals". */
  detail: string;
  /**
   * Accepted typed guesses — surnames, full names, common alternate spellings.
   * Matched after normalization (lowercase, accent/punctuation-stripped), so
   * "Krkic" will still match a stored "krkić". Keep these generous.
   */
  accept: string[];
}

export interface TenableBoard {
  /** URL-safe id, e.g. "pl-top-scorers". */
  slug: string;
  /** Weekly index — which week's drop this is. */
  week: number;
  /** The question shown to the player, e.g. "Premier League all-time top scorers". */
  category: string;
  /** Scope clarifier, e.g. "Men's Premier League, since 1992". */
  subtitle: string;
  /** Citation URL the list was verified against. */
  source: string;
  /** What LukePingu scored on this board (0–10) — pinned as the target. */
  lukeScore: number;
  /** One line of trash talk in Luke's voice, shown on the board + result. */
  lukeQuote: string;
  /** Exactly 10 answers. */
  answers: TenableAnswer[];
}

export type GuessOutcome =
  | { kind: "hit"; answer: TenableAnswer } // found a new answer
  | { kind: "miss" } //                       not on the list → loses a life
  | { kind: "duplicate"; answer: TenableAnswer } // already found → no penalty
  | { kind: "empty" }; //                     blank / unusable guess → ignored

export interface TenableState {
  /** Ranks (1–10) the player has already found. */
  foundRanks: number[];
  /** Lives remaining (starts at STARTING_LIVES). */
  lives: number;
  /** Wrong guesses the player has made (for the share/result recap). */
  misses: string[];
  /** "playing" until lives hit 0 or all 10 found. */
  status: "playing" | "won" | "lost";
}
