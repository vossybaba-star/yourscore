/**
 * Draft XI — season simulation model. THE LOGIC behind "simulate a season".
 *
 * Deterministic (seeded) so a given XI + seed always produces the same season —
 * reproducible and server-auditable. Three pieces:
 *
 *   preSeasonOdds(strength)   → the bookies' market shown BEFORE you simulate
 *                               (projected finish, expected points, finish-band %s).
 *   simulateSeason(...)       → plays 38 games vs a fixed league spread, sampling
 *                               goals from a strength-driven Poisson model, then
 *                               distributes goals/assists/clean-sheets to players.
 *   seasonNarrative(result)   → flavour headline + line for the end screen.
 *
 * The model in one line: each match's expected goals scale with the gap between
 * your attack and the opponent's defence (and vice-versa), plus home advantage;
 * goals are Poisson draws; the table position comes from a realistic points→place
 * curve. Strength comes from the same scoring engine the rest of the game uses.
 */

import type { Formation, PlacedPlayer, Projected } from "./types";
import { projectSeason, tableSlot, lineRatings, posCategory, seededRng, clamp } from "./score";

// ── A typical 19-opponent Premier League spread (the other clubs you face H&A) ──
const LEAGUE: { name: string; strength: number }[] = [
  { name: "Manchester City", strength: 87 }, { name: "Arsenal", strength: 85 },
  { name: "Liverpool", strength: 85 }, { name: "Chelsea", strength: 82 },
  { name: "Tottenham", strength: 81 }, { name: "Manchester United", strength: 80 },
  { name: "Newcastle", strength: 79 }, { name: "Aston Villa", strength: 78 },
  { name: "Brighton", strength: 77 }, { name: "West Ham", strength: 76 },
  { name: "Crystal Palace", strength: 75 }, { name: "Brentford", strength: 75 },
  { name: "Fulham", strength: 74 }, { name: "Wolves", strength: 73 },
  { name: "Everton", strength: 73 }, { name: "Nottingham Forest", strength: 72 },
  { name: "Bournemouth", strength: 72 }, { name: "Leicester City", strength: 71 },
  { name: "Ipswich Town", strength: 69 },
];

// ── Bookies' pre-season odds ──────────────────────────────────────────────────

export type PreSeasonOdds = {
  projectedFinish: number;
  expectedPoints: number;
  winLeague: number; // %
  top4: number;
  top6: number;
  top10: number;
  relegation: number;
};

/** Normal CDF via an erf approximation — turns expected points into finish-band
 *  probabilities (a believable betting market, not a real bookmaker). */
function normalCdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const sign = z < 0 ? -1 : 1;
  return 0.5 * (1 + sign * erf);
}
const pct = (p: number) => Math.round(clamp(p, 0, 1) * 1000) / 10;

export function preSeasonOdds(strength: number): PreSeasonOdds {
  const proj = projectSeason(strength);
  const mean = proj.points;
  const sd = 7.5; // season-to-season spread in points for a given quality
  // Approx PL points needed for each band (long-run).
  const pAtLeast = (threshold: number) => 1 - normalCdf(threshold, mean, sd);
  return {
    projectedFinish: proj.position,
    expectedPoints: proj.points,
    winLeague: pct(pAtLeast(89)),
    top4: pct(pAtLeast(71)),
    top6: pct(pAtLeast(64)),
    top10: pct(pAtLeast(52)),
    relegation: pct(normalCdf(35, mean, sd)),
  };
}

// ── Season simulation ─────────────────────────────────────────────────────────

export type SeasonGame = {
  opponent: string;
  venue: "H" | "A";
  gf: number;
  ga: number;
  result: "W" | "D" | "L";
};

export type PlayerStat = { name: string; goals: number; assists: number; cleanSheets: number };

export type SeasonResult = {
  wins: number;
  draws: number;
  losses: number;
  points: number;
  gf: number;
  ga: number;
  gd: number;
  position: number;
  invincible: boolean;
  projected: Projected;
  verdict: "OVERPERFORMED" | "AS EXPECTED" | "UNDERPERFORMED";
  games: SeasonGame[];
  players: PlayerStat[];
  goldenBoot: PlayerStat | null;
  playmaker: PlayerStat | null;
  goldenGlove: { name: string; cleanSheets: number } | null;
  playerOfTheSeason: PlayerStat | null;
};

/** Poisson draw via the Knuth algorithm, using the seeded RNG. */
function poisson(lambda: number, rng: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

/** Final league position from points — realistic PL points→place curve, with a
 *  tiny seeded jitter so two identical-points seasons can finish a place apart. */
function finishPosition(points: number, jitter: number): number {
  const base = clamp(Math.round(tableSlot(points) + (jitter - 0.5) * 1.5), 1, 20);
  return base;
}

export function simulateSeason(
  squad: PlacedPlayer[],
  formation: Formation,
  strength: number,
  seed: string
): SeasonResult {
  const rng = seededRng(seed);
  const lines = lineRatings(squad);
  // Overall-vs-overall drives each match (so the sim agrees with the projection);
  // the attack/defence balance only tilts goals slightly.
  const attTilt = ((lines.attack || strength) - strength) / 28;
  const defTilt = (((lines.defence || strength) + (lines.gk || strength)) / 2 - strength) / 28;

  const games: SeasonGame[] = [];
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;

  for (const venue of ["H", "A"] as const) {
    for (const opp of LEAGUE) {
      const home = venue === "H";
      const edge = (strength - opp.strength) / 9; // quality gap → goal expectation
      const lambdaFor = clamp(1.45 + edge + attTilt + (home ? 0.22 : -0.04), 0.15, 5);
      const lambdaAgainst = clamp(1.45 - edge - defTilt + (home ? -0.08 : 0.16), 0.15, 5);
      const f = poisson(lambdaFor, rng);
      const a = poisson(lambdaAgainst, rng);
      gf += f; ga += a;
      const result: SeasonGame["result"] = f > a ? "W" : f < a ? "L" : "D";
      if (result === "W") wins++; else if (result === "D") draws++; else losses++;
      games.push({ opponent: opp.name, venue, gf: f, ga: a, result });
    }
  }

  const points = wins * 3 + draws;
  const invincible = wins === 38;
  const position = invincible ? 1 : finishPosition(points, rng());
  const projected = projectSeason(strength);

  // Distribute goals & assists to players by position weighting × quality.
  const goalW = (p: PlacedPlayer) => ({ att: 1, mid: 0.4, def: 0.1, gk: 0 }[posCategory(p.slotPos)]) * (0.6 + p.overall / 100);
  const assistW = (p: PlacedPlayer) => ({ att: 0.7, mid: 1, def: 0.35, gk: 0.02 }[posCategory(p.slotPos)]) * (0.6 + p.overall / 100);
  const stats = new Map<string, PlayerStat>(squad.map((p) => [p.player_season_id, { name: p.name, goals: 0, assists: 0, cleanSheets: 0 }]));
  const weightedPick = (weight: (p: PlacedPlayer) => number) => {
    const total = squad.reduce((s, p) => s + weight(p), 0);
    if (total <= 0) return squad[0];
    let r = rng() * total;
    for (const p of squad) { r -= weight(p); if (r <= 0) return p; }
    return squad[squad.length - 1];
  };
  for (let i = 0; i < gf; i++) {
    stats.get(weightedPick(goalW).player_season_id)!.goals++;
    if (rng() < 0.75) stats.get(weightedPick(assistW).player_season_id)!.assists++; // ~75% of goals assisted
  }

  // Clean sheets → GK + the back line.
  const cleanSheetGames = games.filter((g) => g.ga === 0).length;
  for (const p of squad) {
    if (posCategory(p.slotPos) === "gk" || posCategory(p.slotPos) === "def") {
      stats.get(p.player_season_id)!.cleanSheets = cleanSheetGames;
    }
  }

  const players = Array.from(stats.values());
  const byGoals = [...players].filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals);
  const byAssists = [...players].filter((p) => p.assists > 0).sort((a, b) => b.assists - a.assists);
  const gk = squad.find((p) => posCategory(p.slotPos) === "gk");
  const byPots = [...players].sort((a, b) => (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists));

  const verdict =
    position <= projected.position - 2 ? "OVERPERFORMED" :
    position >= projected.position + 2 ? "UNDERPERFORMED" : "AS EXPECTED";

  return {
    wins, draws, losses, points, gf, ga, gd: gf - ga, position, invincible, projected, verdict, games, players,
    goldenBoot: byGoals[0] ?? null,
    playmaker: byAssists[0] ?? null,
    goldenGlove: gk ? { name: gk.name, cleanSheets: cleanSheetGames } : null,
    playerOfTheSeason: byPots[0] ?? null,
  };
}

// ── Narrative ────────────────────────────────────────────────────────────────

export function seasonNarrative(r: SeasonResult): { headline: string; body: string } {
  if (r.invincible) return { headline: "INVINCIBLE", body: `38 wins. 38 games. The impossible season — ${r.points} points and not a single defeat. They'll talk about this XI forever.` };
  if (r.position === 1) return { headline: "CHAMPIONS OF ENGLAND", body: `Top of the pile on ${r.points} points. ${r.wins} wins, ${r.losses} defeats. The title is going in the cabinet.` };
  if (r.position <= 4) return { headline: "CHAMPIONS LEAGUE NIGHTS", body: `${ordinal(r.position)} on ${r.points} points — Europe's biggest stage beckons. ${r.gf} scored, ${r.ga} conceded.` };
  if (r.position <= 7) return { headline: "EUROPEAN PUSH", body: `${ordinal(r.position)} on ${r.points} points. A continental tour secured, just short of the very top.` };
  if (r.position <= 12) return { headline: "MID-TABLE DOLDRUMS", body: `${ordinal(r.position)} on ${r.points} points. Safe, unspectacular, holiday brochures out early. ${r.losses} defeats. We take those.` };
  if (r.position <= 17) return { headline: "SURVIVAL SUNDAY", body: `${ordinal(r.position)} on ${r.points} points. Ugly at times, but they stayed up — and that's all that matters.` };
  return { headline: "RELEGATED", body: `${ordinal(r.position)} on ${r.points} points. ${r.losses} defeats. Down with a whimper — back to the drawing board.` };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
