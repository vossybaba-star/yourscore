#!/usr/bin/env node --test
/**
 * poller.test.mjs — the drift guard.
 *
 * There are TWO classifiers deciding what "half time" means: the one in
 * src/lib/halftime/shared.ts (which the Vercel watchdog uses) and the one in
 * poller.mjs (which the VPS daemon uses). They live in different languages, in
 * different processes, on different machines. If they ever disagree, the two
 * halves of this system disagree about the only event the feature exists for —
 * and the disagreement would show up at 15:47 on a Saturday, not in CI.
 *
 * So this test imports BOTH — the real .ts, via Node's type stripping, and the
 * real .mjs — and drives them through every one of the 25 states in the LIVE
 * SportMonks catalogue (scenarios/states.json, pulled from the API, not
 * invented). Any divergence, and any state either file names that SportMonks
 * does not actually have, fails here.
 *
 *   node --test scripts/halftime/poller.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const shared = await import(join(HERE, "..", "..", "src", "lib", "halftime", "shared.ts"));
const poller = await import(join(HERE, "poller.mjs"));

const STATES = JSON.parse(readFileSync(join(HERE, "scenarios", "states.json"), "utf8"));
const NAMES = new Set(STATES.map((s) => s.developer_name));

test("the live catalogue still says half time is state_id 3", () => {
  const ht = STATES.find((s) => s.developer_name === "HT");
  assert.ok(ht, "no HT state in the catalogue");
  assert.equal(Number(ht.id), 3);
  assert.equal(shared.HALFTIME_STATE_ID, 3);
  assert.equal(poller.HALFTIME_STATE_ID, 3);
});

test("poller and watchdog classify all 25 live states identically", () => {
  const diffs = [];
  for (const s of STATES) {
    const a = shared.classifyPhase(Number(s.id), s.developer_name);
    const b = poller.classifyPhase(Number(s.id), s.developer_name);
    if (a !== b) diffs.push(`${s.id} ${s.developer_name}: shared=${a} poller=${b}`);
  }
  assert.deepEqual(diffs, [], `classifiers disagree:\n  ${diffs.join("\n  ")}`);
});

test("half time — and only half time — releases a pack", () => {
  for (const s of STATES) {
    const phase = poller.classifyPhase(Number(s.id), s.developer_name);
    if (s.developer_name === "HT") assert.equal(phase, "halftime");
    else assert.notEqual(phase, "halftime", `${s.developer_name} must not read as half time`);
  }
});

test("the states that must cancel a fixture do", () => {
  for (const name of ["POSTPONED", "CANCELLED", "ABANDONED", "WO", "AWARDED", "DELETED"]) {
    const s = STATES.find((x) => x.developer_name === name);
    if (!s) continue; // not every one is in the catalogue
    assert.equal(poller.classifyPhase(Number(s.id), name), "abnormal", name);
  }
});

test("the second half — however it is reached — is a LATE release, never a normal one", () => {
  for (const name of ["INPLAY_2ND_HALF", "FT", "AET", "FT_PEN", "BREAK", "INPLAY_ET_SECOND_HALF"]) {
    const s = STATES.find((x) => x.developer_name === name);
    if (!s) continue;
    assert.equal(poller.classifyPhase(Number(s.id), name), "past_halftime", name);
  }
});

test("a resumable stoppage means DO NOTHING, not cancel", () => {
  // A suspended or interrupted match can restart. Cancelling it would destroy a
  // pack that is about to be perfectly playable.
  for (const name of ["SUSPENDED", "INTERRUPTED", "DELAYED", "AWAITING_UPDATES"]) {
    const s = STATES.find((x) => x.developer_name === name);
    if (!s) continue;
    const phase = poller.classifyPhase(Number(s.id), name);
    assert.equal(phase, "unknown", `${name} → ${phase}`);
  }
});

test("an unknown future state is inert — it can never release or cancel", () => {
  const phase = poller.classifyPhase(9999, "SOME_STATE_SPORTMONKS_ADDS_IN_2027");
  assert.equal(phase, "unknown");
});

// REGRESSION (was "KNOWN DEFECT", fixed at integration).
//
// shared.ts named two states SportMonks does not have: "INPLAY_ET_2ND_HALF"
// (real name: INPLAY_ET_SECOND_HALF, id 23) and "AWAITING_PENALTIES" (no such
// state). A name the code fails to recognise classifies as "unknown", and
// "unknown" means take no action — so the defect was silent everywhere.
//
// The original tripwire here could never have gone green: it only checked the
// two ghost names against the catalogue, and never read shared.ts at all, so it
// failed identically before and after a fix. It now asserts the real thing —
// every name shared.ts actually classifies must exist in the live catalogue.
test("shared.ts names no state that SportMonks does not have", () => {
  const bogus = shared.CLASSIFIED_STATE_NAMES.filter((n) => !NAMES.has(n));
  assert.deepEqual(
    bogus,
    [],
    `src/lib/halftime/shared.ts classifies ${bogus.join(", ")}, absent from GET /v3/football/states`,
  );
});

test("every state the poller DOES name exists in the live catalogue", () => {
  const named = [
    ...poller.PRE_NAMES, ...poller.ABNORMAL_NAMES, ...poller.PAST_HALFTIME_NAMES,
    "HT", "INPLAY_1ST_HALF",
  ];
  const bogus = named.filter((n) => !NAMES.has(n));
  assert.deepEqual(bogus, [], `poller names states that do not exist: ${bogus.join(", ")}`);
});

// The whole point of two classifiers is that they must never disagree.
test("both classifiers agree on all 25 live states", () => {
  const disagreements = STATES.filter(
    (s) =>
      shared.classifyPhase(Number(s.id), s.developer_name) !==
      poller.classifyPhase(Number(s.id), s.developer_name),
  ).map((s) => s.developer_name);
  assert.deepEqual(disagreements, [], `classifiers disagree on: ${disagreements.join(", ")}`);
});
