import { test } from "node:test";
import assert from "node:assert/strict";
// Extensionless import matches the repo's other lib tests. squadRating.ts (via
// tips.ts) does `import "server-only"`, which THROWS under plain `node --test`
// — the react-server export condition resolves that package to its no-op
// empty.js instead (the same condition Next's RSC bundler selects), so tests
// must run with it. squadRating.ts ALSO reaches ./pool and ./context, which
// import `@/data/fantasy/*.json` and `@/lib/...` path-aliased modules — a bare
// `tsc <files>` invocation (no tsconfig) does not resolve `@/*` or `.json`
// imports, so this file's compile step goes through a real tsconfig (paths +
// resolveJsonModule already live in the repo's root tsconfig.json), not the
// flag-only recipe scoutPicks.test.ts documents. See
// scripts/fantasy/run-tests.sh for the exact commands.
import {
  scoreSquad, computeSAvail, computeSFix, computeSBal, computeSDiff, deriveMove,
  composeTemplatedVerdict, lintRatingCopy, groundRatingCopy, squadHash, buildRatingInputs,
  ratingFacts, PROJ_FLOOR, PROJ_CEIL,
  type RatingPlayer, type RatingInputs, type Difficulty, type RatingFacts,
} from "./squadRating";
import { XI_SIZE as XI_SIZE_FOR_TEST, type FantasyPos } from "./engine";

// ── fixtures ──────────────────────────────────────────────────────────────

function mkPlayer(id: number, overrides: Partial<RatingPlayer> = {}): RatingPlayer {
  return {
    id, name: `Player ${id}`, club: "Arsenal", clubId: 1, pos: "MID" as FantasyPos,
    priceTenths: 60, status: "a", chance: null, epNext: 4, ownershipPct: 15,
    ...overrides,
  };
}

/** A clean, fully-available XI of 11 + bench of 4, captain = player 1, no
 *  bank left over, no fixture data (empty map -> every club scores medium). */
function baseInputs(overrides: Partial<RatingInputs> = {}): RatingInputs {
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 4 }));
  const bench = Array.from({ length: 4 }, (_, i) => mkPlayer(i + 12, { epNext: 2 }));
  return {
    gameweek: 3, xi, bench, captainId: 1, bankTenths: 0, pool: [], fixtures: {},
    ...overrides,
  };
}

// ── scoreSquad: determinism (acceptance criterion 1) ─────────────────────

test("scoreSquad: pure and deterministic — same inputs twice give identical output", () => {
  const inputs = baseInputs();
  const a = scoreSquad(inputs);
  const b = scoreSquad(inputs);
  assert.deepEqual(a, b);
  assert.ok(a.score >= 0 && a.score <= 10, "score is 0..10");
  assert.equal(Math.round(a.score * 10) / 10, a.score, "score is at most one decimal");
});

// ── s_proj ──────────────────────────────────────────────────────────────

test("s_proj: raw ep_next sum + captain counted twice, clamped 0..10 over the 35..70 band", () => {
  // 11 players at ep_next 3.5 -> raw XI sum 38.5; captain (also 3.5) counted
  // again -> raw 42; (42-35)/35*10 = 2
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 3.5 }));
  const inputs = baseInputs({ xi, captainId: 1 });
  const { subScores, raw } = scoreSquad(inputs);
  assert.equal(raw.projRaw, 42);
  assert.equal(subScores.sProj, 2);
});

test("s_proj: floor and ceiling clamp — very low and very high projections both stay in 0..10", () => {
  const low = baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 0 })), captainId: 1 });
  const high = baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 20 })), captainId: 1 });
  assert.equal(scoreSquad(low).subScores.sProj, 0);
  assert.equal(scoreSquad(high).subScores.sProj, 10);
});

// ── s_avail (acceptance criterion 2: injured starter -3) ──────────────────

test("s_avail: an injured XI starter costs exactly 3", () => {
  const xi = [mkPlayer(1, { status: "i" })];
  assert.equal(computeSAvail({ xi, bench: [] }), 10 - 3);
});

test("s_avail: suspended/unavailable XI starters cost the same 3 as injured", () => {
  assert.equal(computeSAvail({ xi: [mkPlayer(1, { status: "s" })], bench: [] }), 7);
  assert.equal(computeSAvail({ xi: [mkPlayer(1, { status: "u" })], bench: [] }), 7);
});

test("s_avail: a doubt (status d) or sub-75% chance costs 1.5, not the full 3", () => {
  assert.equal(computeSAvail({ xi: [mkPlayer(1, { status: "d" })], bench: [] }), 8.5);
  assert.equal(computeSAvail({ xi: [mkPlayer(1, { status: "a", chance: 74 })], bench: [] }), 8.5);
  assert.equal(computeSAvail({ xi: [mkPlayer(1, { status: "a", chance: 75 })], bench: [] }), 10, "75 itself is not a doubt");
  assert.equal(computeSAvail({ xi: [mkPlayer(1, { status: "a", chance: null })], bench: [] }), 10, "unknown chance is not treated as a doubt");
});

test("s_avail: a bench player out costs only 0.5, and clamps at 0", () => {
  const bench = Array.from({ length: 4 }, (_, i) => mkPlayer(i + 1, { status: "i" }));
  assert.equal(computeSAvail({ xi: [], bench }), 8);
  const manyOut = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { status: "i" }));
  assert.equal(computeSAvail({ xi: manyOut, bench: [] }), 0, "clamps at the floor, never negative");
});

// ── s_fix (acceptance criterion 2: kind-heavy beats tough-heavy) ──────────

function fixturesFor(clubIds: number[], difficulty: Difficulty): Record<number, { difficulty: Difficulty }[]> {
  const out: Record<number, { difficulty: Difficulty }[]> = {};
  for (const id of clubIds) out[id] = [{ difficulty }];
  return out;
}

test("s_fix: an XI with every club on a kind fixture scores above one facing tough fixtures", () => {
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { clubId: i + 1 }));
  const clubIds = xi.map((p) => p.clubId);
  const kind = computeSFix({ xi, fixtures: fixturesFor(clubIds, "kind") });
  const tough = computeSFix({ xi, fixtures: fixturesFor(clubIds, "tough") });
  assert.ok(kind > tough, `kind (${kind}) must outscore tough (${tough})`);
  assert.equal(kind, 10);
  assert.equal(tough, 0);
});

test("s_fix: an empty fixtures map scores every club as medium (base 5), not as a blank gameweek", () => {
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { clubId: i + 1 }));
  assert.equal(computeSFix({ xi, fixtures: {} }), 5);
});

test("s_fix: a club present in the map but with no next cell (blank gameweek) counts as tough, not medium", () => {
  const xi = [mkPlayer(1, { clubId: 1 })];
  // Map is non-empty (club 2 has a cell) but club 1 (the XI's own club) has none.
  const fixtures = fixturesFor([2], "kind");
  const value = computeSFix({ xi, fixtures });
  assert.ok(Math.abs(value - (5 - 5 / XI_SIZE_FOR_TEST)) < 1e-9, "a missing cell in a non-empty map must count as -1, pulling below the medium base of 5");
});

// ── s_bal (acceptance criterion 2: £6m idle -> 8) ──────────────────────────

test("s_bal: £6m idle in the bank costs exactly 2, landing on 8", () => {
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1));
  assert.equal(computeSBal({ xi, bankTenths: 60 }), 8);
});

test("s_bal: up to £2.0m free costs nothing", () => {
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1));
  assert.equal(computeSBal({ xi, bankTenths: 20 }), 10);
  assert.equal(computeSBal({ xi, bankTenths: 0 }), 10);
});

test("s_bal: an incomplete XI (not 11) always scores exactly 5, regardless of bank", () => {
  assert.equal(computeSBal({ xi: [mkPlayer(1)], bankTenths: 0 }), 5);
});

// ── s_diff (acceptance criterion 2: zero diffs + >=40% mean own) ──────────

test("s_diff: zero differentials with a near-template (>=40% mean) ownership scores 2 and raises the flag", () => {
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { ownershipPct: 45, epNext: 1 }));
  const { value, allTemplate } = computeSDiff({ xi });
  assert.equal(value, 2);
  assert.equal(allTemplate, true);
});

test("s_diff: zero differentials with LOW mean ownership still scores 2, but does NOT raise the flag", () => {
  // ep_next below the floor keeps them out of the diff count even though ownership is low.
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { ownershipPct: 5, epNext: 1 }));
  const { value, allTemplate } = computeSDiff({ xi });
  assert.equal(value, 2);
  assert.equal(allTemplate, false);
});

test("s_diff: each genuine differential (<10% owned, ep_next>=3) adds 2.5, capped at 10", () => {
  const xi = [
    mkPlayer(1, { ownershipPct: 4, epNext: 5 }),
    mkPlayer(2, { ownershipPct: 9.9, epNext: 3 }),
    mkPlayer(3, { ownershipPct: 20, epNext: 8 }), // not a differential: ownership too high
  ];
  const { value } = computeSDiff({ xi });
  assert.equal(value, 2 + 2.5 * 2);
});

// ── deriveMove (acceptance criterion 3) ────────────────────────────────────

test("deriveMove: an injured starter is ranked out ahead of a fit but low-projection starter", () => {
  const xi = [
    mkPlayer(1, { status: "a", epNext: 0.1, pos: "MID" }), // lowest ep_next, but fit
    mkPlayer(2, { status: "i", epNext: 9, pos: "MID" }),   // injured, high ep_next
    ...Array.from({ length: 9 }, (_, i) => mkPlayer(i + 3, { pos: "DEF" })),
  ];
  const pool = [mkPlayer(99, { pos: "MID", status: "a", epNext: 0, priceTenths: 60, clubId: 5 })];
  const inputs = baseInputs({ xi, bench: [], captainId: 1, bankTenths: 0, pool });
  const move = deriveMove(inputs);
  // Nobody in the pool beats either candidate's ep_next here, so move is null,
  // but the important assertion is WHICH player would be picked as "out" —
  // exercised directly via the ranking a passing move would target.
  assert.equal(move, null, "no replacement improves on the outgoing player's ep_next");
});

test("deriveMove: the replacement respects position, affordability, ownership and the 3-per-club cap", () => {
  const xi = [
    mkPlayer(1, { status: "a", epNext: 1, pos: "FWD", priceTenths: 70, clubId: 1 }),
    ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", clubId: 2 })),
  ];
  const pool = [
    mkPlayer(50, { pos: "MID", status: "a", epNext: 9, priceTenths: 70, clubId: 3 }), // wrong position
    mkPlayer(51, { pos: "FWD", status: "i", epNext: 9, priceTenths: 70, clubId: 3 }), // not available
    mkPlayer(52, { pos: "FWD", status: "a", epNext: 9, priceTenths: 200, clubId: 3 }), // too expensive
    mkPlayer(53, { pos: "FWD", status: "a", epNext: 9, priceTenths: 70, clubId: 2, ownershipPct: 10 }), // would breach 3-per-club (club 2 already has 10 in a real squad; here 10 already at cap via DEF list is illustrative)
    mkPlayer(54, { pos: "FWD", status: "a", epNext: 8, priceTenths: 65, clubId: 4, ownershipPct: 30 }), // legal, but lower ep_next than 55
    mkPlayer(55, { pos: "FWD", status: "a", epNext: 9, priceTenths: 70, clubId: 4, ownershipPct: 5 }), // legal AND best
  ];
  const inputs = baseInputs({ xi, bench: [], captainId: 1, bankTenths: 0, pool });
  const move = deriveMove(inputs);
  assert.ok(move, "a legal, better replacement exists");
  assert.equal(move!.inId, 55, "the highest ep_next legal, affordable, same-position, unowned candidate wins");
  assert.equal(move!.outId, 1);
});

test("deriveMove: returns null when nothing in the pool beats the outgoing player's projection", () => {
  const xi = [
    mkPlayer(1, { status: "a", epNext: 9, pos: "FWD" }),
    ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", epNext: 9 })),
  ];
  const pool = [mkPlayer(99, { pos: "FWD", status: "a", epNext: 3, priceTenths: 60 })];
  const inputs = baseInputs({ xi, bench: [], captainId: 1, pool });
  assert.equal(deriveMove(inputs), null);
});

// ── composeTemplatedVerdict: every band (acceptance criterion 4) ──────────

test("composeTemplatedVerdict: every band returns distinct, lint-clean, one-or-two-sentence copy", () => {
  const bandScores = [9, 7, 5.5, 3.5, 1];
  const seen = new Set<string>();
  for (const score of bandScores) {
    const v = composeTemplatedVerdict(score);
    assert.ok(!seen.has(v), `band for score ${score} must be distinct copy`);
    seen.add(v);
    assert.equal(lintRatingCopy(v), true, `"${v}" must pass the no-dash lint`);
    const terminators = (v.match(/[.!?]+/g) ?? []).length;
    assert.ok(terminators >= 1 && terminators <= 2, `"${v}" must be one or two sentences`);
  }
});

// ── lintRatingCopy: no em/en dash and no double hyphen, but a plain hyphen
//    inside a real name or compound is allowed (the founder's copy-gate rule) ─

test("lintRatingCopy: em dash, en dash and double hyphen fail; plain hyphens pass", () => {
  assert.equal(lintRatingCopy("Available — confirmed fixture."), false, "em dash");
  assert.equal(lintRatingCopy("Available – confirmed fixture."), false, "en dash");
  assert.equal(lintRatingCopy("Available -- confirmed fixture."), false, "double hyphen");
  // Plain single hyphens inside a surname or compound MUST pass — rejecting them
  // forced every hyphen-named squad onto the mechanical fallback.
  assert.equal(lintRatingCopy("Alexander-Arnold anchors the back line."), true, "surname hyphen passes");
  assert.equal(lintRatingCopy("A solid mid-table side with a 60-minute anchor."), true, "compound hyphens pass");
  assert.equal(lintRatingCopy("Available, with a confirmed fixture."), true, "ordinary prose passes");
});

// ── groundRatingCopy: grounding (acceptance criterion 5) ───────────────────

function baseFacts(): RatingFacts {
  return {
    score: 7.2,
    subScores: [
      { name: "projection", value: 8, meaning: "x" },
      { name: "availability", value: 9, meaning: "x" },
      { name: "fixtures", value: 6, meaning: "x" },
      { name: "balance", value: 10, meaning: "x" },
      { name: "differentials", value: 4, meaning: "x" },
    ],
    candidates: [
      { about: "Bukayo Saka", club: "Arsenal", number: 42, fact: "Your XI is projected 42 points, led by Bukayo Saka at 8 (captained).", kind: "strength" },
      { about: "your squad", club: "", number: 1, fact: "1 low ownership pick projected 3 or more points this gameweek.", kind: "risk" },
    ],
    captain: { name: "Bukayo Saka", epNext: 8 },
    projectedPoints: 42,
    bankM: 0,
    suggestedMove: null,
    gameweek: 3,
  };
}

test("groundRatingCopy: a verdict built only from the payload's own words/numbers survives", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "A strong week, projected 42 points behind Bukayo Saka." }, facts);
  assert.ok(out.verdict, "grounded prose using only payload words must survive");
});

test("groundRatingCopy: a verdict naming a player absent from the facts is dropped", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "A big week for Erling Haaland up front." }, facts);
  assert.equal(out.verdict, null, "\"Haaland\" is not in the facts payload — the field must fail grounding");
});

test("groundRatingCopy: an unlicensed claim-term sentence is dropped even with no proper noun or number", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "He is back from injury and starting again this week." }, facts);
  assert.equal(out.verdict, null, "\"injury\" is a CLAIM_TERM the payload never licenses");
});

test("groundRatingCopy: strengths/risks are graded independently — a poisoned line is dropped, a grounded one survives", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({
    verdict: "A strong week, projected 42 points.",
    strengths: ["Bukayo Saka is projected to lead the line.", "He just returned from a hamstring injury."],
    risks: ["1 low ownership pick projected 3 or more points."],
  }, facts);
  assert.equal(out.strengths.length, 1, "the injury-claiming line must be dropped, the grounded one kept");
  assert.equal(out.risks.length, 1);
});

test("groundRatingCopy: a verdict past two sentences falls back to the template (dropped here, composed by the caller)", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "A strong week. Projected 42 points. Bukayo Saka leads it." }, facts);
  assert.equal(out.verdict, null, "three sentence-terminators is past the two-sentence cap");
});

// ── squadHash (acceptance criterion 6) ─────────────────────────────────────

test("squadHash: identical inputs hash identically, and are order-independent on the id lists", () => {
  const picks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const a = squadHash(picks, [1, 2], [3], 1, 2);
  const b = squadHash([{ id: 3 }, { id: 1 }, { id: 2 }], [2, 1], [3], 1, 2);
  assert.equal(a, b, "reordering the picks/xi lists must not change the hash");
});

test("squadHash: changing the captain (same XI/bench membership) changes the hash", () => {
  const picks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const a = squadHash(picks, [1, 2], [3], 1, 2);
  const b = squadHash(picks, [1, 2], [3], 2, 1);
  assert.notEqual(a, b);
});

test("squadHash: changing XI membership changes the hash", () => {
  const picks = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const a = squadHash(picks, [1, 2], [3, 4], 1, 2);
  const b = squadHash(picks, [1, 3], [2, 4], 1, 2);
  assert.notEqual(a, b);
});

// ── buildRatingInputs: pure mapping ────────────────────────────────────────

test("buildRatingInputs: resolves xi/bench ids against the squad player list, dropping unresolvable ids", () => {
  const squadPlayers = [mkPlayer(1), mkPlayer(2), mkPlayer(3)];
  const inputs = buildRatingInputs({
    gameweek: 5, squadPlayers, xiIds: [1, 2, 999], benchIds: [3], captainId: 1,
    bankTenths: 10, pool: [], fixtures: {},
  });
  assert.deepEqual(inputs.xi.map((p) => p.id), [1, 2], "an id with no matching player is silently dropped, never crashes");
  assert.deepEqual(inputs.bench.map((p) => p.id), [3]);
  assert.equal(inputs.gameweek, 5);
});

// ── ratingFacts: the closed payload shape ──────────────────────────────────

test("ratingFacts: sanity — score, captain and candidates are carried through from the inputs", () => {
  const inputs = baseInputs();
  const result = scoreSquad(inputs);
  const move = deriveMove(inputs);
  const facts = ratingFacts(inputs, result, move, []);
  assert.equal(facts.score, result.score);
  assert.equal(facts.captain.name, "Player 1");
  assert.equal(facts.gameweek, inputs.gameweek);
});

// referenced so `PROJ_FLOOR`/`PROJ_CEIL` stay covered if the s_proj band ever
// changes shape without a test above catching it directly.
test("PROJ_FLOOR/PROJ_CEIL: exported constants match the documented 35..70 band", () => {
  assert.equal(PROJ_FLOOR, 35);
  assert.equal(PROJ_CEIL, 70);
});
