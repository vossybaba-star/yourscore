/**
 * 38-0 — "filler" profiles for the GLOBAL leaderboard, so a young ladder looks
 * populated (social proof). READ-LAYER ONLY: these are merged into the leaderboard
 * API response and are NEVER written to draft_standings — so they can't pollute
 * real standings, never appear on private league boards, and disappear the moment
 * you delete the merge in /api/draft/leaderboard. Records are deterministic per
 * handle (stable all-time) but the daily board varies by date so it feels alive.
 */

export type SeedRow = {
  user_id: string;
  display_name: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  rank: number;
};

// Believable, varied handles (mixed case / numbers / separators / football refs)
// so the board doesn't read as auto-generated. Stable list = stable identities.
const HANDLES = [
  "kaione", "leah_fc", "Mason99", "x_harry_x", "danny__07", "RouteOne", "zara.afc",
  "Reece_Utd", "gegenpress10", "tom__04", "amaraa", "finn_xi", "TopBins_Sam",
  "bilal92", "owen.ldn", "the_kemi", "callum7", "nina_cfc", "raheem__11",
  "jonjo23", "TackleKing", "deano_og", "mia.ftbl", "shay_88", "NutmegGod",
  "priya_ynwa", "george17", "luca__9", "ade_toon", "FalseNine", "kez21",
  "sofia_baller", "macca__06", "rico.coys", "BoxToBox_Jay", "ella98", "theo_afc",
  "WingPlay", "josh__45", "beth_xi",
];

/** Stable 0..1 hash from a string (xmur3-ish). */
function hash01(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^= h >>> 16) >>> 0) / 4294967296;
}

/**
 * Filler rows for the given board. `metric` 'all' → cumulative records (stable);
 * 'today' → smaller records that only ~55% of profiles have (varies by `dayKey`),
 * so the daily board churns like a real one. Records are capped to plausible
 * values so a real player with a handful of wins still slots in naturally.
 */
export function seedLeaderboardRows(metric: "today" | "all", dayKey: string): SeedRow[] {
  const out: SeedRow[] = [];
  for (const h of HANDLES) {
    const skill = hash01(h); // stable "how good is this profile" 0..1
    if (metric === "all") {
      const wins = 2 + Math.floor(Math.pow(skill, 1.4) * 26); // 2..28
      const draws = Math.floor(wins * (0.1 + hash01(h + "d") * 0.25));
      const losses = Math.floor(wins * (0.25 + (1 - skill) * 0.9));
      out.push({ user_id: `seed:${h}`, display_name: h, wins, draws, losses, points: wins * 3 + draws, rank: 0 });
    } else {
      const d = hash01(h + "|" + dayKey);
      if (d <= 0.45) continue; // ~55% "played today"
      const wins = Math.floor(d * (1 + skill * 7)); // 0..~7
      const draws = Math.floor(hash01(h + dayKey + "d") * 2);
      const losses = Math.floor(hash01(h + dayKey + "l") * (1 + (1 - skill) * 4));
      if (wins + draws === 0) continue; // only profiles with points today
      out.push({ user_id: `seed:${h}`, display_name: h, wins, draws, losses, points: wins * 3 + draws, rank: 0 });
    }
  }
  return out;
}
