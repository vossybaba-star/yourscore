import { test } from "node:test";
import assert from "node:assert/strict";
import type { PoolPlayer } from "./engine";
import {
  selectMomentumIdeas, selectFixtureSwingIdeas, selectWatchIdeas, assembleIdeas,
  composeMechanicalBody, resolveIdeasAtReadTime, ideaFacts,
  MOMENTUM_MIN_DELTA, MOMENTUM_MIN_EP, WATCH_MIN_OWNERSHIP, IDEAS_TARGET,
  type SnapLite, type IdeaCandidate, type ScoutIdea, type InsightInput, type DoubtInput,
} from "./scoutLatestSelect";

// ── fixtures ────────────────────────────────────────────────────────────────

function pool(id: number, o: Partial<PoolPlayer> = {}): PoolPlayer {
  return { id, smId: id + 1000, name: `P${id}`, club: "Arsenal", clubId: 1, pos: "MID", priceTenths: 60, ...o };
}
function snap(o: Partial<SnapLite> & { playerId: number }): SnapLite {
  return { team: 1, status: "a", chance: null, epNext: 4, ownershipPct: 10, ...o };
}
function mapById(rows: SnapLite[]): Map<number, SnapLite> {
  return new Map(rows.map((r) => [r.playerId, r]));
}
function poolMap(ps: PoolPlayer[]): Map<number, PoolPlayer> {
  return new Map(ps.map((p) => [p.id, p]));
}

// ── selectMomentumIdeas ──────────────────────────────────────────────────────

test("momentum: a clear ownership climb on an available, projecting player is picked, ranked by climb", () => {
  const players = [pool(1, { name: "Riser" }), pool(2, { name: "BigRiser" })];
  const cur = mapById([
    snap({ playerId: 1, ownershipPct: 12, epNext: 4 }),
    snap({ playerId: 2, ownershipPct: 20, epNext: 4 }),
  ]);
  const prev = new Map([[1, 11.5], [2, 18]]); // +0.5, +2.0
  const out = selectMomentumIdeas(cur, prev, poolMap(players));
  assert.deepEqual(out.map((i) => i.name), ["BigRiser", "Riser"], "ranked by climb, biggest first");
  assert.equal(out[0].kind, "momentum");
  assert.equal(out[0].ownershipDelta, 2);
});

test("momentum: gates out a tiny climb, a low projection, an unavailable player, and a brand-new entry", () => {
  const players = [pool(1), pool(2), pool(3), pool(4)];
  const cur = mapById([
    snap({ playerId: 1, ownershipPct: 10.1, epNext: 4 }),                 // +0.1 < MIN_DELTA
    snap({ playerId: 2, ownershipPct: 12, epNext: MOMENTUM_MIN_EP - 0.1 }), // ep too low
    snap({ playerId: 3, ownershipPct: 15, epNext: 4, status: "i" }),        // injured
    snap({ playerId: 4, ownershipPct: 15, epNext: 4 }),                     // no prev entry
  ]);
  const prev = new Map([[1, 10], [2, 10], [3, 12]]); // 4 absent
  assert.ok(MOMENTUM_MIN_DELTA > 0.1);
  const out = selectMomentumIdeas(cur, prev, poolMap(players));
  assert.equal(out.length, 0, "every candidate is gated out for a distinct reason");
});

// ── selectFixtureSwingIdeas ──────────────────────────────────────────────────

test("fixture swing: resolves the club by clubKey and picks the highest-projected available outfielder", () => {
  // Pool club 'Spurs' must match an insight for 'Tottenham Hotspur' via clubKey aliases.
  const players = [
    pool(9, { name: "SpursGk", club: "Spurs", clubId: 6, pos: "GK" }),
    pool(10, { name: "SpursDef", club: "Spurs", clubId: 6, pos: "DEF" }),
    pool(11, { name: "SpursMid", club: "Spurs", clubId: 6, pos: "MID" }),
    pool(12, { name: "SpursFwdHurt", club: "Spurs", clubId: 6, pos: "FWD" }),
  ];
  const byClubKey = new Map([["spurs", players]]);
  const cur = mapById([
    snap({ playerId: 9, epNext: 7 }),                  // highest ep but a keeper -> excluded
    snap({ playerId: 10, epNext: 5 }),                 // best available outfielder
    snap({ playerId: 11, epNext: 4 }),
    snap({ playerId: 12, epNext: 6, status: "i" }),    // higher ep but injured -> excluded
  ]);
  const insights: InsightInput[] = [{ kind: "fixture-swing", club: "Tottenham Hotspur", body: "Kind run coming." }];
  const out = selectFixtureSwingIdeas(insights, cur, byClubKey);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "SpursDef", "keeper and injured excluded; best available outfielder by projection");
  assert.equal(out[0].fixtureNote, "Kind run coming.");
});

test("fixture swing: only fixture-swing insights count, and only one idea per club", () => {
  const players = [pool(20, { name: "A", clubId: 6, pos: "FWD" }), pool(21, { name: "B", clubId: 6, pos: "MID" })];
  const byClubKey = new Map([["spurs", players]]);
  const cur = mapById([snap({ playerId: 20, epNext: 5 }), snap({ playerId: 21, epNext: 6 })]);
  const insights: InsightInput[] = [
    { kind: "form", club: "Spurs", body: "on a run" },              // wrong kind, ignored
    { kind: "fixture-swing", club: "Spurs", body: "kind run" },
    { kind: "fixture-swing", club: "Spurs", body: "still kind" },   // same club again
  ];
  const out = selectFixtureSwingIdeas(insights, cur, byClubKey);
  assert.equal(out.length, 1, "one idea per club, form insight ignored");
  assert.equal(out[0].name, "B", "the higher-projected of the club's two attackers");
});

// ── selectWatchIdeas ─────────────────────────────────────────────────────────

test("watch: bridges the doubt's smId to the pool player and gates on ownership", () => {
  const owned = pool(30, { name: "Popular", smId: 5030 });
  const fringe = pool(31, { name: "Fringe", smId: 5031 });
  const poolBySmId = new Map([[5030, owned], [5031, fringe]]);
  const cur = mapById([
    snap({ playerId: 30, ownershipPct: WATCH_MIN_OWNERSHIP + 5, status: "d" }),
    snap({ playerId: 31, ownershipPct: WATCH_MIN_OWNERSHIP - 5, status: "d" }),
  ]);
  const doubts: DoubtInput[] = [
    { smId: 5030, name: "Popular", club: "Arsenal", reason: "knock in training" },
    { smId: 5031, name: "Fringe", club: "Arsenal", reason: "rotation risk" },
  ];
  const out = selectWatchIdeas(doubts, cur, poolBySmId);
  assert.equal(out.length, 1, "only the widely-owned doubt clears the gate");
  assert.equal(out[0].name, "Popular");
  assert.equal(out[0].doubtReason, "knock in training");
});

// ── assembleIdeas (diversity, no-dup, dedup, relax) ──────────────────────────

function cand(kind: IdeaCandidate["kind"], playerId: number, rank = 1): IdeaCandidate {
  return {
    kind, playerId, name: `P${playerId}`, club: "Arsenal", clubId: 1, pos: "MID",
    priceTenths: 60, status: "a", chance: null, epNext: 4,
    ownershipPct: 10, ownershipDelta: kind === "momentum" ? 0.5 : null,
    fixtureNote: null, doubtReason: kind === "watch" ? "a doubt" : null, rank,
  };
}

test("assemble: takes one of each kind first for diversity, up to the target", () => {
  const byKind = {
    momentum: [cand("momentum", 1), cand("momentum", 2)],
    fixture_swing: [cand("fixture_swing", 3)],
    watch: [cand("watch", 4)],
  };
  const out = assembleIdeas(byKind, new Set());
  assert.equal(out.length, IDEAS_TARGET);
  assert.deepEqual(out.map((c) => c.kind), ["momentum", "fixture_swing", "watch"], "round-robin diversity, momentum leads");
});

test("assemble: never repeats a player, and fills remaining slots from what's left", () => {
  const byKind = {
    momentum: [cand("momentum", 1), cand("momentum", 2), cand("momentum", 3)],
    fixture_swing: [],
    watch: [],
  };
  const out = assembleIdeas(byKind, new Set());
  assert.deepEqual(out.map((c) => c.playerId), [1, 2, 3], "fills from momentum when other kinds are empty");
  assert.equal(new Set(out.map((c) => c.playerId)).size, out.length, "no player twice");
});

test("assemble: skips a (kind,player) seen in recent days so ideas rotate", () => {
  const byKind = {
    momentum: [cand("momentum", 1), cand("momentum", 2)],
    fixture_swing: [],
    watch: [],
  };
  const recent = new Set(["momentum:1"]); // player 1 ran recently
  const out = assembleIdeas(byKind, recent);
  assert.deepEqual(out.map((c) => c.playerId), [2], "yesterday's idea is skipped, today's is fresh");
});

test("assemble: relaxes dedup rather than returning nothing when everything ran recently", () => {
  const byKind = {
    momentum: [cand("momentum", 1)],
    fixture_swing: [],
    watch: [],
  };
  const recent = new Set(["momentum:1"]);
  const out = assembleIdeas(byKind, recent);
  assert.deepEqual(out.map((c) => c.playerId), [1], "the only available idea shows rather than an empty strip");
});

// ── mechanical copy + facts ──────────────────────────────────────────────────

test("mechanical body: dash-free and states the concrete signal per kind", () => {
  const m = composeMechanicalBody(cand("momentum", 1));
  assert.ok(!/[–—]/.test(m), "no em/en dashes");
  assert.match(m, /Ownership is up/);
  const w = composeMechanicalBody({ ...cand("watch", 2), ownershipPct: 22, doubtReason: "a knock" });
  assert.match(w, /doubt/i);
  assert.match(w, /22\.0%/);
});

test("ideaFacts: rounds the numbers and carries availability as a word", () => {
  const f = ideaFacts({ ...cand("momentum", 1), ownershipPct: 12.345, ownershipDelta: 0.567, epNext: 4.19 });
  assert.equal(f.ownershipPercent, 12.3);
  assert.equal(f.ownershipChange, 0.6);
  assert.equal(f.fplProjection, 4.2);
  assert.equal(f.availability, "available");
});

// ── resolveIdeasAtReadTime ───────────────────────────────────────────────────

function idea(kind: ScoutIdea["kind"], playerId: number): ScoutIdea {
  return {
    id: `${kind}:${playerId}`, kind, playerId, name: `P${playerId}`, club: "Arsenal", clubId: 1,
    pos: "MID", priceTenths: 60, headline: "h", body: "b", cta: "shortlist",
    copySource: "mechanical", facts: ideaFacts(cand(kind, playerId)),
  };
}

test("resolve: drops a now-unavailable buy idea but keeps a watch idea and any unknown", () => {
  const items = [idea("momentum", 1), idea("fixture_swing", 2), idea("watch", 3), idea("momentum", 4)];
  const live = new Map([[1, "i"], [2, "a"], [3, "i"], [4, "a"]]); // 1 injured, 3 (watch) injured
  const out = resolveIdeasAtReadTime(items, live);
  assert.deepEqual(out.map((i) => i.playerId), [2, 3, 4], "injured buy idea dropped; injured watch kept; available kept");
});
