/**
 * YourScore Fantasy Football — gate generator: shared types.
 *
 * The "gates" are the knowledge-round challenges that earn a player's transfer
 * budget. This module is the content-generation engine that turns football data
 * into validated, unambiguous question instances (a "clean base").
 *
 * ADDITIVE and self-contained: it does not touch existing YourScore schema or
 * routes. Authored to be type-strippable (no enums / namespaces / param-props)
 * so the generators + validators run under `node --test` with Node's native
 * type stripping — same convention as src/lib/draft/*.
 */

/** Outfield/keeper position buckets (FPL element_type). */
export type Position = "GK" | "DEF" | "MID" | "FWD";

export const POSITIONS: Position[] = ["GK", "DEF", "MID", "FWD"];

/**
 * A normalized football player — the single input shape every generator reads.
 * Sourced from the public FPL feed today (see fpl.ts); SportMonks later fills the
 * optional fields (nationality, age, career/transfer history) for the Who-am-I
 * and Career-path formats. Keeping those optional means the data-generated four
 * that only need FPL data build now, and the rest slot in when the key lands.
 */
export interface Player {
  id: number;
  name: string; // display / web name
  position: Position;
  club: string; // short club name, e.g. "ARS"
  clubId: number;
  price: number; // £m (FPL now_cost / 10) — the value proxy until SportMonks
  ownership: number; // FPL selected_by_percent, 0–100 (primary fame signal)
  // current-season stats
  goals: number;
  assists: number;
  appearances: number; // starts
  minutes: number;
  points: number; // total FPL points this season
  form: number; // FPL rolling form
  available: boolean; // status === "a" (fit + likely to play)
  photoCode?: number; // FPL "code" for the headshot URL slot
  // optional — filled by the SportMonks enrichment (sportmonks.ts)
  nationality?: string;
  age?: number;
  jersey?: number; // shirt number (the "I wear number 9" clue)
  photoUrl?: string; // SportMonks headshot — the Who-am-I reveal image
  flagUrl?: string; // SportMonks nationality flag — the nationality clue image
  careerGoals?: number;
  careerClubs?: string[]; // ordered club history for Career-path (FIFA dataset)
}

/** The formats in the initial clean base + the later ones (tagged for routing). */
export type GateFormat =
  | "higher-lower"
  | "this-season-form"
  | "who-am-i"
  | "career-path"
  | "classic-trivia";

/** A comparable stat for Higher/Lower + This-season form. */
export type GateStat =
  | "price"
  | "goals"
  | "assists"
  | "appearances"
  | "points"
  | "form"
  | "age";

export interface GateOption {
  id: number; // player id
  label: string; // what the user sees
}

/**
 * One validated question instance. `answerId` is server-side truth — the serving
 * layer never sends it to the client (see the anti-cheat design). `difficulty` is
 * 0–100 (higher = harder) and drives both easy→hard serving and the budget weight.
 */
export interface GateQuestion {
  format: GateFormat;
  prompt: string;
  options: GateOption[];
  answerId: number;
  stat?: GateStat;
  difficulty: number; // 0–100
  positions: Position[]; // which position gate(s) this suits (per-position warm-up)
  /** Debug/validation context (the compared values etc.); never shown to users. */
  meta?: Record<string, string | number>;
}

/** Human labels for the stats (used in prompts). */
export const STAT_LABEL: Record<GateStat, string> = {
  price: "value",
  goals: "goals this season",
  assists: "assists this season",
  appearances: "starts this season",
  points: "fantasy points this season",
  form: "recent form",
  age: "age",
};

/** Read a numeric stat off a Player (single source of truth for both generators). */
export function statValue(p: Player, stat: GateStat): number {
  switch (stat) {
    case "price":
      return p.price;
    case "goals":
      return p.goals;
    case "assists":
      return p.assists;
    case "appearances":
      return p.appearances;
    case "points":
      return p.points;
    case "form":
      return p.form;
    case "age":
      return p.age ?? 0;
  }
}
