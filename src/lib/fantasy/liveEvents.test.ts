import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSquadEvents, type SmEventFixture } from "./liveEvents";

const fixtures: SmEventFixture[] = [
  {
    events: [
      { type: { name: "Goal" }, minute: 12, player_id: 100, player_name: "Haaland", related_player_id: 200, related_player_name: "De Bruyne" },
      { type: { name: "Goal" }, minute: 34, player_id: 999, player_name: "Someone Else" }, // not in squad
      { type: { name: "Own Goal" }, minute: 40, player_id: 100, player_name: "Haaland" },  // own goals excluded
      { type: { name: "Yellowcard" }, minute: 55, player_id: 100 },                          // non-goal excluded
      { type: { name: "Goal" }, minute: 3, player_id: 200, player_name: "De Bruyne" },       // earlier minute
    ],
  },
];

test("extractSquadEvents keeps only owned players' goals + assists, sorted by minute", () => {
  const events = extractSquadEvents(fixtures, new Set([100, 200]));
  assert.deepEqual(events, [
    { minute: 3, smId: 200, name: "De Bruyne", kind: "goal" },
    { minute: 12, smId: 100, name: "Haaland", kind: "goal" },
    { minute: 12, smId: 200, name: "De Bruyne", kind: "assist" },
  ]);
});

test("extractSquadEvents ignores own goals, cards, and unowned players", () => {
  const events = extractSquadEvents(fixtures, new Set([999]));
  // 999 only appears on a plain Goal → one goal event, nothing else
  assert.deepEqual(events, [{ minute: 34, smId: 999, name: "Someone Else", kind: "goal" }]);
});

test("extractSquadEvents on empty / eventless fixtures is []", () => {
  assert.deepEqual(extractSquadEvents([], new Set([100])), []);
  assert.deepEqual(extractSquadEvents([{ events: [] }], new Set([100])), []);
  assert.deepEqual(extractSquadEvents([{}], new Set([100])), []);
});
