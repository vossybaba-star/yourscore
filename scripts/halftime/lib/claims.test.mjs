/**
 * claims.test.mjs — restored (AC3). Deleted in W0 alongside the fresh-slice
 * files; claims.mjs itself was KEPT because it is load-bearing for
 * scripts/gameday/validate.mjs, which imports exactly four things from it:
 * textViolations, buildNameIndex, normName, knownClaimType. This suite
 * focuses on those four — the claim-resolution logic validate.mjs actually
 * depends on — plus the composite gate they feed into, all pure/no I/O.
 *
 *   node --test scripts/halftime/lib/claims.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  knownClaimType,
  isMutable,
  firstHalfViolations,
  hasPreKickoffAnchor,
  anchorViolations,
  normName,
  buildNameIndex,
  entityViolations,
  shapeViolations,
  answerLeakViolations,
  buildLeakIgnore,
  groundingViolations,
  currentAffairsViolations,
  textViolations,
} from "./claims.mjs";

// ── knownClaimType (validate.mjs's RESOLVERS dispatch gate) ─────────────────

test("knownClaimType: every claim type validate.mjs has a resolver for is known", () => {
  // Mirrors the RESOLVERS map in validate.mjs — if a type is added there
  // without a CLAIM_TYPES entry here, groundingViolations() would silently
  // treat it as "unknown" and drop every question that uses it.
  for (const type of [
    "player_in_lineup",
    "player_career_club",
    "player_debut_club",
    "player_stat",
    "player_goals_vs",
    "player_age",
    "formation",
    "h2h_result",
    "h2h_tally",
    "fifa_rating",
    "fifa_top",
    "fifa_absent",
    "fixture_scorer", // Recap Quiz (§6)
  ]) {
    assert.ok(knownClaimType({ type }), `${type} must be a known claim type`);
  }
});

test("knownClaimType: an invented type is rejected, not silently accepted", () => {
  assert.equal(knownClaimType({ type: "made_up_claim" }), false);
  assert.equal(knownClaimType(null), false);
  assert.equal(knownClaimType(undefined), false);
});

test("isMutable: running totals are mutable, historical facts are not", () => {
  assert.ok(isMutable({ type: "player_stat" }));
  assert.equal(isMutable({ type: "h2h_result" }), false);
  assert.equal(isMutable({ type: "fixture_scorer" }), false);
});

// ── groundingViolations (a question validate.mjs would never see resolved) ──

test("groundingViolations: zero claims is ungrounded by definition", () => {
  assert.ok(groundingViolations([]).length > 0);
  assert.ok(groundingViolations(undefined).length > 0);
});

test("groundingViolations: an unknown claim type is caught before it reaches validate.mjs's resolver dispatch", () => {
  const errs = groundingViolations([{ type: "not_a_real_type" }]);
  assert.ok(errs.some((e) => e.includes("not_a_real_type")));
});

test("groundingViolations: a real, known claim passes", () => {
  assert.deepEqual(groundingViolations([{ type: "h2h_result" }]), []);
});

// ── the first-half ban (the hard rule) ───────────────────────────────────────

test("firstHalfViolations: catches live-match language", () => {
  assert.ok(firstHalfViolations("What is the current score?").length > 0);
  assert.ok(firstHalfViolations("Arsenal are currently leading").length > 0);
  assert.ok(firstHalfViolations("Who opened the scoring today?").length > 0);
  assert.ok(firstHalfViolations("He was booked in the 34th minute").length > 0);
});

test("firstHalfViolations: a genuine historic score question is clean", () => {
  assert.deepEqual(firstHalfViolations("What was the score when they last met in 2001?"), []);
});

// ── the temporal anchor on mutable stats ─────────────────────────────────────

test("hasPreKickoffAnchor: recognises the standard anchor phrases", () => {
  assert.ok(hasPreKickoffAnchor("Going into this match, how many goals has he scored?"));
  assert.ok(hasPreKickoffAnchor("Before kick-off, what was his tally?"));
  assert.equal(hasPreKickoffAnchor("How many goals has he scored this season?"), false);
});

test("anchorViolations: a mutable stat with no anchor is flagged", () => {
  const claims = [{ type: "player_stat", stat: "goals" }];
  assert.ok(anchorViolations("How many goals has he scored?", claims).length > 0);
});

test("anchorViolations: the same mutable stat WITH an anchor is clean", () => {
  const claims = [{ type: "player_stat", stat: "goals" }];
  assert.deepEqual(anchorViolations("Going into this match, how many goals has he scored?", claims), []);
});

test("anchorViolations: an immutable claim never needs an anchor", () => {
  const claims = [{ type: "h2h_result" }];
  assert.deepEqual(anchorViolations("What was the score in 2001?", claims), []);
});

// ── normName + buildNameIndex (the whitelist validate.mjs's caller builds) ──

test("normName: case/accent/possessive insensitive", () => {
  assert.equal(normName("Gabriel Magalhães"), normName("gabriel magalhaes"));
  assert.equal(normName("Arsenal's"), "arsenal");
});

test("buildNameIndex: full names AND their tokens (>2 chars) are indexed", () => {
  const idx = buildNameIndex(["Bukayo Saka"], ["Arsenal"]);
  assert.ok(idx.has(normName("Bukayo Saka")));
  assert.ok(idx.has("saka"));
  assert.ok(idx.has("bukayo"));
  assert.ok(idx.has("arsenal"));
  assert.equal(idx.has("ronaldo"), false);
});

// ── entityViolations (the hallucinated-name gate) ────────────────────────────

test("entityViolations: a whitelisted player name is allowed", () => {
  const idx = buildNameIndex(["Bukayo Saka"], ["Arsenal", "Coventry City"]);
  const out = entityViolations("Who scored for Arsenal, Bukayo Saka or someone else?", { A: "Bukayo Saka" }, idx);
  assert.deepEqual(out, []);
});

test("entityViolations: a name outside the dossier whitelist is caught", () => {
  const idx = buildNameIndex(["Bukayo Saka"], ["Arsenal", "Coventry City"]);
  const out = entityViolations("Was it Cristiano Ronaldo who scored?", {}, idx);
  assert.ok(out.some((e) => e.includes("Ronaldo") || e.includes("Cristiano")));
});

test("entityViolations: sentence-initial ordinary words are not treated as people", () => {
  const idx = buildNameIndex(["Bukayo Saka"], ["Arsenal"]);
  const out = entityViolations("Among these four Arsenal players, who is the captain?", {}, idx);
  assert.deepEqual(out, []);
});

// ── shapeViolations (structural gate) ────────────────────────────────────────

test("shapeViolations: a well-formed question passes", () => {
  const q = {
    question: "Which club did Arsenal beat 3-1 in September 2019?",
    options: { A: "Aston Villa", B: "Everton", C: "Leicester City", D: "West Ham" },
    answer: "A",
    difficulty: "medium",
  };
  assert.deepEqual(shapeViolations(q), []);
});

test("shapeViolations: the answer must be authored as A (shuffle happens later)", () => {
  const q = {
    question: "Which club did Arsenal beat 3-1 in September 2019?",
    options: { A: "Aston Villa", B: "Everton", C: "Leicester City", D: "West Ham" },
    answer: "B",
    difficulty: "medium",
  };
  assert.ok(shapeViolations(q).some((e) => e.includes('answer must be authored as "A"')));
});

test("shapeViolations: duplicate options are rejected", () => {
  const q = {
    question: "Which club did Arsenal beat 3-1 in September 2019?",
    options: { A: "Aston Villa", B: "Aston Villa", C: "Leicester City", D: "West Ham" },
    answer: "A",
    difficulty: "medium",
  };
  assert.ok(shapeViolations(q).some((e) => e.includes("not distinct")));
});

// ── answerLeakViolations (the answer-in-the-stem gate) ───────────────────────

test("answerLeakViolations: the correct option's text appearing in the stem is a leak", () => {
  const q = {
    question: "Bukayo Saka is the only one of these who scored against Everton. Who is it?",
    options: { A: "Bukayo Saka", B: "Martin Ødegaard", C: "Gabriel Jesus", D: "Kai Havertz" },
    answer: "A",
  };
  assert.ok(answerLeakViolations(q).length > 0);
});

test("answerLeakViolations: club names common to every option do not count as a leak", () => {
  const q = {
    question: "What was the score when Arsenal hosted Coventry City in September 2000?",
    options: { A: "Arsenal 2-1 Coventry City", B: "Arsenal 1-1 Coventry City", C: "Arsenal 3-0 Coventry City", D: "Arsenal 0-1 Coventry City" },
    answer: "A",
  };
  const ignore = buildLeakIgnore(["Arsenal", "Coventry City"]);
  assert.deepEqual(answerLeakViolations(q, ignore), []);
});

// ── currentAffairsViolations (base-only, per textViolations pass==='base') ──

test("currentAffairsViolations: form/injury/league-position language is caught", () => {
  assert.ok(currentAffairsViolations("Who is currently the top scorer this season?").length > 0);
  assert.ok(currentAffairsViolations("Which player is currently injured?").length > 0);
  assert.ok(currentAffairsViolations("Who tops the table right now?").length > 0);
});

test("currentAffairsViolations: an unanchored manager claim is caught, an anchored one is not", () => {
  assert.ok(currentAffairsViolations("Who is Arsenal's manager?").length > 0);
  assert.deepEqual(currentAffairsViolations("Who managed Arsenal in the 2003/04 unbeaten season?"), []);
});

test("currentAffairsViolations: a clean historic question passes", () => {
  assert.deepEqual(currentAffairsViolations("What was the score when they met in 2001?"), []);
});

// ── textViolations (the composite gate validate.mjs calls per-pass) ─────────

const goodQuestion = () => ({
  question: "What was the score when Arsenal hosted Coventry City in September 2000?",
  options: { A: "Arsenal 2-1 Coventry City", B: "Arsenal 1-1 Coventry City", C: "Arsenal 3-0 Coventry City", D: "Arsenal 0-1 Coventry City" },
  answer: "A",
  difficulty: "medium",
  claims: [{ type: "h2h_result", fixture_id: 1, home_goals: 2, away_goals: 1 }],
});

test("textViolations: a well-formed, grounded, historic base question is clean", () => {
  const nameIndex = buildNameIndex([], ["Arsenal", "Coventry City"]);
  assert.deepEqual(textViolations(goodQuestion(), { pass: "base", nameIndex, clubs: ["Arsenal", "Coventry City"] }), []);
});

test("textViolations: pass='base' additionally enforces the current-affairs ban", () => {
  const q = { ...goodQuestion(), question: "Who is currently Arsenal's top scorer this season?" };
  const nameIndex = buildNameIndex([], ["Arsenal", "Coventry City"]);
  const errs = textViolations(q, { pass: "base", nameIndex, clubs: ["Arsenal", "Coventry City"] });
  assert.ok(errs.length > 0);
});

test("textViolations: pass='recap' does NOT enforce the current-affairs ban — a recap question can say 'this gameweek'", () => {
  const q = {
    question: "Which club sat top of the table after Gameweek 7?",
    options: { A: "Arsenal", B: "Liverpool", C: "Manchester City", D: "Chelsea" },
    answer: "A",
    difficulty: "medium",
    claims: [{ type: "h2h_result", fixture_id: 1, home_goals: 2, away_goals: 1 }],
  };
  const nameIndex = buildNameIndex([], ["Arsenal", "Liverpool", "Manchester City", "Chelsea"]);
  assert.deepEqual(textViolations(q, { pass: "recap", nameIndex, clubs: [] }), []);
});

test("textViolations: an ungrounded question is dropped regardless of pass", () => {
  const q = { ...goodQuestion(), claims: [] };
  const nameIndex = buildNameIndex([], ["Arsenal", "Coventry City"]);
  const errs = textViolations(q, { pass: "base", nameIndex, clubs: ["Arsenal", "Coventry City"] });
  assert.ok(errs.some((e) => e.includes("ungrounded")));
});
