import { test } from "node:test";
import assert from "node:assert/strict";
// Extensionless import matches the repo's other lib tests (src/lib/draft/*.test.ts) and keeps
// `tsc --noEmit` clean. Run under the same bare-tsc harness:
//   npx tsc src/lib/questions.ts src/lib/questions.test.ts --outDir /tmp/qt \
//     --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
//     && node --test /tmp/qt/questions.test.js
import { normalizeQuestionText, dedupeByQuestionText, pickDistinctFacts } from "./questions";

// ── The same-fact rule ────────────────────────────────────────────────────────
// The factory writes several questions per researched fact (founder's call: volume beats
// purity when building a bank). The cost of that is questions which spoil each other, so the
// rule is enforced when a quiz is dealt, not when questions are made.

/** The real pair that motivated this: the second question names Chelsea. */
const FA_CUP_FINAL = [
  { id: "q1", fact_key: "fa20", difficulty: "easy", question: "Which club did Arsenal beat in the 2019/20 FA Cup final?" },
  { id: "q2", fact_key: "fa20", difficulty: "medium", question: "Who scored both goals in Arsenal's 2019/20 FA Cup final win over Chelsea?" },
  { id: "q3", fact_key: "fa20", difficulty: "hard", question: "What was the score in the 2019/20 FA Cup final?" },
];

test("never deals two questions built from the same fact", () => {
  const picked = pickDistinctFacts(FA_CUP_FINAL, 3);
  assert.equal(picked.length, 1, "all three share a fact — only one may be dealt");
  assert.equal(picked[0].id, "q1");
});

test("the spoiler pair cannot appear together", () => {
  // q2 names Chelsea, which is the answer to q1. This is the whole reason the rule exists.
  const picked = pickDistinctFacts(FA_CUP_FINAL, 15);
  const ids = picked.map((q) => q.id);
  assert.ok(!(ids.includes("q1") && ids.includes("q2")), "q2 gives away q1");
});

test("a shared set stops same-fact questions slipping in at different difficulties", () => {
  // The real failure mode: easy/medium/hard are fetched separately, so per-pick sets would
  // miss that the easy and the hard question come from the same final.
  const used = new Set<string>();
  const easy = pickDistinctFacts(FA_CUP_FINAL.filter((q) => q.difficulty === "easy"), 6, used);
  const medium = pickDistinctFacts(FA_CUP_FINAL.filter((q) => q.difficulty === "medium"), 6, used);
  const hard = pickDistinctFacts(FA_CUP_FINAL.filter((q) => q.difficulty === "hard"), 3, used);

  assert.equal(easy.length, 1);
  assert.equal(medium.length, 0, "same fact as the easy pick — must be skipped");
  assert.equal(hard.length, 0, "same fact as the easy pick — must be skipped");
});

test("questions from different facts are all fine", () => {
  const pool = [
    { id: "a", fact_key: "f1" },
    { id: "b", fact_key: "f2" },
    { id: "c", fact_key: "f3" },
  ];
  assert.equal(pickDistinctFacts(pool, 3).length, 3);
});

test("reaches further down the pool when a fact is spent", () => {
  // Skipping a duplicate must not cost us a slot — it should take the next usable question.
  const pool = [
    { id: "a", fact_key: "f1" },
    { id: "b", fact_key: "f1" }, // dup — skipped
    { id: "c", fact_key: "f2" },
    { id: "d", fact_key: "f3" },
  ];
  const picked = pickDistinctFacts(pool, 3);
  assert.deepEqual(picked.map((q) => q.id), ["a", "c", "d"]);
});

test("legacy rows (null fact_key) are untracked, never blocked", () => {
  // 2,447 pre-existing questions have no fact_key. They weren't built from a tracked fact,
  // so they're unrelated to everything and must all still be dealable.
  const pool = [
    { id: "a", fact_key: null },
    { id: "b", fact_key: null },
    { id: "c", fact_key: undefined },
  ];
  assert.equal(pickDistinctFacts(pool, 3).length, 3);
});

test("legacy and tracked rows mix correctly", () => {
  const pool = [
    { id: "a", fact_key: null },
    { id: "b", fact_key: "f1" },
    { id: "c", fact_key: "f1" }, // dup of b
    { id: "d", fact_key: null },
  ];
  assert.deepEqual(pickDistinctFacts(pool, 4).map((q) => q.id), ["a", "b", "d"]);
});

test("respects the requested count", () => {
  const pool = [{ id: "a", fact_key: "f1" }, { id: "b", fact_key: "f2" }, { id: "c", fact_key: "f3" }];
  assert.equal(pickDistinctFacts(pool, 2).length, 2);
});

// ── Existing text dedupe still works, and is NOT a substitute ─────────────────

test("dedupeByQuestionText cannot catch the same-fact case — which is why pickDistinctFacts exists", () => {
  // Both survive text dedupe: the wording is completely different. Only fact_key catches it.
  const deduped = dedupeByQuestionText(FA_CUP_FINAL);
  assert.equal(deduped.length, 3, "text dedupe sees three distinct questions");
});

test("dedupeByQuestionText still drops repeated text", () => {
  const dupes = [
    { question: "Who won the 2020 FA Cup?" },
    { question: "who won the 2020 FA CUP?!" }, // same after normalization
  ];
  assert.equal(dedupeByQuestionText(dupes).length, 1);
});

test("normalizeQuestionText is unchanged (migration 67's index depends on it)", () => {
  assert.equal(normalizeQuestionText("Who won the 2020 FA Cup?!"), "who won the 2020 fa cup");
});
