/**
 * 38-0 World Cup Run — run config + bracket engine (pure, deterministic).
 *
 * A solo campaign that mirrors the real WC 2026: pick a nation, draft a nation-locked
 * XI, then play your nation's real group (3 fixtures) and, if you qualify, a single-
 * elimination knockout path (R32 → R16 → QF → SF → Final). Opponents get tougher each
 * round and you earn a few squad upgrades between rounds.
 *
 * This module is PURE (no data-pool / JSON import) so it runs under `node --test`
 * alongside score.ts. The data-coupled pieces (nation-locked spin, the playable-nation
 * gate) live in pool.ts and are wired in by the API layer.
 */

import {
  WC_STAGES, WC_STAGE_LABEL, type WCStage, type WCNation,
  allWCNations, groupOpponents, wcNation,
} from "../../data/draft/wc2026";
import { seededRng } from "./score";
import type { Formation, PlacedPlayer } from "./types";
import type { SingleMatchResult } from "./live-score";

export { WC_STAGES, WC_STAGE_LABEL };
export type { WCStage, WCNation };

// ─── Run shape ──────────────────────────────────────────────────────────────
// The RUN compresses the real tournament into 5 steps:
//   group — the 3 real group games, resolved in ONE simulation (qualify on points)
//   ko    — Round of 32 + Round of 16, resolved in ONE simulation (win both to advance)
//   qf / sf / final — individual DUELS where the opponent's XI is revealed first so you
//                     can make changes before kickoff.
export type RunStage = "group" | "ko" | "qf" | "sf" | "final";
export const RUN_STAGES: RunStage[] = ["group", "ko", "qf", "sf", "final"];

// Two ways to play a run:
//   "nation" — nation-locked squad, your nation's REAL group + bracket (the original mode).
//   "world"  — open draft from ANY WC 2026 nation's players; no nation, a generated gauntlet
//              (a 3-team group, then a knockout bracket of the strongest WC nations to the Final).
export type RunMode = "nation" | "world";
/** Display name carried on a world-mode run's `nation` column (it has no real nation). */
export const WORLD_TEAM_NAME = "World XI";
export const RUN_STAGE_LABEL: Record<RunStage, string> = {
  group: "Group Stage", ko: "Round of 32 & 16", qf: "Quarter-Final", sf: "Semi-Final", final: "Final",
};
export function isDuel(stage: RunStage): boolean {
  return stage === "qf" || stage === "sf" || stage === "final";
}

// Opponent difficulty is PROPORTIONAL to your current team Strength, scaled per round.
// Weak team → weak opponents; as you upgrade and your rating climbs, theirs climbs with
// it. The multiplier also rises each round so the tournament gets tougher the deeper you go.
export const OPP_MULT: Record<WCStage, number> = {
  group: 0.94, r32: 0.97, r16: 1.0, qf: 1.03, sf: 1.06, final: 1.1,
};
export function oppTargetFor(yourStrength: number, stage: WCStage): number {
  return Math.max(40, Math.min(95, Math.round(yourStrength * OPP_MULT[stage])));
}

// Re-spin picks granted ON ENTERING a run stage. Drafting is pure luck of the spin —
// any rating can come up at any time, from your first pick onward — so an upgrade is
// just a free re-spin of a slot (it might land better or worse). Three after the group;
// two before each of QF / SF / Final.
export const STAGE_UPGRADES: Record<RunStage, number> = { group: 0, ko: 3, qf: 2, sf: 2, final: 2 };

export const GROUP_QUALIFY_POINTS = 4; // ~ a win + a draw, or two wins
export function qualifiesFromGroup(points: number): boolean {
  return points >= GROUP_QUALIFY_POINTS;
}

/** Real knockout stages in order (used to assign bracket opponents). */
export const KNOCKOUT_STAGES: WCStage[] = WC_STAGES.filter((s) => s !== "group");

// ─── Nation "prestige" (for plausible knockout opponents) ────────────────────
// Traditional powers are more likely to survive into the late rounds. This only
// biases WHICH real nation you face; the opponent's actual match Strength comes from
// the stage ramp (oppTarget), so difficulty is independent of this.
const MARQUEE = new Set<string>([
  "Brazil", "Argentina", "France", "Spain", "Germany", "England", "Portugal",
  "Netherlands", "Belgium", "Uruguay", "Croatia", "Colombia", "Morocco", "Mexico",
]);

/** A deterministic prestige weight in roughly [0.3, 1.3] from the nation name. */
export function prestige(nation: string): number {
  // Stable hash → small jitter so same-tier nations aren't perfectly tied.
  let h = 0;
  for (let i = 0; i < nation.length; i++) h = (h * 31 + nation.charCodeAt(i)) >>> 0;
  const jitter = (h % 100) / 100; // [0,1)
  return (MARQUEE.has(nation) ? 1.0 : 0.4) + jitter * 0.3;
}

// ─── Bracket plan ────────────────────────────────────────────────────────────

export type WCFixture = {
  stage: WCStage;       // the real tournament stage (for labels)
  label: string;        // e.g. "Round of 32"
  opponent: WCNation;
};

export type WCPlan = {
  group: WCFixture[];      // 3 real group opponents
  knockouts: WCFixture[];  // r32 → final, 5 plausible real opponents
};

/** Weighted pick from a list by a weight fn (seeded). Removes nothing. */
function weightedPick<T>(items: T[], weight: (t: T) => number, rng: () => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = rng() * total;
  for (const it of items) { r -= weight(it); if (r <= 0) return it; }
  return items[items.length - 1];
}

/**
 * Plan a full run for `nation`, deterministic by `seed`:
 *  - group: the nation's three REAL group opponents.
 *  - knockouts: five plausible real opponents drawn from the rest of the field,
 *    biased so stronger nations tend to survive into later rounds (prestige ^ round).
 * Each fixture carries the stage's opponent Strength target.
 */
export function planRun(nation: string, seed: string): WCPlan {
  const rng = seededRng(`${seed}:plan`);
  const groupOpp = groupOpponents(nation);
  const group: WCFixture[] = groupOpp.map((opponent) => ({
    stage: "group" as WCStage,
    label: "Group Stage",
    opponent,
  }));

  // Knockout opponent universe: everyone except you and your group (you wouldn't meet
  // a group rival again in this simplified path), drawn without replacement.
  const exclude = new Set<string>([nation, ...groupOpp.map((t) => t.nation)]);
  let pool = allWCNations().filter((t) => !exclude.has(t.nation));

  const knockouts: WCFixture[] = [];
  KNOCKOUT_STAGES.forEach((stage, i) => {
    if (pool.length === 0) return;
    // Later rounds: prestige weighted more heavily, so powers survive deeper.
    const power = 1 + i * 0.6;
    const opponent = weightedPick(pool, (t) => Math.pow(prestige(t.nation), power), rng);
    pool = pool.filter((t) => t.nation !== opponent.nation);
    knockouts.push({ stage, label: WC_STAGE_LABEL[stage], opponent });
  });

  return { group, knockouts };
}

/**
 * Plan a WORLD-mode run (open draft, no nation), deterministic by `seed`:
 *  - group: three nations from the full WC field (light prestige weighting).
 *  - knockouts: five more, prestige-weighted harder each round so powers run deep.
 * All eight opponents are distinct real WC nations. Match difficulty still comes from
 * the stage ramp (oppTargetFor), so the nation choice here is flavour, not strength.
 */
export function planWorldRun(seed: string): WCPlan {
  const rng = seededRng(`${seed}:wplan`);
  let pool = allWCNations();

  const group: WCFixture[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const opponent = weightedPick(pool, (t) => prestige(t.nation), rng);
    pool = pool.filter((t) => t.nation !== opponent.nation);
    group.push({ stage: "group", label: "Group Stage", opponent });
  }

  const knockouts: WCFixture[] = [];
  KNOCKOUT_STAGES.forEach((stage, i) => {
    if (pool.length === 0) return;
    const power = 1 + i * 0.6; // later rounds skew harder to marquee nations
    const opponent = weightedPick(pool, (t) => Math.pow(prestige(t.nation), power), rng);
    pool = pool.filter((t) => t.nation !== opponent.nation);
    knockouts.push({ stage, label: WC_STAGE_LABEL[stage], opponent });
  });

  return { group, knockouts };
}

// ─── Run state + advancement (pure — the API persists the result) ────────────

/** The mutable run state (subset of the draft_wc_runs row). */
export type WcRun = {
  id: string;
  mode: RunMode;
  nation: string;
  seed: string;
  status: "active" | "eliminated" | "champion";
  stage: RunStage;
  stage_index: number;
  formation: Formation;
  squad: PlacedPlayer[];
  strength: number;
  plan: WCPlan;
  group_played: number;
  group_points: number;
  upgrades_left: number;
};

/** The DB row to insert for a played match. */
export type WcMatchRow = {
  run_id: string;
  stage: string;
  idx: number;
  opponent_nation: string;
  opponent_crest: string | null;
  opponent_strength: number;
  you_goals: number;
  opp_goals: number;
  pens_you: number | null;
  pens_opp: number | null;
  won: boolean | null;
  detail: unknown;
};

export type WcRunPatch = Partial<Pick<WcRun,
  "status" | "stage" | "stage_index" | "group_played" | "group_points" | "upgrades_left">> & {
  resolved: boolean;
};

/** The fixtures making up the run's CURRENT stage (group = 3, ko = 2, duel = 1). */
export function gamesForStage(plan: WCPlan, stage: RunStage): WCFixture[] {
  switch (stage) {
    case "group": return plan.group;
    case "ko": return plan.knockouts.slice(0, 2);
    case "qf": return [plan.knockouts[2]];
    case "sf": return [plan.knockouts[3]];
    case "final": return [plan.knockouts[4]];
  }
}

export type GameOutcome = "win" | "loss" | "draw";

/** Build the DB row for one played game (pure). */
export function buildMatchRow(
  runId: string, stage: RunStage, fixture: WCFixture, result: SingleMatchResult, oppStrength: number, idx: number
): WcMatchRow {
  const won = result.outcome === "A" ? true : result.outcome === "B" ? false : null;
  return {
    run_id: runId,
    stage,
    idx,
    opponent_nation: fixture.opponent.nation,
    opponent_crest: wcNation(fixture.opponent.nation)?.crest ?? null,
    opponent_strength: oppStrength,
    you_goals: result.goals.a,
    opp_goals: result.goals.b,
    pens_you: result.pens?.a ?? null,
    pens_opp: result.pens?.b ?? null,
    won,
    detail: result.report,
  };
}

export function outcomeOf(result: SingleMatchResult): GameOutcome {
  return result.outcome === "A" ? "win" : result.outcome === "B" ? "loss" : "draw";
}

/** Group games allow draws (scored on points); knockouts are decisive. */
export function allowDraw(stage: RunStage): boolean {
  return stage === "group";
}

/**
 * Pure stage advancement: given the run and the outcome of EVERY game in the current
 * stage, compute the run patch (qualify / advance / eliminate / champion + the upgrades
 * granted on entering the next stage).
 *  - group: qualify on points (W=3, D=1).
 *  - ko / qf / sf / final: must win every game to advance; the final wins the trophy.
 */
export function advanceStage(run: WcRun, outcomes: GameOutcome[]): WcRunPatch {
  if (run.stage === "group") {
    const group_points = outcomes.reduce((s, o) => s + (o === "win" ? 3 : o === "draw" ? 1 : 0), 0);
    if (qualifiesFromGroup(group_points)) {
      return { group_points, group_played: 3, stage: "ko", stage_index: 1, upgrades_left: STAGE_UPGRADES.ko, resolved: false };
    }
    return { group_points, group_played: 3, status: "eliminated", resolved: true };
  }
  // Knockout stages — win them all to go through.
  const advanced = outcomes.every((o) => o === "win");
  if (!advanced) return { status: "eliminated", resolved: true };
  if (run.stage === "final") return { status: "champion", resolved: true };
  const idx = RUN_STAGES.indexOf(run.stage);
  const next = RUN_STAGES[idx + 1];
  return { stage: next, stage_index: idx + 1, upgrades_left: STAGE_UPGRADES[next], resolved: false };
}
