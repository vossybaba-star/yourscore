/**
 * Draft XI — season simulation model. THE LOGIC behind "simulate a season".
 *
 * Everything is derived from FIFA data. The opponents are the real FC26 Premier
 * League clubs (strength = mean overall of each club's best XI, computed in
 * build-dataset.mjs); there are no hand-made ratings or points curves here.
 *
 *   preSeasonOdds(...)  → the bookies' market (expected points, projected finish,
 *                          finish-band %s) — a Monte-Carlo of the same sim.
 *   simulateSeason(...) → plays 38 games vs the real clubs (Poisson goals driven
 *                          by the FIFA strength gap), then ranks the points against
 *                          the clubs' expected points to get the table position.
 *   seasonNarrative(...) → flavour for the end screen.
 *
 * Deterministic given a seed, so results are reproducible/auditable.
 */

import type { Formation, League, PlacedPlayer, Projected } from "./types";
import { LEAGUE_META } from "./types";
import { lineRatings, posCategory, seededRng, clamp, tierFor } from "./score";
import { matchLambdas, type TeamLines } from "./match";

export type Opponent = { name: string; strength: number };

// ── Match model ──────────────────────────────────────────────────────────────

function poissonPmf(lambda: number, k: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/** A real club is modelled as a flat XI — every line sits at its scalar Strength.
 *  The shared engine then derives goals from my attack line vs the club's defence. */
function clubLines(strength: number): TeamLines {
  return { attack: strength, midfield: strength, defence: strength, gk: strength };
}

/** Closed-form expected league points for an XI (its line ratings) vs `opponents`
 *  (home + away), summing match win/draw probabilities over the canonical Poisson λ. */
function expectedPoints(myLines: TeamLines, opponents: Opponent[]): number {
  let pts = 0;
  for (const o of opponents) {
    for (const home of ["A", "B"] as const) {
      const [lf, la] = matchLambdas(myLines, clubLines(o.strength), { home });
      let w = 0, d = 0;
      for (let i = 0; i <= 9; i++) for (let j = 0; j <= 9; j++) {
        const p = poissonPmf(lf, i) * poissonPmf(la, j);
        if (i > j) w += p; else if (i === j) d += p;
      }
      pts += 3 * w + d;
    }
  }
  return pts;
}

/** Each club's "par" points (expected points vs the rest of the league). */
function leaguePar(opponents: Opponent[]): number[] {
  return opponents.map((c) => expectedPoints(clubLines(c.strength), opponents.filter((o) => o !== c)));
}

/** League position for a points total: 1 + how many clubs are expected to finish above it. */
function positionFor(points: number, par: number[]): number {
  return clamp(1 + par.filter((p) => p > points).length, 1, par.length + 1);
}

// ── Bookies' pre-season odds (Monte-Carlo of the sim) ────────────────────────

export type PreSeasonOdds = {
  projectedFinish: number;
  expectedPoints: number;
  winLeague: number; top4: number; top6: number; top10: number; relegation: number;
};

const pct = (n: number, total: number) => Math.round((n / total) * 1000) / 10;

export function preSeasonOdds(squad: PlacedPlayer[], strength: number, opponents: Opponent[]): PreSeasonOdds {
  const myLines = lineRatings(squad);
  const par = leaguePar(opponents);
  const expPts = Math.round(expectedPoints(myLines, opponents));

  const N = 300;
  let win = 0, t4 = 0, t6 = 0, t10 = 0, rel = 0;
  for (let i = 0; i < N; i++) {
    const rng = seededRng(`odds-${strength}-${i}`);
    const pts = samplePoints(myLines, opponents, rng);
    const pos = positionFor(pts, par);
    if (pos === 1) win++;
    if (pos <= 4) t4++;
    if (pos <= 6) t6++;
    if (pos <= 10) t10++;
    if (pos >= 18) rel++;
  }
  return {
    projectedFinish: positionFor(expPts, par),
    expectedPoints: expPts,
    winLeague: pct(win, N), top4: pct(t4, N), top6: pct(t6, N), top10: pct(t10, N), relegation: pct(rel, N),
  };
}

// ── Season simulation ─────────────────────────────────────────────────────────

export type SeasonGame = { opponent: string; venue: "H" | "A"; gf: number; ga: number; result: "W" | "D" | "L" };
export type PlayerStat = { name: string; goals: number; assists: number; cleanSheets: number };

export type SeasonResult = {
  wins: number; draws: number; losses: number; points: number; gf: number; ga: number; gd: number;
  position: number; invincible: boolean; projected: Projected;
  verdict: "OVERPERFORMED" | "AS EXPECTED" | "UNDERPERFORMED";
  games: SeasonGame[]; players: PlayerStat[];
  goldenBoot: PlayerStat | null; playmaker: PlayerStat | null;
  goldenGlove: { name: string; cleanSheets: number } | null; playerOfTheSeason: PlayerStat | null;
};

function poisson(lambda: number, rng: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

/** Lightweight points-only sample (for Monte-Carlo odds). */
function samplePoints(myLines: TeamLines, opponents: Opponent[], rng: () => number): number {
  let pts = 0;
  for (const home of ["A", "B"] as const) for (const o of opponents) {
    const [lf, la] = matchLambdas(myLines, clubLines(o.strength), { home });
    const f = poisson(lf, rng), a = poisson(la, rng);
    pts += f > a ? 3 : f === a ? 1 : 0;
  }
  return pts;
}

export function simulateSeason(
  squad: PlacedPlayer[], formation: Formation, strength: number, seed: string, opponents: Opponent[]
): SeasonResult {
  const rng = seededRng(seed);
  const myLines = lineRatings(squad);
  const par = leaguePar(opponents);

  const games: SeasonGame[] = [];
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
  for (const venue of ["H", "A"] as const) {
    for (const o of opponents) {
      const [lf, la] = matchLambdas(myLines, clubLines(o.strength), { home: venue === "H" ? "A" : "B" });
      const f = poisson(lf, rng), a = poisson(la, rng);
      gf += f; ga += a;
      const result: SeasonGame["result"] = f > a ? "W" : f < a ? "L" : "D";
      if (result === "W") wins++; else if (result === "D") draws++; else losses++;
      games.push({ opponent: o.name, venue, gf: f, ga: a, result });
    }
  }

  const points = wins * 3 + draws;
  const invincible = losses === 0 && draws === 0;
  const position = invincible ? 1 : positionFor(points, par);

  const expPts = Math.round(expectedPoints(myLines, opponents));
  const projFinish = positionFor(expPts, par);
  const projected: Projected = {
    wins: 0, draws: 0, losses: 0, points: expPts, position: projFinish, tier: tierFor(expPts),
  };

  // Distribute goals/assists/clean sheets to players.
  const goalW = (p: PlacedPlayer) => ({ att: 1, mid: 0.4, def: 0.1, gk: 0 }[posCategory(p.slotPos)]) * (0.6 + p.overall / 100);
  const assistW = (p: PlacedPlayer) => ({ att: 0.7, mid: 1, def: 0.35, gk: 0.02 }[posCategory(p.slotPos)]) * (0.6 + p.overall / 100);
  const stats = new Map<string, PlayerStat>(squad.map((p) => [p.player_season_id, { name: p.name, goals: 0, assists: 0, cleanSheets: 0 }]));
  const pick = (weight: (p: PlacedPlayer) => number) => {
    const total = squad.reduce((s, p) => s + weight(p), 0);
    if (total <= 0) return squad[0];
    let r = rng() * total;
    for (const p of squad) { r -= weight(p); if (r <= 0) return p; }
    return squad[squad.length - 1];
  };
  for (let i = 0; i < gf; i++) {
    stats.get(pick(goalW).player_season_id)!.goals++;
    if (rng() < 0.75) stats.get(pick(assistW).player_season_id)!.assists++;
  }
  const cleanSheets = games.filter((g) => g.ga === 0).length;
  for (const p of squad) {
    if (posCategory(p.slotPos) === "gk" || posCategory(p.slotPos) === "def") stats.get(p.player_season_id)!.cleanSheets = cleanSheets;
  }

  const players = Array.from(stats.values());
  const byGoals = [...players].filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals);
  const byAssists = [...players].filter((p) => p.assists > 0).sort((a, b) => b.assists - a.assists);
  const gk = squad.find((p) => posCategory(p.slotPos) === "gk");
  const byPots = [...players].sort((a, b) => (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists));

  const verdict =
    position <= projFinish - 2 ? "OVERPERFORMED" :
    position >= projFinish + 2 ? "UNDERPERFORMED" : "AS EXPECTED";

  return {
    wins, draws, losses, points, gf, ga, gd: gf - ga, position, invincible, projected, verdict, games, players,
    goldenBoot: byGoals[0] ?? null, playmaker: byAssists[0] ?? null,
    goldenGlove: gk ? { name: gk.name, cleanSheets } : null, playerOfTheSeason: byPots[0] ?? null,
  };
}

// ── Narrative ────────────────────────────────────────────────────────────────

export function seasonNarrative(r: SeasonResult, league: League = "PL"): { headline: string; body: string } {
  const country = LEAGUE_META[league].country.toUpperCase();
  if (r.invincible) return { headline: "INVINCIBLE", body: `38 wins, 38 games — the impossible season. ${r.points} points, unbeaten. They'll talk about this XI forever.` };
  if (r.position === 1) return { headline: `CHAMPIONS OF ${country}`, body: `Top of the pile on ${r.points} points. ${r.wins} wins, ${r.losses} defeats. The title is in the cabinet.` };
  if (r.position <= 4) return { headline: "CHAMPIONS LEAGUE NIGHTS", body: `${ordinal(r.position)} on ${r.points} points — Europe's biggest stage beckons. ${r.gf} scored, ${r.ga} conceded.` };
  if (r.position <= 7) return { headline: "EUROPEAN PUSH", body: `${ordinal(r.position)} on ${r.points} points. A continental tour secured, just short of the very top.` };
  if (r.position <= 12) return { headline: "MID-TABLE", body: `${ordinal(r.position)} on ${r.points} points. Safe and unspectacular — ${r.losses} defeats. We take those.` };
  if (r.position <= 17) return { headline: "SURVIVAL", body: `${ordinal(r.position)} on ${r.points} points. Ugly at times, but they stayed up — and that's all that matters.` };
  return { headline: "RELEGATED", body: `${ordinal(r.position)} on ${r.points} points, ${r.losses} defeats. Down with a whimper — back to the drawing board.` };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
