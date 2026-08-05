import { test } from "node:test";
import assert from "node:assert/strict";
import { clubsInHeadline, isSameSaga } from "./clubNews";
import { entitiesOf } from "./briefing";

test("a headline maps to the clubs it actually names", () => {
  assert.deepEqual(clubsInHeadline("Arsenal agree £75m fee with Newcastle for Guimaraes"),
    ["Arsenal", "Newcastle United"]);
  assert.deepEqual(clubsInHeadline("Man Utd react to approaches for Sesko"), ["Manchester United"]);
  assert.deepEqual(clubsInHeadline("Fifa opens disciplinary proceedings"), []);
});

test("short forms count, because no desk writes the formal name", () => {
  assert.deepEqual(clubsInHeadline("Spurs close in on signing"), ["Tottenham Hotspur"]);
  assert.deepEqual(clubsInHeadline("Cherries hit 10 past Genoa"), ["AFC Bournemouth"]);
});

test("the same saga in a new headline is recognised", () => {
  // The three that would otherwise have gone out as separate pushes.
  const a = entitiesOf("Arsenal agree £75m fee with Newcastle for Bruno Guimaraes");
  const b = entitiesOf("Why are Arsenal signing Newcastle captain Guimaraes?");
  assert.equal(isSameSaga(a, b), true);
});

test("sharing only the club name is NOT the same saga", () => {
  // Otherwise one Arsenal story would suppress every other Arsenal story.
  const a = entitiesOf("Arsenal agree fee with Newcastle for Guimaraes");
  const b = entitiesOf("Arsenal confirm Vinicius Jr contract talks");
  assert.equal(isSameSaga(a, b), false);
});
