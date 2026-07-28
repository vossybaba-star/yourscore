/**
 * Unit tests for the gameday pure logic.
 *
 * shared.ts is deliberately import-free, so this runs with no bundler and no
 * DB, same pattern as src/lib/halftime/shared.test.ts:
 *
 *   npx tsc src/lib/gameday/shared.ts src/lib/gameday/shared.test.ts \
 *     --outDir /tmp/gd-test --module commonjs --target es2022 \
 *     --moduleResolution node --skipLibCheck --strict --esModuleInterop
 *   node --test /tmp/gd-test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  assembleQuestions,
  canTransition,
  isPublishable,
  isPublished,
  londonMatchday,
  packName,
  publishAtFor,
  pushCopy,
  pushDedupeKey,
  questionsForPublish,
  recapPackName,
  recapSentinelFixtureId,
  shuffleOptions,
  validatePackQuestions,
  type GamedayState,
  type QuizQuestion,
} from "./shared";

// ── helpers ──────────────────────────────────────────────────────────────────

function q(n: number, difficulty: "easy" | "medium" | "hard" = "medium"): QuizQuestion {
  return {
    question: `Base question ${n}?`,
    options: { A: `correct-${n}`, B: `wrong-${n}-b`, C: `wrong-${n}-c`, D: `wrong-${n}-d` },
    answer: "A",
    difficulty,
  };
}

const BASE_11 = Array.from({ length: 11 }, (_, i) => q(i + 1));
const FIXTURE = 19134567;

// ── state machine ────────────────────────────────────────────────────────────

test("state machine: the happy path is the only way to a published pack", () => {
  assert.ok(canTransition("scheduled", "base_ready"));
  assert.ok(canTransition("base_ready", "approved"));
  assert.ok(canTransition("approved", "published"));
});

test("state machine: a pack cannot skip the gates", () => {
  assert.equal(canTransition("scheduled", "approved"), false);
  assert.equal(canTransition("base_ready", "published"), false);
  assert.equal(canTransition("scheduled", "published"), false);
});

test("state machine: published is fully terminal", () => {
  const all: GamedayState[] = ["scheduled", "base_ready", "approved", "published", "cancelled", "failed"];
  for (const to of all) {
    assert.equal(canTransition("published", to), false, `published → ${to} must be refused`);
  }
});

test("state machine: a cancelled fixture can re-enter the pipeline if rescheduled (FIX P2-a)", () => {
  // The one automatic exception: a postponed fixture reappearing in the sync
  // window on a new date must re-enter at 'scheduled', not stay stranded.
  assert.ok(canTransition("cancelled", "scheduled"), "cancelled → scheduled must be allowed");
  // Nothing else may leave cancelled — it cannot skip straight back into the
  // gate or publish without going through sync + the base slate + the gate again.
  for (const to of ["base_ready", "approved", "published", "cancelled", "failed"] as GamedayState[]) {
    assert.equal(canTransition("cancelled", to), false, `cancelled → ${to} must be refused`);
  }
});

test("state machine: any pre-publish state can be cancelled", () => {
  for (const s of ["scheduled", "base_ready", "approved"] as GamedayState[]) {
    assert.ok(canTransition(s, "cancelled"), `${s} → cancelled`);
  }
});

test("state machine: only an approved fixture is publishable", () => {
  assert.ok(isPublishable("approved"));
  for (const s of ["scheduled", "base_ready", "published", "cancelled", "failed"] as GamedayState[]) {
    assert.equal(isPublishable(s), false, `${s} must not be publishable`);
  }
  assert.ok(isPublished("published"));
  assert.equal(isPublished("approved"), false);
});

test("state machine: failed can be repaired back to scheduled (weekly-sync path)", () => {
  assert.ok(canTransition("failed", "scheduled"));
});

// ── publish_at derivation ─────────────────────────────────────────────────────

test("publishAtFor: 09:00 London the morning of a BST kickoff", () => {
  // Sat 22 Aug 2026, 15:00 BST kickoff (14:00 UTC) → publish SAME DAY, Sat 22
  // Aug 09:00 BST = 08:00 UTC (day-of, founder 2026-07-25).
  const publishAt = publishAtFor("2026-08-22T14:00:00Z");
  assert.equal(publishAt, "2026-08-22T08:00:00.000Z");
});

test("publishAtFor: 09:00 London the morning of a GMT kickoff", () => {
  // Sat 10 Jan 2026, 15:00 GMT kickoff (15:00 UTC) → publish SAME DAY, Sat 10
  // Jan 09:00 GMT = 09:00 UTC.
  const publishAt = publishAtFor("2026-01-10T15:00:00Z");
  assert.equal(publishAt, "2026-01-10T09:00:00.000Z");
});

test("publishAtFor: a late-evening kickoff publishes the morning of its own London day", () => {
  // 22:30 UTC on 21 Aug is 23:30 BST — still the 21st in London, so publish is
  // the 21st at 09:00 BST = 08:00 UTC (~14.5h before an evening kickoff).
  const publishAt = publishAtFor("2026-08-21T22:30:00Z");
  assert.equal(publishAt, "2026-08-21T08:00:00.000Z");
});

test("publishAtFor: a kickoff just after London midnight publishes that morning", () => {
  // 23:30 UTC on 21 Aug is 00:30 BST on the 22nd — kickoff's London day is the
  // 22nd, so publish is the 22nd at 09:00 BST = 08:00 UTC.
  const publishAt = publishAtFor("2026-08-21T23:30:00Z");
  assert.equal(publishAt, "2026-08-22T08:00:00.000Z");
});

test("londonMatchday sanity check (shared with the derivation above)", () => {
  assert.equal(londonMatchday(new Date("2026-08-21T22:30:00Z")), "2026-08-21");
  assert.equal(londonMatchday(new Date("2026-08-21T23:30:00Z")), "2026-08-22");
});

// ── answer shuffle ───────────────────────────────────────────────────────────

test("shuffleOptions: the answer letter still points at the correct option text", () => {
  for (let i = 0; i < 40; i++) {
    const original = q(i);
    const correctText = original.options[original.answer];
    const shuffled = shuffleOptions(original, i, FIXTURE);
    assert.equal(shuffled.options[shuffled.answer], correctText);
    assert.deepEqual(
      Object.values(shuffled.options).sort(),
      Object.values(original.options).sort(),
    );
  }
});

test("shuffleOptions: deterministic per fixture, and it actually moves the answer", () => {
  const once = BASE_11.map((x, i) => shuffleOptions(x, i, FIXTURE));
  const twice = BASE_11.map((x, i) => shuffleOptions(x, i, FIXTURE));
  assert.deepEqual(once, twice, "same fixture must reproduce the same pack");
  const stillA = once.filter((x) => x.answer === "A").length;
  assert.ok(stillA < 11, "the shuffle must actually spread the answer across A-D");
});

// ── assembly ─────────────────────────────────────────────────────────────────

test("assemble: a full base slate yields exactly 11 questions", () => {
  const pack = assembleQuestions(BASE_11, FIXTURE);
  assert.equal(pack.length, 11);
});

test("assemble: no base slate at all yields an empty pack", () => {
  assert.equal(assembleQuestions([], FIXTURE).length, 0);
  assert.equal(assembleQuestions(null, FIXTURE).length, 0);
});

test("questionsForPublish: the frozen snapshot wins, byte for byte", () => {
  const frozen = assembleQuestions(BASE_11, FIXTURE);
  const out = questionsForPublish({ fixture_id: FIXTURE, base_questions: BASE_11, questions: frozen });
  assert.deepEqual(out, frozen);
});

test("questionsForPublish: no frozen snapshot falls back to assembling from base", () => {
  const out = questionsForPublish({ fixture_id: FIXTURE, base_questions: BASE_11, questions: null });
  assert.equal(out.length, 11);
});

// ── pack validation ──────────────────────────────────────────────────────────

test("validate: a good pack passes", () => {
  assert.deepEqual(validatePackQuestions(assembleQuestions(BASE_11, FIXTURE)), []);
});

test("validate: a short pack is rejected", () => {
  const errs = validatePackQuestions(BASE_11.slice(0, 9));
  assert.ok(errs.some((e) => e.includes("expected 11")));
});

test("validate: rubbish input is rejected, not thrown on", () => {
  assert.ok(validatePackQuestions(null).length > 0);
  assert.ok(validatePackQuestions("nope").length > 0);
  assert.ok(validatePackQuestions([{}]).length > 0);
});

// ── push copy + keys ─────────────────────────────────────────────────────────

test("push: the dedupe key is per fixture, namespaced to gameday", () => {
  assert.equal(pushDedupeKey(19134567), "gameday:19134567");
  assert.notEqual(pushDedupeKey(1), pushDedupeKey(2));
});

test("push: copy never mentions how the game is delivered, and locked vocabulary holds", () => {
  const copy = pushCopy({ home: "Arsenal", away: "Coventry" });
  const text = `${copy.title} ${copy.body}`.toLowerCase();
  for (const banned of ["browser", "download", "no download", "app store", "install"]) {
    assert.equal(text.includes(banned), false, `push copy must not contain "${banned}"`);
  }
  assert.equal(text.includes(" iq"), false);
});

test("pack name: carries the date so a reverse fixture cannot collide on slug", () => {
  const a = packName({ home: "Arsenal", away: "Coventry", kickoff_at: "2026-08-22T14:00:00Z" });
  const b = packName({ home: "Arsenal", away: "Coventry", kickoff_at: "2027-01-16T15:00:00Z" });
  assert.notEqual(a, b);
  assert.ok(a.includes("Arsenal v Coventry"));
});

// ── Recap Quiz (§6) ──────────────────────────────────────────────────────────

test("recapSentinelFixtureId: deterministic, negative, never collides with a real fixture id", () => {
  const a = recapSentinelFixtureId(28083, 7);
  const b = recapSentinelFixtureId(28083, 7);
  assert.equal(a, b, "same season+gameweek must resolve to the same sentinel every run");
  assert.ok(a < 0, "must be negative — real SportMonks fixture ids are always positive");
});

test("recapSentinelFixtureId: different gameweeks/seasons never collide", () => {
  const ids = new Set([
    recapSentinelFixtureId(28083, 1),
    recapSentinelFixtureId(28083, 2),
    recapSentinelFixtureId(28083, 38),
    recapSentinelFixtureId(28001, 1),
  ]);
  assert.equal(ids.size, 4);
});

test("recapPackName: names the gameweek, not a fixture", () => {
  const name = recapPackName({ gameweek: 7, season_id: 28083 });
  assert.ok(name.includes("Gameweek 7"));
});
