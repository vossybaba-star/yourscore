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

// ─── Per-stage config (tunable after playtesting) ───────────────────────────
// `oppTarget` is the bot's target Strength for that round (the difficulty ramp).
// `upgrades` is how many upgrade picks you're granted ENTERING that stage.
// `upgradeFloor` is the minimum overall of candidates an upgrade pick deals.
export type WCStageConfig = {
  stage: WCStage;
  oppTarget: number;
  upgrades: number;
  upgradeFloor: number;
};

export const WC_RUN: WCStageConfig[] = [
  { stage: "group", oppTarget: 72, upgrades: 0, upgradeFloor: 0 },
  { stage: "r32", oppTarget: 76, upgrades: 1, upgradeFloor: 80 },
  { stage: "r16", oppTarget: 79, upgrades: 1, upgradeFloor: 82 },
  { stage: "qf", oppTarget: 82, upgrades: 2, upgradeFloor: 84 },
  { stage: "sf", oppTarget: 85, upgrades: 2, upgradeFloor: 86 },
  { stage: "final", oppTarget: 88, upgrades: 2, upgradeFloor: 88 },
];

const CONFIG_BY_STAGE = new Map(WC_RUN.map((c) => [c.stage, c]));
export function stageConfig(stage: WCStage): WCStageConfig {
  return CONFIG_BY_STAGE.get(stage)!;
}

/** Group games to play, and the points needed to qualify (W=3, D=1). */
export const GROUP_GAMES = 3;
export const GROUP_QUALIFY_POINTS = 4; // ~ a win + a draw, or two wins

export function qualifiesFromGroup(points: number): boolean {
  return points >= GROUP_QUALIFY_POINTS;
}

/** The knockout stages in order (everything after the group). */
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
  stage: WCStage;
  opponent: WCNation;
  oppTarget: number;
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
    opponent,
    oppTarget: stageConfig("group").oppTarget,
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
    knockouts.push({ stage, opponent, oppTarget: stageConfig(stage).oppTarget });
  });

  return { group, knockouts };
}

// ─── Run state + advancement (pure — the API persists the result) ────────────

/** The mutable run state (subset of the draft_wc_runs row). */
export type WcRun = {
  id: string;
  nation: string;
  seed: string;
  status: "active" | "eliminated" | "champion";
  stage: WCStage;
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

/** The fixture the run should play right now, or null if the run is over. */
export function currentFixture(run: WcRun): (WCFixture & { idx: number; allowDraw: boolean }) | null {
  if (run.status !== "active") return null;
  if (run.stage === "group") {
    const f = run.plan.group[run.group_played];
    if (!f) return null;
    return { ...f, idx: run.group_played, allowDraw: true };
  }
  const f = run.plan.knockouts[run.stage_index - 1];
  if (!f) return null;
  return { ...f, idx: 0, allowDraw: false };
}

/**
 * Pure advancement: given the run, the fixture played, and the result, compute the
 * match row to store and the patch to the run (next stage / elimination / trophy).
 * `won` is from the YOU (side "A") perspective; knockouts never draw (resolveMatch
 * settles on pens when allowDraw is false).
 */
export function applyResult(
  run: WcRun,
  fixture: WCFixture & { idx: number; allowDraw: boolean },
  result: SingleMatchResult,
  oppStrength: number
): { match: WcMatchRow; patch: WcRunPatch } {
  const won = result.outcome === "A" ? true : result.outcome === "B" ? false : null;
  const match: WcMatchRow = {
    run_id: run.id,
    stage: fixture.stage,
    idx: fixture.idx,
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

  if (run.stage === "group") {
    const group_points = run.group_points + (won === true ? 3 : won === null ? 1 : 0);
    const group_played = run.group_played + 1;
    if (group_played < 3) {
      return { match, patch: { group_points, group_played, resolved: false } };
    }
    if (qualifiesFromGroup(group_points)) {
      return {
        match,
        patch: {
          group_points, group_played,
          stage: "r32", stage_index: 1,
          upgrades_left: stageConfig("r32").upgrades,
          resolved: false,
        },
      };
    }
    return { match, patch: { group_points, group_played, status: "eliminated", resolved: true } };
  }

  // Knockout: decisive. Win advances; the final wins the trophy; a loss ends the run.
  if (won) {
    if (run.stage === "final") {
      return { match, patch: { status: "champion", resolved: true } };
    }
    const nextIndex = run.stage_index + 1;
    const nextStage = KNOCKOUT_STAGES[nextIndex - 1];
    return {
      match,
      patch: { stage: nextStage, stage_index: nextIndex, upgrades_left: stageConfig(nextStage).upgrades, resolved: false },
    };
  }
  return { match, patch: { status: "eliminated", resolved: true } };
}
