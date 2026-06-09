import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRun, qualifiesFromGroup, prestige, advanceStage, gamesForStage, buildMatchRow, isDuel,
  OPP_MULT, oppTargetFor, UPGRADE_FLOOR, STAGE_UPGRADES, KNOCKOUT_STAGES, RUN_STAGES,
  GROUP_QUALIFY_POINTS, type WcRun,
} from "./wc";
import { groupOpponents } from "../../data/draft/wc2026";

function run(over: Partial<WcRun> = {}): WcRun {
  return {
    id: "r1", nation: "Brazil", seed: "s", status: "active", stage: "group", stage_index: 0,
    formation: "4-3-3", squad: [], strength: 80, plan: planRun("Brazil", "s"),
    group_played: 0, group_points: 0, upgrades_left: 0, ...over,
  };
}
const RES = (outcome: "A" | "B" | "draw", a: number, b: number) =>
  ({ outcome, goals: { a, b }, pens: null, report: {} as never });

test("group qualify threshold (W=3, D=1)", () => {
  assert.equal(qualifiesFromGroup(GROUP_QUALIFY_POINTS), true);
  assert.equal(qualifiesFromGroup(6), true);
  assert.equal(qualifiesFromGroup(3), false);
});

test("opponent difficulty multiplier rises every knockout round", () => {
  let prev = -Infinity;
  for (const stage of KNOCKOUT_STAGES) {
    assert.ok(OPP_MULT[stage] > prev, `${stage} ${OPP_MULT[stage]} > ${prev}`);
    prev = OPP_MULT[stage];
  }
});

test("opponent target is PROPORTIONAL to your strength, and climbs each round", () => {
  // Stronger team → stronger opponent at the same stage.
  assert.ok(oppTargetFor(90, "qf") > oppTargetFor(70, "qf"));
  // Same team → tougher opponent the deeper you go.
  assert.ok(oppTargetFor(80, "final") > oppTargetFor(80, "group"));
  // Group eases you in (below your level); final pushes above it.
  assert.ok(oppTargetFor(80, "group") < 80);
  assert.ok(oppTargetFor(80, "final") > 80);
});

test("upgrade floor rises every run stage that grants upgrades", () => {
  const stages = ["ko", "qf", "sf", "final"] as const;
  let prev = -1;
  for (const s of stages) { assert.ok(UPGRADE_FLOOR[s] > prev, `${s}`); prev = UPGRADE_FLOOR[s]; }
});

test("3 upgrades after the group, 2 before each duel", () => {
  assert.equal(STAGE_UPGRADES.ko, 3);
  assert.equal(STAGE_UPGRADES.qf, 2);
  assert.equal(STAGE_UPGRADES.sf, 2);
  assert.equal(STAGE_UPGRADES.final, 2);
});

test("planRun group fixtures ARE the nation's real group opponents", () => {
  const plan = planRun("Brazil", "run-1");
  assert.deepEqual(plan.group.map((f) => f.opponent.nation).sort(), groupOpponents("Brazil").map((t) => t.nation).sort());
});

test("gamesForStage: group=3, ko=2, duels=1 each", () => {
  const r = run();
  assert.equal(gamesForStage(r.plan, "group").length, 3);
  assert.equal(gamesForStage(r.plan, "ko").length, 2);
  assert.equal(gamesForStage(r.plan, "qf").length, 1);
  assert.equal(gamesForStage(r.plan, "sf").length, 1);
  assert.equal(gamesForStage(r.plan, "final").length, 1);
});

test("isDuel only for qf/sf/final", () => {
  assert.equal(isDuel("group"), false);
  assert.equal(isDuel("ko"), false);
  assert.equal(isDuel("qf"), true);
  assert.equal(isDuel("final"), true);
});

test("group: qualifying on points advances to ko with 3 upgrades", () => {
  const patch = advanceStage(run({ stage: "group" }), ["win", "draw", "loss"]); // 4 pts
  assert.equal(patch.group_points, 4);
  assert.equal(patch.stage, "ko");
  assert.equal(patch.stage_index, 1);
  assert.equal(patch.upgrades_left, 3);
  assert.equal(patch.resolved, false);
});

test("group: failing to qualify eliminates the run", () => {
  const patch = advanceStage(run({ stage: "group" }), ["loss", "loss", "draw"]); // 1 pt
  assert.equal(patch.status, "eliminated");
  assert.equal(patch.resolved, true);
});

test("ko (R32+R16): must win BOTH to reach the quarters", () => {
  assert.equal(advanceStage(run({ stage: "ko", stage_index: 1 }), ["win", "win"]).stage, "qf");
  assert.equal(advanceStage(run({ stage: "ko", stage_index: 1 }), ["win", "loss"]).status, "eliminated");
});

test("duels: win advances, final win = champion, loss = out", () => {
  assert.equal(advanceStage(run({ stage: "qf", stage_index: 2 }), ["win"]).stage, "sf");
  assert.equal(advanceStage(run({ stage: "sf", stage_index: 3 }), ["win"]).stage, "final");
  assert.equal(advanceStage(run({ stage: "final", stage_index: 4 }), ["win"]).status, "champion");
  assert.equal(advanceStage(run({ stage: "qf", stage_index: 2 }), ["loss"]).status, "eliminated");
});

test("buildMatchRow records the scoreline + opponent", () => {
  const f = gamesForStage(run().plan, "group")[0];
  const row = buildMatchRow("r1", "group", f, RES("A", 3, 1), 70, 0);
  assert.equal(row.you_goals, 3);
  assert.equal(row.opp_goals, 1);
  assert.equal(row.won, true);
  assert.equal(row.opponent_nation, f.opponent.nation);
});

test("RUN_STAGES order", () => {
  assert.deepEqual(RUN_STAGES, ["group", "ko", "qf", "sf", "final"]);
});

test("prestige favours traditional powers over minnows", () => {
  assert.ok(prestige("Brazil") > prestige("New Zealand"));
});

test("planRun deterministic by seed, varies across seeds", () => {
  const a = planRun("France", "A").knockouts.map((f) => f.opponent.nation);
  const b = planRun("France", "A").knockouts.map((f) => f.opponent.nation);
  const c = planRun("France", "B").knockouts.map((f) => f.opponent.nation);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("final opponent skews to marquee nations across many runs", () => {
  const MARQUEE = new Set(["Brazil", "Argentina", "France", "Spain", "Germany", "England", "Portugal", "Netherlands", "Belgium", "Uruguay", "Croatia", "Colombia", "Morocco", "Mexico"]);
  let marquee = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    const ko = planRun("Scotland", `s${i}`).knockouts;
    if (MARQUEE.has(ko[ko.length - 1].opponent.nation)) marquee++;
  }
  assert.ok(marquee / N > 0.6, `marquee rate ${(marquee / N).toFixed(2)}`);
});
