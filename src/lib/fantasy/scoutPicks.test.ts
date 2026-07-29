import { test } from "node:test";
import assert from "node:assert/strict";
// Extensionless import matches the repo's other lib tests (ppg.test.ts et al.)
// and keeps `tsc --noEmit` clean. scoutPicks.ts (via tips.ts) does `import
// "server-only"`, which THROWS under plain `node --test` — the react-server
// export condition resolves that package to its no-op empty.js instead (the
// same condition Next's RSC bundler selects), so tests must run with it:
//
//   rm -rf /tmp/scoutpicks-test && npx tsc \
//     src/lib/fantasy/values.ts src/lib/fantasy/engine.ts src/lib/fantasy/ppg.ts \
//     src/lib/fantasy/pool.ts src/lib/fantasy/news.ts src/lib/fantasy/tips.ts \
//     src/lib/fantasy/captainAssist.ts \
//     src/lib/fantasy/scoutPicks.ts src/lib/fantasy/scoutPicks.test.ts \
//     --rootDir src --outDir /tmp/scoutpicks-test \
//     --module commonjs --moduleResolution node --target es2022 \
//     --esModuleInterop --skipLibCheck --types node \
//   && node --conditions=react-server --test /tmp/scoutpicks-test/lib/fantasy/scoutPicks.test.js
import {
  passesAvailabilityFixtureGate, passesSafeGate, passesGambleOwnership,
  rankCandidates, pickFacts, groundPickCopy, lintCopy, composeMechanicalReasons,
  resolvePickAtReadTime, buildCandidates,
  SCOUT_CATEGORIES, type PickCandidate,
} from "./scoutPicks";
import type { ScoreRow } from "./ppg";
import type { PoolPlayer } from "./engine";
import type { FixtureCtx, FixtureSet } from "./captainAssist";

// ── fixtures: a minimal, fully-available candidate to mutate per test ───────

function candidate(overrides: Partial<PickCandidate> = {}): PickCandidate {
  return {
    playerId: 1, name: "Test Player", club: "Arsenal", pos: "MID",
    priceTenths: 80, status: "a", chance: null,
    fixtureStatus: "confirmed_fixture",
    fixtures: [{ fixture_id: 1, opponent_id: 2, opponent: "Chelsea", home: true }],
    ppg: 6, formPoints: 20, nailedStarts: 5, scoredCount: 5,
    epNext: 5.5, ownershipPct: 12,
    ...overrides,
  };
}

// ── gates ─────────────────────────────────────────────────────────────────

test("base gate: unavailable status fails regardless of everything else", () => {
  assert.equal(passesAvailabilityFixtureGate(candidate({ status: "i" })), false);
});

test("base gate: chance below 75 fails, 75+ and null pass", () => {
  assert.equal(passesAvailabilityFixtureGate(candidate({ chance: 74 })), false);
  assert.equal(passesAvailabilityFixtureGate(candidate({ chance: 75 })), true);
  assert.equal(passesAvailabilityFixtureGate(candidate({ chance: null })), true);
});

test("base gate: only a CONFIRMED fixture passes — unknown and blank both fail", () => {
  assert.equal(passesAvailabilityFixtureGate(candidate({ fixtureStatus: "unknown" })), false);
  assert.equal(passesAvailabilityFixtureGate(candidate({ fixtureStatus: "confirmed_blank" })), false);
  assert.equal(passesAvailabilityFixtureGate(candidate({ fixtureStatus: "confirmed_fixture" })), true);
});

test("Safe gate pre-PPG (cold start): the base gate IS the whole test — no minutes history to demand", () => {
  const c = candidate({ chance: 90, nailedStarts: null }); // would fail the strict in-season test
  assert.equal(passesSafeGate(c, false), true, "cold start never demands a minutes history it can't have");
});

test("Safe gate in-season: requires chance null/100 exactly, not just >=75", () => {
  assert.equal(passesSafeGate(candidate({ chance: 90 }), true), false, "90% is not null/100 — Safe is stricter than the base gate");
  assert.equal(passesSafeGate(candidate({ chance: 100 }), true), true);
  assert.equal(passesSafeGate(candidate({ chance: null }), true), true);
});

test("Safe gate in-season: requires 60'+ in at least 4 of the last 5 scored gameweeks", () => {
  assert.equal(passesSafeGate(candidate({ nailedStarts: 3 }), true), false);
  assert.equal(passesSafeGate(candidate({ nailedStarts: 4 }), true), true);
  assert.equal(passesSafeGate(candidate({ nailedStarts: null }), true), false, "no minutes history in-season fails closed, not open");
});

test("Gamble ownership filter: strictly under 5%, null does not pass", () => {
  assert.equal(passesGambleOwnership(candidate({ ownershipPct: 4.9 })), true);
  assert.equal(passesGambleOwnership(candidate({ ownershipPct: 5 })), false);
  assert.equal(passesGambleOwnership(candidate({ ownershipPct: null })), false);
});

// ── ranking ───────────────────────────────────────────────────────────────

test("rankCandidates: Safe ranks by season PPG descending among gate-passers", () => {
  const pool = [
    candidate({ playerId: 1, ppg: 4, chance: 100, nailedStarts: 5 }),
    candidate({ playerId: 2, ppg: 8, chance: 100, nailedStarts: 5 }),
    candidate({ playerId: 3, ppg: 6, chance: 60, nailedStarts: 5 }), // fails the base gate (chance<75)
  ];
  const ranked = rankCandidates("safe", pool, true);
  assert.deepEqual(ranked.map((c) => c.playerId), [2, 1], "player 3 excluded by the gate, 2 ranks above 1 on PPG");
});

test("rankCandidates: Value ranks by output per £m, not by raw output", () => {
  const pool = [
    candidate({ playerId: 1, ppg: 10, priceTenths: 130, chance: 100, nailedStarts: 5 }), // 10/13 = 0.77
    candidate({ playerId: 2, ppg: 6, priceTenths: 50, chance: 100, nailedStarts: 5 }),   // 6/5 = 1.2
  ];
  const ranked = rankCandidates("value", pool, true);
  assert.deepEqual(ranked.map((c) => c.playerId), [2, 1], "cheaper player with a better rate ranks above the higher raw scorer");
});

test("rankCandidates: exclude keeps categories on distinct players", () => {
  const pool = [candidate({ playerId: 1, ppg: 9, chance: 100, nailedStarts: 5 }), candidate({ playerId: 2, ppg: 5, chance: 100, nailedStarts: 5 })];
  const ranked = rankCandidates("safe", pool, true, new Set([1]));
  assert.deepEqual(ranked.map((c) => c.playerId), [2]);
});

test("rankCandidates: cold start (usePpg=false) ranks Safe and Form by ep_next", () => {
  const pool = [
    candidate({ playerId: 1, epNext: 3, formPoints: null, ppg: null }),
    candidate({ playerId: 2, epNext: 7, formPoints: null, ppg: null }),
  ];
  assert.deepEqual(rankCandidates("safe", pool, false).map((c) => c.playerId), [2, 1]);
  assert.deepEqual(rankCandidates("form", pool, false).map((c) => c.playerId), [2, 1]);
});

// ── pickFacts: signal-appropriate nulling ────────────────────────────────

test("pickFacts: season signal exposes PPG/form/nailedStarts, never fplProjection", () => {
  const facts = pickFacts("safe", candidate(), "season_ppg");
  assert.equal(facts.seasonPointsPerAppearance, 6);
  assert.equal(facts.recentFormPoints, 20);
  assert.equal(facts.nailedStarts, 5);
  assert.equal(facts.fplProjection, null, "cold-start field must stay null under the season signal");
});

test("pickFacts: cold-start signal exposes ONLY fplProjection, everything season-shaped is null", () => {
  const facts = pickFacts("safe", candidate(), "fpl_ep_next_cold_start");
  assert.equal(facts.fplProjection, 5.5);
  assert.equal(facts.seasonPointsPerAppearance, null);
  assert.equal(facts.recentFormPoints, null);
  assert.equal(facts.nailedStarts, null, "no minutes history exists pre-PPG — must not leak a number that isn't real");
});

// ── copy lint: banned terms + em/en dashes ───────────────────────────────

test("lintCopy: banned hype/verdict terms fail, ordinary prose passes", () => {
  assert.equal(lintCopy("You must start him this week."), false);
  assert.equal(lintCopy("An essential pick for your XI."), false);
  assert.equal(lintCopy("This is a guaranteed return."), false);
  assert.equal(lintCopy("An unstoppable run of form."), false);
  assert.equal(lintCopy("6.0 points per appearance this season."), true);
});

test("lintCopy: em dash and en dash fail, an ordinary hyphen does not", () => {
  assert.equal(lintCopy("Available — confirmed fixture."), false, "em dash");
  assert.equal(lintCopy("Available – confirmed fixture."), false, "en dash");
  assert.equal(lintCopy("A 60-minute appearance in a £8.5m player."), true, "plain hyphens are not banned");
});

// ── grounding: valid output passes, a poisoned output is rejected ───────────

test("groundPickCopy: reasons built only from the payload's own words/numbers pass", () => {
  const facts = pickFacts("safe", candidate({ name: "Bukayo Saka", club: "Arsenal", ppg: 6.0 }), "season_ppg");
  const out = groundPickCopy(
    { reasons: ["Available, with a confirmed fixture for Arsenal.", "A strong points per appearance record this season."] },
    facts, false,
  );
  assert.ok(out, "grounded prose using only payload words must survive");
  assert.equal(out?.reasons.length, 2);
});

test("groundPickCopy: a fabricated club name not in the payload is rejected (poisoned model output)", () => {
  const facts = pickFacts("safe", candidate({ name: "Bukayo Saka", club: "Arsenal" }), "season_ppg");
  const out = groundPickCopy(
    { reasons: ["Playing for Liverpool this weekend.", "A reliable points per appearance record."] },
    facts, false,
  );
  // "Liverpool" is not in the payload — that line must be dropped. Only 1
  // survivor remains, which is below the 2-reason floor, so the WHOLE thing
  // is rejected (never a half-empty grounded card).
  assert.equal(out, null, "a name the payload never supplied must fail grounding, forcing the mechanical fallback");
});

test("groundPickCopy: an ungrounded claim term (injury/suspension vocabulary) is rejected even with no proper noun or number", () => {
  const facts = pickFacts("safe", candidate({ name: "Test Player", club: "Arsenal" }), "season_ppg");
  const out = groundPickCopy(
    { reasons: ["He is back from injury and starting again.", "Available, with a confirmed fixture for Arsenal."] },
    facts, false,
  );
  assert.equal(out, null, "\"injury\" is a CLAIM_TERM the payload never licenses — must fail even though it has no capitalised word or integer");
});

test("groundPickCopy: Gamble requires BOTH a reason and a risk — a missing/ungrounded risk fails the whole thing", () => {
  const facts = pickFacts("gamble", candidate({ name: "Test Player", club: "Arsenal", ownershipPct: 2 }), "season_ppg");
  const noRisk = groundPickCopy(
    { reasons: ["Owned by very few FPL managers.", "A confirmed fixture for Arsenal."] },
    facts, true,
  );
  assert.equal(noRisk, null, "requireRisk=true with no risk field must reject");

  const poisonedRisk = groundPickCopy(
    { reasons: ["Owned by very few FPL managers.", "A confirmed fixture for Arsenal."], risk: "He is suspended for two games." },
    facts, true,
  );
  assert.equal(poisonedRisk, null, "\"suspended\" is ungrounded — the risk line fails and takes the whole pick's copy down with it");

  const ok = groundPickCopy(
    { reasons: ["Owned by very few FPL managers.", "A confirmed fixture for Arsenal."], risk: "A low ownership pick with less public form data behind it." },
    facts, true,
  );
  assert.ok(ok?.risk, "a grounded risk line survives");
});

test("groundPickCopy: a reason that reads as hype (banned term) is dropped even though every word is grounded", () => {
  const facts = pickFacts("safe", candidate({ name: "Test Player", club: "Arsenal" }), "season_ppg");
  const out = groundPickCopy(
    {
      reasons: [
        "You must start Test Player this week.", // grounded words, but banned term "must"
        "Available, with a confirmed fixture for Arsenal.",
      ],
    },
    facts, false,
  );
  assert.equal(out, null, "only 1 line survives the lint gate, below the 2-line floor");
});

// ── mechanical fallback: never trips its own lint, always facts-only ───────

test("composeMechanicalReasons: every generated line passes the copy lint, for every category and signal", () => {
  for (const category of SCOUT_CATEGORIES) {
    for (const signal of ["season_ppg", "fpl_ep_next_cold_start"] as const) {
      const c = candidate();
      const { reasons, risk } = composeMechanicalReasons(category, c, signal);
      for (const r of reasons) assert.equal(lintCopy(r), true, `${category}/${signal}: "${r}" must pass the lint`);
      if (risk) assert.equal(lintCopy(risk), true, `${category}/${signal} risk: "${risk}" must pass the lint`);
    }
  }
});

test("composeMechanicalReasons: cold start is always FPL-attributed, never past-tensed as our own stat", () => {
  const { reasons } = composeMechanicalReasons("safe", candidate({ ppg: null, nailedStarts: null }), "fpl_ep_next_cold_start");
  const joined = reasons.join(" ");
  assert.ok(joined.includes("FPL projects"), "the projection must be attributed to FPL by name");
});

test("composeMechanicalReasons: only Gamble carries a risk line", () => {
  for (const category of SCOUT_CATEGORIES) {
    const { risk } = composeMechanicalReasons(category, candidate(), "season_ppg");
    if (category === "gamble") assert.ok(risk);
    else assert.equal(risk, undefined);
  }
});

// ── read-time backup swap ────────────────────────────────────────────────

const CONFIRMED = () => "confirmed_fixture" as const;

test("resolvePickAtReadTime: primary still passing the live gate renders as-is", () => {
  const row = { playerId: 1, backups: [{ playerId: 2 }, { playerId: 3 }] };
  const live = new Map([[1, { status: "a", chance: 100 }], [2, { status: "a", chance: 100 }]]);
  const result = resolvePickAtReadTime(row, live, CONFIRMED);
  assert.deepEqual(result, { playerId: 1, isBackup: false });
});

test("resolvePickAtReadTime: primary now failing falls through to the first passing backup", () => {
  const row = { playerId: 1, backups: [{ playerId: 2 }, { playerId: 3 }] };
  const live = new Map([[1, { status: "i", chance: null }], [2, { status: "a", chance: 100 }], [3, { status: "a", chance: 100 }]]);
  const result = resolvePickAtReadTime(row, live, CONFIRMED);
  assert.deepEqual(result, { playerId: 2, isBackup: true });
});

test("resolvePickAtReadTime: both primary and backup 1 fail, backup 2 renders", () => {
  const row = { playerId: 1, backups: [{ playerId: 2 }, { playerId: 3 }] };
  const live = new Map([[1, { status: "i", chance: null }], [2, { status: "d", chance: 40 }], [3, { status: "a", chance: 100 }]]);
  const result = resolvePickAtReadTime(row, live, CONFIRMED);
  assert.deepEqual(result, { playerId: 3, isBackup: true });
});

test("resolvePickAtReadTime: nobody passes — the card is hidden, never an unapproved player", () => {
  const row = { playerId: 1, backups: [{ playerId: 2 }, { playerId: 3 }] };
  const live = new Map([[1, { status: "i", chance: null }], [2, { status: "i", chance: null }], [3, { status: "i", chance: null }]]);
  assert.equal(resolvePickAtReadTime(row, live, CONFIRMED), null);
});

test("resolvePickAtReadTime: a player absent from the newest snapshot is treated as failing, not as passing", () => {
  const row = { playerId: 1, backups: [] as { playerId: number }[] };
  const live = new Map<number, { status: string; chance: number | null }>(); // player 1 not in the newest snapshot at all
  assert.equal(resolvePickAtReadTime(row, live, CONFIRMED), null);
});

test("resolvePickAtReadTime: fixture status changing to unknown/blank at read time fails the primary", () => {
  const row = { playerId: 1, backups: [] as { playerId: number }[] };
  const live = new Map([[1, { status: "a", chance: 100 }]]);
  assert.equal(resolvePickAtReadTime(row, live, () => "confirmed_blank"), null);
});

// ── buildCandidates: minutes/points aggregation from fantasy_player_scores ──

test("buildCandidates: nailedStarts counts 60'+ appearances in the last 5 scored gameweeks only, most recent first", () => {
  const pool = new Map<number, PoolPlayer>([[1, { id: 1, smId: 1, name: "P", club: "Arsenal", clubId: 1, pos: "MID", priceTenths: 80 }]]);
  const fixtureSet: FixtureSet = { byTeam: new Map<number, FixtureCtx[]>(), complete: true, clubs: 0, fixtures: 0 };
  const scores: ScoreRow[] = [
    { gw: 1, player_id: 1, points: 2, minutes: 90 },
    { gw: 2, player_id: 1, points: 2, minutes: 90 },
    { gw: 3, player_id: 1, points: 2, minutes: 30 }, // under 60 — does not count
    { gw: 4, player_id: 1, points: 2, minutes: 90 },
    { gw: 5, player_id: 1, points: 2, minutes: 90 },
    { gw: 6, player_id: 1, points: 10, minutes: 90 }, // most recent — the OLDEST of the "last 5" must drop off
  ];
  const scoresByPlayer = new Map([[1, scores]]);
  const [c] = buildCandidates(
    [{ player_id: 1, web_name: "P", team: null, status: "a", chance_of_playing_next_round: null, ep_next: null, selected_by_percent: null, next_event: 7, next_deadline: null }],
    pool, fixtureSet, scoresByPlayer, true, new Map([[1, 3]]),
  );
  // Last 5 scored = gws 2..6 (gw1 drops off). Of those, gw2(90) gw4(90) gw5(90) gw6(90) qualify, gw3(30) doesn't → 4.
  assert.equal(c.nailedStarts, 4);
  assert.equal(c.formPoints, 2 + 2 + 2 + 2 + 10, "form window is FORM_WINDOW_GWS=5, same 5 most recent scored gameweeks");
});

test("buildCandidates: pre-PPG (usePpg=false) never computes nailedStarts/formPoints — they stay null", () => {
  const pool = new Map<number, PoolPlayer>([[1, { id: 1, smId: 1, name: "P", club: "Arsenal", clubId: 1, pos: "MID", priceTenths: 80 }]]);
  const fixtureSet: FixtureSet = { byTeam: new Map<number, FixtureCtx[]>(), complete: true, clubs: 0, fixtures: 0 };
  const [c] = buildCandidates(
    [{ player_id: 1, web_name: "P", team: null, status: "a", chance_of_playing_next_round: null, ep_next: 4.2, selected_by_percent: "1.5", next_event: 1, next_deadline: null }],
    pool, fixtureSet, new Map(), false, new Map(),
  );
  assert.equal(c.nailedStarts, null);
  assert.equal(c.formPoints, null);
  assert.equal(c.epNext, 4.2);
  assert.equal(c.ownershipPct, 1.5, "selected_by_percent may arrive as a string from Postgres numeric — must coerce");
});
