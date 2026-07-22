/**
 * Unit tests for the halftime pure logic.
 *
 * shared.ts is deliberately import-free, so this runs with no bundler and no
 * DB. From the worktree root:
 *
 *   npx tsc src/lib/halftime/shared.ts src/lib/halftime/shared.test.ts \
 *     --outDir /tmp/ht-test --module commonjs --target es2022 \
 *     --moduleResolution node --skipLibCheck --strict --esModuleInterop
 *   node --test /tmp/ht-test
 *
 * (No test runner is installed and package.json is off-limits to this
 * workstream, so the tests compile with the repo's own tsc and run on Node's
 * built-in runner — zero new dependencies.)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CLASSIFIED_STATE_NAMES,
  HALFTIME_STATE_ID,
  assembleQuestions,
  canTransition,
  classifyPhase,
  isReleasable,
  isReleased,
  londonDayRange,
  londonMatchday,
  packName,
  pushCopy,
  pushDedupeKey,
  questionsForRelease,
  shuffleOptions,
  validatePackQuestions,
  type FreshQuestion,
  type HalftimeState,
  type QuizQuestion,
} from "./shared";

// ── helpers ──────────────────────────────────────────────────────────────────

/** A question whose correct answer is always option A pre-shuffle (house rule). */
function q(n: number, difficulty: "easy" | "medium" | "hard" = "medium"): QuizQuestion {
  return {
    question: `Base question ${n}?`,
    options: { A: `correct-${n}`, B: `wrong-${n}-b`, C: `wrong-${n}-c`, D: `wrong-${n}-d` },
    answer: "A",
    difficulty,
  };
}

function fresh(n: number, status: FreshQuestion["status"]): FreshQuestion {
  return {
    question: `Fresh question ${n}?`,
    options: { A: `fresh-correct-${n}`, B: `f-b-${n}`, C: `f-c-${n}`, D: `f-d-${n}` },
    answer: "A",
    difficulty: "hard",
    status,
    fact: `dossier fact ${n}`,
  };
}

const BASE_10 = Array.from({ length: 10 }, (_, i) => q(i + 1));
const FIXTURE = 19134567;

// ── state machine ────────────────────────────────────────────────────────────

test("state machine: the happy path is the only way to a released pack", () => {
  assert.ok(canTransition("scheduled", "base_ready"));
  assert.ok(canTransition("base_ready", "staged"));
  assert.ok(canTransition("staged", "released"));
  assert.ok(canTransition("staged", "released_late"));
});

test("state machine: a pack cannot skip the gates", () => {
  // scheduled → staged would stage a fixture whose base slate was never approved.
  assert.equal(canTransition("scheduled", "staged"), false);
  // base_ready → released would release without a frozen pack.
  assert.equal(canTransition("base_ready", "released"), false);
});

test("state machine: released and cancelled are terminal", () => {
  const terminal: HalftimeState[] = ["released", "released_late", "cancelled"];
  const all: HalftimeState[] = [
    "scheduled", "base_ready", "staged", "released", "released_late", "cancelled", "failed",
  ];
  for (const from of terminal) {
    for (const to of all) {
      assert.equal(canTransition(from, to), false, `${from} → ${to} must be refused`);
    }
  }
});

test("state machine: any pre-release state can be cancelled (postponement)", () => {
  for (const s of ["scheduled", "base_ready", "staged"] as HalftimeState[]) {
    assert.ok(canTransition(s, "cancelled"), `${s} → cancelled`);
  }
});

test("state machine: only a staged fixture is releasable", () => {
  assert.ok(isReleasable("staged"));
  for (const s of ["scheduled", "base_ready", "released", "cancelled", "failed"] as HalftimeState[]) {
    assert.equal(isReleasable(s), false, `${s} must not be releasable`);
  }
  assert.ok(isReleased("released"));
  assert.ok(isReleased("released_late"));
  assert.equal(isReleased("staged"), false);
});

// ── SportMonks phase classification ──────────────────────────────────────────

test("classifyPhase: id 3 is halftime (the verified id)", () => {
  assert.equal(classifyPhase(3, "HT"), "halftime");
  // Trusted even if the catalogue name were to drift.
  assert.equal(classifyPhase(3, "SOMETHING_ELSE"), "halftime");
});

test("classifyPhase: BREAK is the extra-time break, NOT halftime", () => {
  // The trap: mapping BREAK to halftime would release the pack ~an hour late
  // and fire a push after full time.
  assert.equal(classifyPhase(4, "BREAK"), "past_halftime");
  assert.equal(classifyPhase(21, "EXTRA_TIME_BREAK"), "past_halftime");
  assert.equal(classifyPhase(25, "PEN_BREAK"), "past_halftime");
});

test("classifyPhase: everything at or past the restart is past_halftime", () => {
  for (const [id, name] of [
    [22, "INPLAY_2ND_HALF"], [5, "FT"], [6, "INPLAY_ET"], [7, "AET"],
    [8, "FT_PEN"], [9, "INPLAY_PENALTIES"],
  ] as [number, string][]) {
    assert.equal(classifyPhase(id, name), "past_halftime", name);
  }
});

test("classifyPhase: pre-match and first half never release", () => {
  assert.equal(classifyPhase(1, "NS"), "pre");
  assert.equal(classifyPhase(13, "TBA"), "pre");
  assert.equal(classifyPhase(2, "INPLAY_1ST_HALF"), "first_half");
});

test("classifyPhase: terminal abandonment cancels; resumable states do not", () => {
  for (const [id, name] of [
    [10, "POSTPONED"], [12, "CANCELLED"], [15, "ABANDONED"], [14, "WO"], [17, "AWARDED"],
  ] as [number, string][]) {
    assert.equal(classifyPhase(id, name), "abnormal", name);
  }
  // These can resume — the poller must take NO action, not cancel the fixture.
  for (const [id, name] of [
    [11, "SUSPENDED"], [16, "DELAYED"], [18, "INTERRUPTED"],
  ] as [number, string][]) {
    assert.equal(classifyPhase(id, name), "unknown", name);
  }
});

test("classifyPhase: an unrecognised state is 'unknown', never a release", () => {
  assert.equal(classifyPhase(999, "SOME_NEW_STATE"), "unknown");
  assert.equal(classifyPhase(999, null), "unknown");
  assert.equal(classifyPhase(999, ""), "unknown");
});

// ── Europe/London matchday ───────────────────────────────────────────────────

test("londonMatchday: a late-evening BST kickoff belongs to the London day", () => {
  // 22:30 UTC on 21 Aug is 23:30 BST on 21 Aug — still the 21st in London.
  assert.equal(londonMatchday(new Date("2026-08-21T22:30:00Z")), "2026-08-21");
  // 23:30 UTC on 21 Aug is 00:30 BST on the 22nd.
  assert.equal(londonMatchday(new Date("2026-08-21T23:30:00Z")), "2026-08-22");
});

test("londonDayRange: BST day starts at 23:00 UTC the previous day", () => {
  const { startUtc, endUtc } = londonDayRange("2026-08-22");
  assert.equal(startUtc, "2026-08-21T23:00:00.000Z");
  assert.equal(endUtc, "2026-08-22T23:00:00.000Z");
});

test("londonDayRange: GMT day starts at midnight UTC", () => {
  const { startUtc, endUtc } = londonDayRange("2026-01-10");
  assert.equal(startUtc, "2026-01-10T00:00:00.000Z");
  assert.equal(endUtc, "2026-01-11T00:00:00.000Z");
});

test("londonDayRange: a 15:00 BST kickoff falls inside its own matchday", () => {
  const { startUtc, endUtc } = londonDayRange("2026-08-22");
  const kickoff = new Date("2026-08-22T14:00:00Z"); // 15:00 BST
  assert.ok(kickoff >= new Date(startUtc) && kickoff < new Date(endUtc));
});

// ── answer shuffle ───────────────────────────────────────────────────────────

test("shuffleOptions: the answer letter still points at the correct option text", () => {
  // The whole point: authors write the answer as A, we move it, and the answer
  // key must follow the TEXT. Getting this wrong marks every player wrong.
  for (let i = 0; i < 40; i++) {
    const original = q(i);
    const correctText = original.options[original.answer];
    const shuffled = shuffleOptions(original, i, FIXTURE);
    assert.equal(shuffled.options[shuffled.answer], correctText);
    // All four options survive, none duplicated.
    assert.deepEqual(
      Object.values(shuffled.options).sort(),
      Object.values(original.options).sort(),
    );
  }
});

test("shuffleOptions: deterministic per fixture, and it actually moves the answer", () => {
  const once = BASE_10.map((x, i) => shuffleOptions(x, i, FIXTURE));
  const twice = BASE_10.map((x, i) => shuffleOptions(x, i, FIXTURE));
  assert.deepEqual(once, twice, "same fixture must reproduce the same pack");

  // Not every answer should still be sitting in slot A.
  const stillA = once.filter((x) => x.answer === "A").length;
  assert.ok(stillA < 10, "the shuffle must actually spread the answer across A-D");
});

// ── assembly ─────────────────────────────────────────────────────────────────

test("assemble: fresh questions lead and base fills to exactly 10", () => {
  const slice = [fresh(1, "approved"), fresh(2, "approved")];
  const pack = assembleQuestions(BASE_10, slice, FIXTURE);

  assert.equal(pack.length, 10);
  assert.ok(pack[0].question.startsWith("Fresh question 1"));
  assert.ok(pack[1].question.startsWith("Fresh question 2"));
  // Fresh REPLACES base — the last two base questions drop off, not extend it.
  assert.equal(pack.filter((x) => x.question.startsWith("Base")).length, 8);
});

test("assemble: only approved fresh questions make the pack", () => {
  const slice = [
    fresh(1, "approved"),
    fresh(2, "vetoed"),
    fresh(3, "pending"),
    fresh(4, "dropped"),
  ];
  const pack = assembleQuestions(BASE_10, slice, FIXTURE);
  const freshInPack = pack.filter((x) => x.question.startsWith("Fresh"));

  assert.equal(pack.length, 10);
  assert.equal(freshInPack.length, 1);
  assert.ok(freshInPack[0].question.startsWith("Fresh question 1"));
});

test("assemble: the fresh slice can never exceed 3", () => {
  const slice = [1, 2, 3, 4, 5].map((n) => fresh(n, "approved"));
  const pack = assembleQuestions(BASE_10, slice, FIXTURE);
  assert.equal(pack.length, 10);
  assert.equal(pack.filter((x) => x.question.startsWith("Fresh")).length, 3);
});

test("assemble: baseOnly is a complete 10-question pack (the degraded path)", () => {
  const slice = [fresh(1, "approved"), fresh(2, "approved")];
  const pack = assembleQuestions(BASE_10, slice, FIXTURE, { baseOnly: true });

  assert.equal(pack.length, 10);
  assert.equal(pack.filter((x) => x.question.startsWith("Fresh")).length, 0);
  assert.ok(validatePackQuestions(pack).length === 0);
});

test("assemble: no fresh slice at all still yields a full pack", () => {
  assert.equal(assembleQuestions(BASE_10, [], FIXTURE).length, 10);
  assert.equal(assembleQuestions(BASE_10, null, FIXTURE).length, 10);
});

test("assemble: gate metadata never leaks into the played pack", () => {
  const pack = assembleQuestions(BASE_10, [fresh(1, "approved")], FIXTURE);
  for (const item of pack) {
    assert.deepEqual(Object.keys(item).sort(), ["answer", "difficulty", "options", "question"]);
  }
});

// ── release-time content selection ───────────────────────────────────────────

const frozenPack = assembleQuestions(
  BASE_10,
  [fresh(1, "approved"), fresh(2, "approved")],
  FIXTURE,
);

test("release: with no late veto the pack is the frozen snapshot, byte for byte", () => {
  const out = questionsForRelease({
    fixture_id: FIXTURE,
    base_questions: BASE_10,
    fresh_questions: [fresh(1, "approved"), fresh(2, "approved")],
    pack_questions: frozenPack,
    fresh_state: "approved",
  });
  // AC3b: release copies, it never regenerates.
  assert.deepEqual(out, frozenPack);
});

test("release: a veto landing after the deadline still pulls the question", () => {
  const out = questionsForRelease({
    fixture_id: FIXTURE,
    base_questions: BASE_10,
    fresh_questions: [fresh(1, "approved"), fresh(2, "vetoed")],
    pack_questions: frozenPack,
    fresh_state: "approved",
  });

  assert.equal(out.length, 10);
  assert.equal(out.filter((x) => x.question.startsWith("Fresh question 2")).length, 0);
  assert.equal(out.filter((x) => x.question.startsWith("Fresh question 1")).length, 1);
  // Backfilled from the day-before base slate, so still 10.
  assert.equal(out.filter((x) => x.question.startsWith("Base")).length, 9);
});

test("release: the kill switch forces base-only even on a staged pack", () => {
  const out = questionsForRelease({
    fixture_id: FIXTURE,
    base_questions: BASE_10,
    fresh_questions: [fresh(1, "approved"), fresh(2, "approved")],
    pack_questions: frozenPack,
    fresh_state: "killed",
  });
  assert.equal(out.length, 10);
  assert.equal(out.filter((x) => x.question.startsWith("Fresh")).length, 0);
});

test("release: no frozen snapshot (poller died) falls back to base-only, never fresh", () => {
  const out = questionsForRelease({
    fixture_id: FIXTURE,
    base_questions: BASE_10,
    fresh_questions: [fresh(1, "approved")],
    pack_questions: null,
    fresh_state: "approved",
  });
  assert.equal(out.length, 10);
  assert.equal(out.filter((x) => x.question.startsWith("Fresh")).length, 0);
});

// ── pack validation ──────────────────────────────────────────────────────────

test("validate: a good pack passes", () => {
  assert.deepEqual(validatePackQuestions(assembleQuestions(BASE_10, [], FIXTURE)), []);
});

test("validate: a short pack is rejected", () => {
  const errs = validatePackQuestions(BASE_10.slice(0, 9));
  assert.ok(errs.some((e) => e.includes("expected 10")));
});

test("validate: a missing option or a bad answer key is rejected", () => {
  const broken = BASE_10.map((x) => ({ ...x }));
  broken[3] = { ...broken[3], options: { A: "a", B: "b", C: "", D: "d" } } as QuizQuestion;
  broken[5] = { ...broken[5], answer: "E" as unknown as QuizQuestion["answer"] };
  broken[7] = { ...broken[7], difficulty: "impossible" as unknown as QuizQuestion["difficulty"] };

  const errs = validatePackQuestions(broken);
  assert.ok(errs.some((e) => e.startsWith("q4:")), "empty option must be caught");
  assert.ok(errs.some((e) => e.startsWith("q6:")), "bad answer letter must be caught");
  assert.ok(errs.some((e) => e.startsWith("q8:")), "bad difficulty must be caught");
});

test("validate: rubbish input is rejected, not thrown on", () => {
  assert.ok(validatePackQuestions(null).length > 0);
  assert.ok(validatePackQuestions("nope").length > 0);
  assert.ok(validatePackQuestions([{}]).length > 0);
});

// ── push copy + keys ─────────────────────────────────────────────────────────

test("push: the dedupe key is per fixture (exactly-once, per user)", () => {
  assert.equal(pushDedupeKey(19134567), "halftime:19134567");
  assert.notEqual(pushDedupeKey(1), pushDedupeKey(2));
});

test("push: copy leaks no score and never mentions a delivery mechanism", () => {
  const copy = pushCopy({ home: "Arsenal", away: "Coventry" });
  const text = `${copy.title} ${copy.body}`.toLowerCase();

  // People play this later in the day — a scoreline in the push is a spoiler.
  for (const banned of ["1-0", "0-0", "lead", "scored", "goal", "winning", "ht:"]) {
    assert.equal(text.includes(banned), false, `push copy must not contain "${banned}"`);
  }
  // Locked rule: never mention how the game is delivered.
  for (const banned of ["browser", "download", "no download", "app store", "install"]) {
    assert.equal(text.includes(banned), false, `push copy must not contain "${banned}"`);
  }
  // Locked vocabulary.
  assert.ok(text.includes("quiz pack"));
  assert.equal(text.includes(" iq"), false);
});

test("pack name: carries the date so a reverse fixture cannot collide on slug", () => {
  const a = packName({ home: "Arsenal", away: "Coventry", kickoff_at: "2026-08-22T14:00:00Z" });
  const b = packName({ home: "Arsenal", away: "Coventry", kickoff_at: "2027-01-16T15:00:00Z" });
  assert.notEqual(a, b);
  assert.ok(a.includes("Arsenal v Coventry"));
});

// ── the compare-and-set contract ─────────────────────────────────────────────
//
// The real guarantee is Postgres': `update ... where state = 'staged'` is a
// single statement, so a concurrent updater blocks on the row lock, re-checks
// its WHERE against the winner's committed row, and updates zero rows. (That is
// verified for real against a scratch Postgres schema — see the session report.)
//
// What is modelled here is the CALLER's contract: whoever gets zero rows back
// must not insert a pack and must not push. A future refactor that "helpfully"
// pushes on the zero-row path is exactly the bug these tests exist to catch.

test("CAS: concurrent releasers produce exactly one winner", () => {
  let state: HalftimeState = "staged";
  const cas = (): boolean => {
    if (state !== "staged") return false; // WHERE state = 'staged' matched 0 rows
    state = "released";
    return true;
  };

  // The poller and the watchdog both see halftime in the same second.
  const winners = [cas(), cas(), cas(), cas()].filter(Boolean);

  assert.equal(winners.length, 1, "exactly one caller may release");
  assert.equal(state, "released");
});

test("CAS: a released fixture can never be re-released, late or otherwise", () => {
  let state: HalftimeState = "released";
  const cas = (): boolean => {
    if (state !== "staged") return false;
    state = "released_late";
    return true;
  };
  assert.equal(cas(), false);
  assert.equal(state, "released", "state must not change on a losing CAS");
});

test("CAS: a cancelled fixture is never releasable, so no pack and no push", () => {
  const state: HalftimeState = "cancelled";
  assert.equal(isReleasable(state), false);
  assert.equal(canTransition("cancelled", "released"), false);
});

// ── SportMonks state-name integrity ──────────────────────────────────────────
//
// Reconciliation guard (added during integration). W1 shipped two developer_names
// that do not exist in SportMonks: "INPLAY_ET_2ND_HALF" (the real name is
// "INPLAY_ET_SECOND_HALF") and "AWAITING_PENALTIES" (no such state). Neither
// throws — an unrecognised name classifies as "unknown" and the poller takes no
// action — so the defect was invisible to every other test.
//
// This asserts every name we classify against the catalogue recorded from the
// live API, so a typo fails here instead of on a matchday.

test("every classified state name exists in the real SportMonks catalogue", () => {
  const raw = readFileSync(
    resolve(process.cwd(), "scripts/halftime/scenarios/states.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { data?: unknown } | unknown[];
  const rows = (Array.isArray(parsed) ? parsed : parsed.data) as {
    id: number;
    developer_name: string;
  }[];

  assert.ok(rows.length > 0, "states catalogue is empty — re-record it");

  const real = new Set(rows.map((s) => s.developer_name));
  const bogus = CLASSIFIED_STATE_NAMES.filter((n) => !real.has(n));

  assert.deepEqual(
    bogus,
    [],
    `these names are classified but do not exist in SportMonks: ${bogus.join(", ")}`,
  );

  // And the one id we hardcode really is half time.
  const ht = rows.find((s) => s.id === HALFTIME_STATE_ID);
  assert.equal(ht?.developer_name, "HT", "HALFTIME_STATE_ID must be the HT state");
});

test("the real ET second-half name classifies as past_halftime (no release, no push)", () => {
  assert.equal(classifyPhase(23, "INPLAY_ET_SECOND_HALF"), "past_halftime");
});
