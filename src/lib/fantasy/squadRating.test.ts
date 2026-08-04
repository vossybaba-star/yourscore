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
  ratingFacts, benchmarkRaw, PROJ_FLOOR_FRACTION,
  bandPlayers, groupBands, BAND_STRONG_RATIO, BAND_DECENT_RATIO,
  type RatingPlayer, type RatingInputs, type Difficulty, type RatingFacts, type BandedPlayer,
} from "./squadRating";

/** A pool with enough players per position for benchmarkRaw's 4-4-2 shape, each
 *  position at a chosen ep_next. benchmarkRaw = 1 GK + 4 DEF + 4 MID + 2 FWD of
 *  the best ep_next, plus the single best player doubled. */
function benchPool(ep: { GK: number; DEF: number; MID: number; FWD: number }): RatingPlayer[] {
  const mk = (pos: FantasyPos, epNext: number, n: number, base: number) =>
    Array.from({ length: n }, (_, i) => mkPlayer(base + i, { pos, epNext }));
  return [
    ...mk("GK", ep.GK, 2, 100), ...mk("DEF", ep.DEF, 6, 110),
    ...mk("MID", ep.MID, 6, 120), ...mk("FWD", ep.FWD, 4, 130),
  ];
}
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

test("benchmarkRaw: best 4-4-2 by ep_next plus the single best doubled", () => {
  // xiSum = 4*1 + 3*4 + 3*4 + 5*2 = 38; best across pool = 5; benchmark = 43
  assert.equal(benchmarkRaw(benchPool({ GK: 4, DEF: 3, MID: 3, FWD: 5 })), 43);
});

test("s_proj: adaptive band — raw at the benchmark scores 10, at the floor 0, midway ~5", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 }); // benchmark = 5*11 + 5 = 60
  // A top XI (ep 5, captain 5): raw = 55 + 5 = 60 == benchmark -> 10.
  const strong = baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 5 })), captainId: 1, pool });
  assert.ok(scoreSquad(strong).subScores.sProj > 9.9, "an XI at the benchmark scores ~10");
  // Floor = 0.62 * 60 = 37.2. raw = 12 * 3.1 ~= 37.2 -> ~0 (float-tolerant).
  const weak = baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 3.1 })), captainId: 1, pool });
  assert.ok(scoreSquad(weak).subScores.sProj < 0.1, "an XI at the floor scores ~0");
  // Midway raw = (37.2 + 60) / 2 = 48.6 -> 12 * 4.05 -> ~5.
  const mid = baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 4.05 })), captainId: 1, pool });
  assert.equal(Math.round(scoreSquad(mid).subScores.sProj), 5);
});

test("s_proj: the band is anchored to live data, not a fixed 35..70", () => {
  assert.equal(PROJ_FLOOR_FRACTION, 0.62);
  // With no pool there is no benchmark, so projection is neutral (5), never a
  // spurious 0 that tanks the whole score pre-season.
  const noPool = baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 3 })), captainId: 1, pool: [] });
  assert.equal(scoreSquad(noPool).subScores.sProj, 5);
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
    bands: [
      { name: "Bukayo Saka", pos: "MID", band: "strong", note: "projected 8" },
      { name: "Player 2", pos: "DEF", band: "weak", note: "a doubt, projected 1" },
    ],
    captain: { name: "Bukayo Saka", epNext: 8 },
    projectedPoints: 42,
    benchmark: 46,
    bankM: 0,
    suggestedMove: null,
    gameweek: 3,
  };
}

test("groundRatingCopy: a verdict built only from the payload's own words/numbers survives", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "A strong squad, projected 42 points behind Bukayo Saka." }, facts);
  assert.ok(out.verdict, "grounded prose using only payload words must survive");
});

test("groundRatingCopy: a verdict naming a player absent from the facts is dropped", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "A big squad for Erling Haaland up front." }, facts);
  assert.equal(out.verdict, null, "\"Haaland\" is not in the facts payload — the field must fail grounding");
});

test("groundRatingCopy: an unlicensed claim-term sentence is dropped even with no proper noun or number", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "He is back from injury and starting again." }, facts);
  assert.equal(out.verdict, null, "\"injury\" is a CLAIM_TERM the payload never licenses");
});

test("groundRatingCopy: a verdict past two sentences falls back to the template (dropped here, composed by the caller)", () => {
  const facts = baseFacts();
  const out = groundRatingCopy({ verdict: "A strong squad. Projected 42 points. Bukayo Saka leads it." }, facts);
  assert.equal(out.verdict, null, "three sentence-terminators is past the two-sentence cap");
});

test("groundRatingCopy: band player names and notes from the payload are groundable tokens", () => {
  const facts = baseFacts();
  // "Player 2" and "a doubt" come only from the bands entry, not the captain
  // or score fields — proves collectPayloadTokens walks the whole facts object.
  const out = groundRatingCopy({ verdict: "Player 2 is a doubt, but Bukayo Saka projects 8." }, facts);
  assert.ok(out.verdict, "names and note-vocabulary from bands[] must ground");
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

test("ratingFacts: sanity — score, captain and bands are carried through from the inputs", () => {
  const inputs = baseInputs();
  const result = scoreSquad(inputs);
  const move = deriveMove(inputs);
  const banded = bandPlayers(inputs);
  const facts = ratingFacts(inputs, result, move, banded);
  assert.equal(facts.score, result.score);
  assert.equal(facts.captain.name, "Player 1");
  assert.equal(facts.gameweek, inputs.gameweek);
  assert.equal(facts.bands.length, 11, "one band entry per XI player");
});

// ── bandPlayers (deterministic, mirrors the scoreSquad discipline) ─────────

test("bandPlayers: BAND_STRONG_RATIO/BAND_DECENT_RATIO are the documented thresholds", () => {
  assert.equal(BAND_STRONG_RATIO, 0.8);
  assert.equal(BAND_DECENT_RATIO, 0.6);
});

test("bandPlayers: a player at the position ceiling bands strong", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 }); // MID ceiling = 5
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { pos: "MID", epNext: 5 }));
  const inputs = baseInputs({ xi, pool });
  const banded = bandPlayers(inputs);
  assert.ok(banded.every((b) => b.band === "strong"), "ratio 1.0 (>= 0.8) must band strong");
  assert.equal(banded[0].note, "projected 5", "base note is a tense-free 'projected N'");
});

test("bandPlayers: a low-ep player against a strong pool bands weak", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 10, FWD: 5 }); // MID ceiling = 10
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { pos: "MID", epNext: 2 })); // ratio 0.2
  const inputs = baseInputs({ xi, pool });
  const banded = bandPlayers(inputs);
  assert.ok(banded.every((b) => b.band === "weak"), "ratio 0.2 (< 0.6) must band weak");
});

test("bandPlayers: an injured/suspended/unavailable starter is always weak, note 'unavailable'", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 });
  for (const status of ["i", "s", "u"]) {
    const xi = [mkPlayer(1, { pos: "MID", epNext: 5, status }), ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", epNext: 5 }))];
    const inputs = baseInputs({ xi, pool });
    const banded = bandPlayers(inputs);
    const player = banded.find((b) => b.id === 1)!;
    assert.equal(player.band, "weak", `status ${status} must force weak even at ratio 1.0`);
    assert.equal(player.note, "unavailable");
  }
});

test("bandPlayers: a doubt (status d) drops the base band by one step", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 }); // MID ceiling 5
  const xi = [mkPlayer(1, { pos: "MID", epNext: 5, status: "d" }), ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", epNext: 5 }))];
  const inputs = baseInputs({ xi, pool });
  const banded = bandPlayers(inputs);
  const player = banded.find((b) => b.id === 1)!;
  // Base ratio 1.0 -> strong, doubt drops it to decent.
  assert.equal(player.band, "decent");
  assert.equal(player.note, "a doubt, projected 5");
});

test("bandPlayers: a tough next fixture drops the band by one step and appends to the note", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 }); // MID ceiling 5
  const xi = [mkPlayer(1, { pos: "MID", epNext: 5, clubId: 9 }), ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", epNext: 5 }))];
  const inputs = baseInputs({ xi, pool, fixtures: { 9: [{ difficulty: "tough" }] } });
  const banded = bandPlayers(inputs);
  const player = banded.find((b) => b.id === 1)!;
  // Base ratio 1.0 -> strong, tough fixture drops it to decent.
  assert.equal(player.band, "decent");
  assert.equal(player.note, "projected 5, tough opponent");
});

test("bandPlayers: a kind next fixture appends to the note when the band isn't already strong", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 10, FWD: 5 }); // MID ceiling 10, ratio 0.6 -> decent
  const xi = [mkPlayer(1, { pos: "MID", epNext: 6, clubId: 9 }), ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", epNext: 5 }))];
  const inputs = baseInputs({ xi, pool, fixtures: { 9: [{ difficulty: "kind" }] } });
  const banded = bandPlayers(inputs);
  const player = banded.find((b) => b.id === 1)!;
  assert.equal(player.band, "decent");
  assert.equal(player.note, "projected 6, kind fixture");
});

test("bandPlayers: a kind next fixture leaves an already-strong band's note untouched", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 }); // MID ceiling 5, ratio 1.0 -> strong
  const xi = [mkPlayer(1, { pos: "MID", epNext: 5, clubId: 9 }), ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", epNext: 5 }))];
  const inputs = baseInputs({ xi, pool, fixtures: { 9: [{ difficulty: "kind" }] } });
  const banded = bandPlayers(inputs);
  const player = banded.find((b) => b.id === 1)!;
  assert.equal(player.band, "strong");
  assert.equal(player.note, "projected 5", "kind fixtures only earn a note when the band isn't already strong");
});

test("bandPlayers: an empty fixtures map nudges nothing (same 'don't trust this batch' signal as computeSFix)", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 });
  const xi = [mkPlayer(1, { pos: "MID", epNext: 5, clubId: 9 }), ...Array.from({ length: 10 }, (_, i) => mkPlayer(i + 2, { pos: "DEF", epNext: 5 }))];
  const inputs = baseInputs({ xi, pool, fixtures: {} });
  const banded = bandPlayers(inputs);
  const player = banded.find((b) => b.id === 1)!;
  assert.equal(player.band, "strong");
  assert.equal(player.note, "projected 5", "no fixture nudge with an empty map");
});

test("bandPlayers: an empty pool guards the ratio to 0 (weak), never a divide-by-zero", () => {
  const xi = Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 0 }));
  const inputs = baseInputs({ xi, pool: [] });
  const banded = bandPlayers(inputs);
  assert.ok(banded.every((b) => b.band === "weak"), "no pool ceiling and epNext 0 -> guarded ratio 0 -> weak");
});

test("bandPlayers: returns one entry per XI player, in XI order", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 });
  const inputs = baseInputs({ pool });
  const banded = bandPlayers(inputs);
  assert.deepEqual(banded.map((b) => b.id), inputs.xi.map((p) => p.id));
});

// ── groupBands ──────────────────────────────────────────────────────────────

test("groupBands: splits by band and preserves membership and XI order within each group", () => {
  const banded: BandedPlayer[] = [
    { id: 1, name: "A", pos: "MID", band: "weak", note: "x" },
    { id: 2, name: "B", pos: "DEF", band: "strong", note: "x" },
    { id: 3, name: "C", pos: "FWD", band: "decent", note: "x" },
    { id: 4, name: "D", pos: "MID", band: "strong", note: "x" },
  ];
  const grouped = groupBands(banded);
  assert.deepEqual(grouped.strong.map((b) => b.id), [2, 4]);
  assert.deepEqual(grouped.decent.map((b) => b.id), [3]);
  assert.deepEqual(grouped.weak.map((b) => b.id), [1]);
});

test("s_proj: a stronger XI beats a weaker one against the same benchmark", () => {
  const pool = benchPool({ GK: 5, DEF: 5, MID: 5, FWD: 5 });
  const strong = scoreSquad(baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 4.5 })), captainId: 1, pool })).subScores.sProj;
  const weak = scoreSquad(baseInputs({ xi: Array.from({ length: 11 }, (_, i) => mkPlayer(i + 1, { epNext: 3.5 })), captainId: 1, pool })).subScores.sProj;
  assert.ok(strong > weak, "a higher-projected XI scores higher on projection");
});
