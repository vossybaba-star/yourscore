/**
 * One club, two id spaces, and a name that never quite matches.
 *
 * The fixture ticker comes from SportMonks ("Tottenham Hotspur", participant id
 * 6); the player pool comes from FPL ("Spurs", team id 19). Both id spaces are
 * small integers in the same range, so joining on id does not fail — it silently
 * returns the wrong club. This is the join key instead.
 *
 * Pure, and deliberately free of `server-only`, so the plain tsc test harness can
 * cover it (same reasoning as months.ts).
 */

/** Names that don't survive normalisation on their own. Keyed on the NORMALISED
 *  form, mapping the long official name onto the short one the pool uses. */
const CLUB_ALIASES: Record<string, string> = {
  tottenhamhotspur: "spurs",
  tottenham: "spurs", // the common short form a screenshot/vision read gives

  manchestercity: "mancity",
  manchesterunited: "manutd",
  newcastleunited: "newcastle",
  afcbournemouth: "bournemouth",
  nottinghamforest: "nottmforest",
  leedsunited: "leeds",
  brightonandhovealbion: "brighton",
  // Not in the league this season, but promotion is annual and a missing alias
  // takes the whole ticker down by design.
  wolverhamptonwanderers: "wolves",
  westhamunited: "westham",
  leicestercity: "leicester",
  sheffieldunited: "sheffutd",
  burnleyfc: "burnley",
};

export function clubKey(name: string): string {
  const flat = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  return CLUB_ALIASES[flat] ?? flat;
}
