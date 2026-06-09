import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRun, qualifiesFromGroup, stageConfig, prestige, applyResult, currentFixture,
  WC_RUN, KNOCKOUT_STAGES, GROUP_QUALIFY_POINTS, type WcRun, type WCStage,
} from "./wc";
import { groupOpponents } from "../../data/draft/wc2026";

// Minimal run/fixture/result builders for advancement tests.
function run(over: Partial<WcRun> = {}): WcRun {
  return {
    id: "r1", nation: "Brazil", seed: "s", status: "active", stage: "group", stage_index: 0,
    formation: "4-3-3", squad: [], strength: 80, plan: planRun("Brazil", "s"),
    group_played: 0, group_points: 0, upgrades_left: 0, ...over,
  };
}
function fixture(stage: WCStage, allowDraw: boolean, idx = 0) {
  return { stage, opponent: { nation: "France", abbr: "FRA", crest: "" }, oppTarget: 80, idx, allowDraw };
}
const RES = {
  win: { outcome: "A" as const, goals: { a: 2, b: 0 }, pens: null, report: {} as never },
  draw: { outcome: "draw" as const, goals: { a: 1, b: 1 }, pens: null, report: {} as never },
  loss: { outcome: "B" as const, goals: { a: 0, b: 1 }, pens: null, report: {} as never },
};

test("group qualify threshold (W=3, D=1)", () => {
  assert.equal(qualifiesFromGroup(GROUP_QUALIFY_POINTS), true);
  assert.equal(qualifiesFromGroup(6), true); // two wins
  assert.equal(qualifiesFromGroup(3), false); // one win only
  assert.equal(qualifiesFromGroup(0), false);
});

test("opponent Strength target rises every knockout round", () => {
  let prev = -Infinity;
  for (const stage of KNOCKOUT_STAGES) {
    const t = stageConfig(stage).oppTarget;
    assert.ok(t > prev, `${stage} target ${t} should exceed previous ${prev}`);
    prev = t;
  }
});

test("upgrade floor never decreases as the run goes deeper", () => {
  let prev = -1;
  for (const c of WC_RUN) { assert.ok(c.upgradeFloor >= prev); prev = c.upgradeFloor; }
});

test("planRun group fixtures ARE the nation's real group opponents", () => {
  const plan = planRun("Brazil", "run-1");
  const real = groupOpponents("Brazil").map((t) => t.nation).sort();
  const planned = plan.group.map((f) => f.opponent.nation).sort();
  assert.deepEqual(planned, real);
  assert.equal(plan.group.length, 3);
});

test("planRun yields 5 distinct knockout opponents, none = you or a group rival", () => {
  const plan = planRun("England", "run-xyz");
  assert.equal(plan.knockouts.length, 5);
  const names = plan.knockouts.map((f) => f.opponent.nation);
  assert.equal(new Set(names).size, 5, "opponents are distinct");
  const banned = new Set(["England", ...groupOpponents("England").map((t) => t.nation)]);
  for (const n of names) assert.ok(!banned.has(n), `${n} should not appear`);
});

test("planRun is deterministic for a given seed, varies by seed", () => {
  const a = planRun("France", "seed-A");
  const b = planRun("France", "seed-A");
  const c = planRun("France", "seed-B");
  assert.deepEqual(a.knockouts.map((f) => f.opponent.nation), b.knockouts.map((f) => f.opponent.nation));
  // Different seed should (almost surely) change the path.
  assert.notDeepEqual(a.knockouts.map((f) => f.opponent.nation), c.knockouts.map((f) => f.opponent.nation));
});

test("knockout fixtures carry the rising stage targets", () => {
  const plan = planRun("Spain", "seed-1");
  for (const f of plan.knockouts) assert.equal(f.oppTarget, stageConfig(f.stage).oppTarget);
});

test("prestige favours traditional powers over minnows", () => {
  assert.ok(prestige("Brazil") > prestige("New Zealand"));
  assert.ok(prestige("France") > prestige("Curaçao"));
});

test("group win adds 3 pts and advances the game counter (not resolved yet)", () => {
  const { patch } = applyResult(run(), fixture("group", true, 0), RES.win, 80);
  assert.equal(patch.group_points, 3);
  assert.equal(patch.group_played, 1);
  assert.equal(patch.resolved, false);
  assert.equal(patch.status, undefined);
});

test("group: 3rd game that reaches the threshold qualifies into R32 with upgrades", () => {
  const r = run({ stage: "group", group_played: 2, group_points: 3 }); // a win + this draw = 4
  const { patch } = applyResult(r, fixture("group", true, 2), RES.draw, 80);
  assert.equal(patch.group_points, 4);
  assert.equal(patch.stage, "r32");
  assert.equal(patch.stage_index, 1);
  assert.equal(patch.upgrades_left, stageConfig("r32").upgrades);
  assert.equal(patch.resolved, false);
});

test("group: failing to qualify eliminates the run", () => {
  const r = run({ stage: "group", group_played: 2, group_points: 0 });
  const { patch } = applyResult(r, fixture("group", true, 2), RES.loss, 80);
  assert.equal(patch.status, "eliminated");
  assert.equal(patch.resolved, true);
});

test("knockout win advances to the next stage with that stage's upgrades", () => {
  const r = run({ stage: "r32", stage_index: 1 });
  const { patch } = applyResult(r, fixture("r32", false), RES.win, 82);
  assert.equal(patch.stage, "r16");
  assert.equal(patch.stage_index, 2);
  assert.equal(patch.upgrades_left, stageConfig("r16").upgrades);
  assert.equal(patch.resolved, false);
});

test("winning the final crowns a champion", () => {
  const r = run({ stage: "final", stage_index: 5 });
  const { patch } = applyResult(r, fixture("final", false), RES.win, 88);
  assert.equal(patch.status, "champion");
  assert.equal(patch.resolved, true);
});

test("a knockout loss ends the run", () => {
  const r = run({ stage: "qf", stage_index: 3 });
  const { patch } = applyResult(r, fixture("qf", false), RES.loss, 84);
  assert.equal(patch.status, "eliminated");
  assert.equal(patch.resolved, true);
});

test("the match row records the scoreline + opponent for the reveal/share", () => {
  const { match } = applyResult(run(), fixture("group", true, 0), RES.win, 80);
  assert.equal(match.opponent_nation, "France");
  assert.equal(match.you_goals, 2);
  assert.equal(match.opp_goals, 0);
  assert.equal(match.won, true);
});

test("currentFixture: group then knockouts, null when the run is over", () => {
  assert.equal(currentFixture(run())!.stage, "group");
  assert.equal(currentFixture(run({ stage: "r16", stage_index: 2 }))!.stage, "r16");
  assert.equal(currentFixture(run({ status: "champion" })), null);
  assert.equal(currentFixture(run({ status: "eliminated" })), null);
});

test("final opponent skews to marquee nations across many runs", () => {
  const MARQUEE = new Set(["Brazil", "Argentina", "France", "Spain", "Germany", "England", "Portugal", "Netherlands", "Belgium", "Uruguay", "Croatia", "Colombia", "Morocco", "Mexico"]);
  let marquee = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    const plan = planRun("Scotland", `s${i}`);
    const finalOpp = plan.knockouts[plan.knockouts.length - 1].opponent.nation;
    if (MARQUEE.has(finalOpp)) marquee++;
  }
  // With prestige^ (1+4*0.6)=^3.4 weighting in the final, powers should dominate.
  assert.ok(marquee / N > 0.6, `marquee final-opponent rate ${(marquee / N).toFixed(2)} should exceed 0.6`);
});
