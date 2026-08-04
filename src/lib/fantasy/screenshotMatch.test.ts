import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldName, matchExtractedSquad,
  type ExtractedPlayer, type MatchPoolPlayer, type Slot,
} from "./screenshotMatch";

// A hand-built fixture, but the ids/names/clubs/positions below are copied
// verbatim from the real src/data/fantasy/pool.json (checked 4 Aug 2026) — the
// acceptance criterion is that these REAL ids come out the other end, not that
// the fixture is exhaustive.
const REAL_POOL: MatchPoolPlayer[] = [
  { id: 411, name: "Erling Haaland", club: "Man City", clubId: 15, pos: "FWD" },
  { id: 427, name: "Bryan Mbeumo", club: "Man Utd", clubId: 16, pos: "MID" },
  { id: 480, name: "Morgan Gibbs-White", club: "Nott'm Forest", clubId: 18, pos: "MID" },
  { id: 387, name: "Nico O'Reilly", club: "Man City", clubId: 15, pos: "DEF" },
  { id: 503, name: "Micky van de Ven", club: "Spurs", clubId: 19, pos: "DEF" },
  { id: 368, name: "Dominik Szoboszlai", club: "Liverpool", clubId: 14, pos: "MID" },
  { id: 165, name: "João Pedro", club: "Chelsea", clubId: 6, pos: "FWD" },
  { id: 31, name: "Ezri Konsa", club: "Aston Villa", clubId: 2, pos: "DEF" },
  { id: 88, name: "Michael Kayode", club: "Brentford", clubId: 4, pos: "DEF" },
  { id: 250, name: "Bernd Leno", club: "Fulham", clubId: 10, pos: "GK" },
  { id: 346, name: "Dominic Calvert-Lewin", club: "Leeds", clubId: 13, pos: "FWD" },
  { id: 140, name: "Robert Sánchez", club: "Chelsea", clubId: 6, pos: "GK" },
  { id: 124, name: "Pascal Groß", club: "Brighton", clubId: 5, pos: "MID" },
  // Real data quirk this matcher exists to survive: the pool labels this
  // Morgan Rogers as "Chelsea" while the real Morgan Rogers plays for Aston
  // Villa. A screenshot reading his real club must still resolve him — via
  // the global-unique-surname path — never silently, always flagged.
  { id: 40, name: "Morgan Rogers", club: "Chelsea", clubId: 6, pos: "MID" },
];

const bench = (over: Partial<ExtractedPlayer>): ExtractedPlayer => ({
  surname: "", club: "", position: "MID", isCaptain: false, isVice: false, isBench: false, ...over,
});

const slotFor = (slots: Slot[], surname: string): Slot => {
  const s = slots.find((s) => s.extracted.surname === surname);
  assert.ok(s, `no slot for ${surname}`);
  return s;
};

// ── acceptance criterion 1 + 2: the real sample team ─────────────────────

const SAMPLE_TEAM: ExtractedPlayer[] = [
  bench({ surname: "Haaland", club: "Man City", position: "FWD", isCaptain: true }),
  bench({ surname: "Mbeumo", club: "Man Utd", position: "MID" }),
  bench({ surname: "Gibbs-White", club: "Nott'm Forest", position: "MID" }),
  bench({ surname: "O'Reilly", club: "Man City", position: "DEF" }),
  bench({ surname: "Van de Ven", club: "Spurs", position: "DEF" }),
  bench({ surname: "Szoboszlai", club: "Liverpool", position: "MID" }),
  bench({ surname: "João Pedro", club: "Chelsea", position: "FWD" }),
  bench({ surname: "Konsa", club: "Aston Villa", position: "DEF" }),
  bench({ surname: "Kayode", club: "Brentford", position: "DEF" }),
  bench({ surname: "Leno", club: "Fulham", position: "GK" }),
  bench({ surname: "Calvert-Lewin", club: "Leeds", position: "FWD" }),
  bench({ surname: "Sánchez", club: "Chelsea", position: "GK" }),
  bench({ surname: "Groß", club: "Brighton", position: "MID" }),
  // The real club, not the pool's mislabelled one — this must NOT resolve high.
  bench({ surname: "Rogers", club: "Aston Villa", position: "MID" }),
];

const EXPECTED_HIGH: Record<string, number> = {
  Haaland: 411, Mbeumo: 427, "Gibbs-White": 480, "O'Reilly": 387, "Van de Ven": 503,
  Szoboszlai: 368, "João Pedro": 165, Konsa: 31, Kayode: 88, Leno: 250,
  "Calvert-Lewin": 346, "Sánchez": 140, "Groß": 124,
};

test("sample team: every expected surname resolves to its real pool id, high confidence", () => {
  const slots = matchExtractedSquad(SAMPLE_TEAM, REAL_POOL);
  for (const [surname, id] of Object.entries(EXPECTED_HIGH)) {
    const s = slotFor(slots, surname);
    assert.equal(s.id, id, `${surname} -> expected id ${id}, got ${s.id}`);
    assert.equal(s.confidence, "high", `${surname} expected high confidence, flags=${s.flags}`);
    assert.deepEqual(s.flags, [], `${surname} expected no flags, got ${s.flags}`);
  }
});

test("acceptance criterion 2: (Rogers, Aston Villa) resolves to id 40 with clubMismatch, never silently high", () => {
  const slots = matchExtractedSquad(SAMPLE_TEAM, REAL_POOL);
  const rogers = slotFor(slots, "Rogers");
  assert.equal(rogers.id, 40);
  assert.equal(rogers.confidence, "low");
  assert.ok(rogers.flags.includes("clubMismatch"), `expected clubMismatch, got ${rogers.flags}`);
});

// ── acceptance criterion 3: fold cases, isolated ──────────────────────────

test("foldName: accents, ß, ø, apostrophes and hyphens all fold to plain a-z", () => {
  assert.equal(foldName("á"), "a");
  assert.equal(foldName("ß"), "ss");
  assert.equal(foldName("ø"), "o");
  assert.equal(foldName("Groß"), "gross");
  assert.equal(foldName("Sánchez"), "sanchez");
  assert.equal(foldName("O'Reilly"), "oreilly");
  assert.equal(foldName("Gibbs-White"), "gibbswhite");
  assert.equal(foldName("van de Ven"), "vandeven");
  assert.equal(foldName("João Pedro"), "joaopedro");
});

test("fold case: João Pedro (two-word mononym) resolves via the whole-name key", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "João Pedro", club: "Chelsea", position: "FWD" })], REAL_POOL,
  );
  assert.equal(slots[0].id, 165);
  assert.equal(slots[0].confidence, "high");
});

test("fold case: Gibbs-White resolves through the hyphen", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "Gibbs-White", club: "Nott'm Forest", position: "MID" })], REAL_POOL,
  );
  assert.equal(slots[0].id, 480);
  assert.equal(slots[0].confidence, "high");
});

test("fold case: O'Reilly resolves through the apostrophe", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "O'Reilly", club: "Man City", position: "DEF" })], REAL_POOL,
  );
  assert.equal(slots[0].id, 387);
  assert.equal(slots[0].confidence, "high");
});

test("fold case: Van de Ven (three-word surname) resolves through the full-tail key", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "Van de Ven", club: "Spurs", position: "DEF" })], REAL_POOL,
  );
  assert.equal(slots[0].id, 503);
  assert.equal(slots[0].confidence, "high");
});

// ── N.Williams-style initial handling (acceptance criterion 3) ───────────
// Real pool.json has only one Williams, so this needs its own small fixture to
// actually exercise the ambiguous-then-initial-disambiguated branch.

const WILLIAMS_POOL: MatchPoolPlayer[] = [
  { id: 9001, name: "Neco Williams", club: "Everton", clubId: 9, pos: "DEF" },
  { id: 9002, name: "Rhys Williams", club: "Everton", clubId: 9, pos: "DEF" },
];

test("fold case: N.Williams — initial disambiguates two same-club, same-position candidates", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "N.Williams", club: "Everton", position: "DEF" })], WILLIAMS_POOL,
  );
  assert.equal(slots[0].id, 9001);
  assert.equal(slots[0].confidence, "high");
  assert.deepEqual(slots[0].flags, []);
});

test("without an initial, the same two candidates fall back to ambiguous + low", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "Williams", club: "Everton", position: "DEF" })], WILLIAMS_POOL,
  );
  assert.equal(slots[0].confidence, "low");
  assert.ok(slots[0].flags.includes("ambiguous"));
  assert.ok(slots[0].id === 9001 || slots[0].id === 9002);
});

// ── posMismatch drops confidence one step, on top of the resolution path ──

test("a position mismatch drops a high-confidence resolution to low and flags it", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "Haaland", club: "Man City", position: "MID" })], REAL_POOL,
  );
  assert.equal(slots[0].id, 411);
  assert.equal(slots[0].confidence, "low");
  assert.ok(slots[0].flags.includes("posMismatch"));
});

// ── unresolved: nothing in the pool matches at all ────────────────────────

test("an unknown surname resolves to a null id, flagged unresolved", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "Nobodyatall", club: "Man City", position: "MID" })], REAL_POOL,
  );
  assert.equal(slots[0].id, null);
  assert.equal(slots[0].confidence, "low");
  assert.deepEqual(slots[0].flags, ["unresolved"]);
});

// ── captain/vice/bench pass through untouched ─────────────────────────────

test("captain, vice and bench flags pass through onto the slot regardless of resolution", () => {
  const slots = matchExtractedSquad(
    [bench({ surname: "Haaland", club: "Man City", position: "FWD", isCaptain: true, isBench: false })],
    REAL_POOL,
  );
  assert.equal(slots[0].isCaptain, true);
  assert.equal(slots[0].isBench, false);
});
