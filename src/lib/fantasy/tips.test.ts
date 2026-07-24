/**
 * tips.ts's first unit tests — covers both the pre-existing groundTips (never
 * tested until this build, per the engineering plan's finding) and the new
 * groundAdvice. Must run with `node --conditions=react-server` (see
 * scripts/fantasy/run-tests.sh) — tips.ts imports "server-only", which throws
 * under plain node.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groundTips, groundAdvice, groundPlayerBlurbs,
  type TipInputs, type AdviceInputs, type AdviceOut, type BlurbPlayerInput,
} from "./tips";
import type { NewsFormRow, NewsClubRun, NewsDoubt, NewsTips } from "./news";
import type { AdvicePayload } from "./advice";

// ── fixtures ──────────────────────────────────────────────────────────────────
const FORM: NewsFormRow[] = [
  { playerId: 1, name: "Palmer", club: "Chelsea", pos: "MID", line: "2 goals + 1 assist in his last 5", points: 34 },
  { playerId: 2, name: "Haaland", club: "Man City", pos: "FWD", line: "4 goals in his last 5", points: 41 },
];
const RUNS: NewsClubRun[] = [
  { clubId: 1, club: "Chelsea", short: "CHE", cells: [{ gw: 1, opponent: "Burnley", oppShort: "BUR", home: true, difficulty: "kind" }] },
];
const DOUBTS: NewsDoubt[] = [];
const TIP_INPUTS: TipInputs = { gw: 1, form: FORM, runs: RUNS, doubts: DOUBTS };

// ── groundTips (previously untested at all) ──────────────────────────────────
test("groundTips: a grounded captain/differential/note survives verbatim", () => {
  const raw: NewsTips = {
    captain: { player: "Palmer", why: "He has 2 goals and an assist in his last 5, and Chelsea host Burnley." },
    differential: { player: "Haaland", why: "4 goals in his last 5 for Man City." },
    note: "Chelsea's fixture against Burnley looks kind.",
  };
  const grounded = groundTips(raw, TIP_INPUTS);
  assert.ok(grounded);
  assert.equal(grounded!.captain?.player, "Palmer");
  assert.equal(grounded!.differential?.player, "Haaland");
  assert.ok(grounded!.note);
});

test("groundTips: a pick naming a player not in `form` is dropped", () => {
  const raw: NewsTips = { captain: { player: "Salah", why: "In great form." } };
  const grounded = groundTips(raw, TIP_INPUTS);
  assert.equal(grounded, null, "the only field was an invalid pick — nothing survives");
});

test("groundTips: an invented proper noun in 'why' drops that field but keeps the rest", () => {
  const raw: NewsTips = {
    captain: { player: "Palmer", why: "He's in red-hot form against Fulham this week." }, // "Fulham" not in payload
    note: "Chelsea's fixture run looks kind.",
  };
  const grounded = groundTips(raw, TIP_INPUTS);
  assert.ok(grounded);
  assert.equal(grounded!.captain, undefined, "Fulham isn't grounded — the captain pick is dropped");
  assert.ok(grounded!.note, "the unrelated, grounded note still survives");
});

test("groundTips: an unlicensed CLAIM_TERM ('injury') with no proper noun still gets caught", () => {
  const raw: NewsTips = { note: "He's back from his hamstring injury this week." };
  const grounded = groundTips(raw, TIP_INPUTS);
  assert.equal(grounded, null, "no proper noun/number here, but 'injury'/'hamstring' aren't licensed by any doubt");
});

// ── groundAdvice — criterion 3: shortlist-only, exact numeric-id matching ────
const PAYLOAD_NO_AVAILABILITY: AdvicePayload = {
  gameweek: 1,
  user: { bankTenths: 20, credits: 1, chipsHeld: 0, wildcardHeld: 0 },
  squad: [{ name: "Smith", club: "Everton", pos: "DEF", sellTenths: 50, moveScore: 4, availability: null }],
  candidates: [{
    out: { id: 10, name: "Smith", sellTenths: 50 },
    in: {
      id: 20, name: "Jones", priceTenths: 55, moveScore: 9,
      fixtures: [{ opp: "ARS", homeOrAway: "home", difficulty: "kind" }],
      availability: null,
    },
    scoreDelta: 5, paid: "credit", bankAfterTenths: 15,
  }],
  // `recommended` is a required field on every AdvicePayload now — this fixture's
  // tests only exercise `candidates`, so it stays hold-shaped-empty here, exactly
  // what buildAdvicePayload produces when the cron's optimiser call is skipped or
  // fails (see advice.ts's `optimised?` param) — hence `degraded: true` (F7): the
  // optimiser never ran for this fixture, this isn't a genuine hold conclusion.
  recommended: { moves: [], totalGain: 0, hitsTaken: 0, hold: true, degraded: true },
};

// ── the bug this build exists to catch: the optimiser returns a SEQUENCE whose
//    2nd move is only legal after the 1st is applied, so it will NOT generally
//    appear in `candidates` (which only enumerates single swaps from the
//    ORIGINAL squad). A payload with a genuine 2-move `recommended.moves` plan
//    where move 2's pair is absent from `candidates` entirely. ─────────────────
const PAYLOAD_WITH_RECOMMENDED: AdvicePayload = {
  gameweek: 1,
  user: { bankTenths: 5, credits: 2, chipsHeld: 0, wildcardHeld: 0 },
  squad: [
    { name: "Smith", club: "Everton", pos: "DEF", sellTenths: 50, moveScore: 4, availability: null },
    { name: "Old Mid", club: "Fulham", pos: "MID", sellTenths: 100, moveScore: 3, availability: null },
  ],
  // Only move 1's pair is independently legal from the ORIGINAL squad — that's
  // the whole reason `candidates` alone can't carry a 2-move plan.
  candidates: [{
    out: { id: 10, name: "Smith", sellTenths: 50 },
    in: {
      id: 20, name: "Jones", priceTenths: 55, moveScore: 9,
      fixtures: [{ opp: "ARS", homeOrAway: "home", difficulty: "kind" }],
      availability: null,
    },
    scoreDelta: 5, paid: "credit", bankAfterTenths: 15,
  }],
  recommended: {
    moves: [
      {
        position: 1,
        out: { id: 10, name: "Smith", sellTenths: 50 },
        in: {
          id: 20, name: "Jones", priceTenths: 55, moveScore: 9,
          fixtures: [{ opp: "ARS", homeOrAway: "home", difficulty: "kind" }], availability: null,
        },
        paid: "credit", gain: 5,
      },
      {
        // Move 2's OUT (id 30) is the funding leg — a squad member never
        // touched by move 1, sold to afford the premium IN (id 40). Neither
        // (30,40) nor any pairing with 40 appears anywhere in `candidates`
        // above — this pair exists ONLY in `recommended.moves`.
        position: 2,
        out: { id: 30, name: "Old Mid", sellTenths: 100 },
        in: {
          id: 40, name: "Premium Mid", priceTenths: 140, moveScore: 20,
          fixtures: [{ opp: "LIV", homeOrAway: "away", difficulty: "tough" }], availability: null,
        },
        paid: "credit", gain: 12,
      },
    ],
    totalGain: 17, hitsTaken: 0, hold: false, degraded: false,
  },
};

test("groundAdvice: a move whose (outId,inId) pair isn't in the shortlist is dropped, no throw", () => {
  const raw: AdviceOut = { moves: [{ outId: 10, inId: 999, why: "Jones is in great form." }] };
  const inp: AdviceInputs = { payload: PAYLOAD_NO_AVAILABILITY };
  const grounded = groundAdvice(raw, inp);
  assert.equal(grounded, null, "the only move named a pair outside the shortlist — nothing survives, no exception");
});

test("groundAdvice: a real shortlist pair survives, an invented extra pair does not", () => {
  const raw: AdviceOut = {
    moves: [
      // "ARS" is the exact fixture opponent code in the payload — "Arsenal" (the
      // full name) is NOT in the payload and would correctly fail grounding.
      { outId: 10, inId: 20, why: "Jones scores 9 and gets a kind fixture at home to ARS." },
      { outId: 10, inId: 30, why: "A made-up alternative." }, // 30 is not any candidate's inId
    ],
  };
  const grounded = groundAdvice(raw, { payload: PAYLOAD_NO_AVAILABILITY });
  assert.ok(grounded);
  assert.equal(grounded!.moves.length, 1);
  assert.equal(grounded!.moves[0].inId, 20);
});

// ── the bug this build exists to catch ───────────────────────────────────────
test("groundAdvice: a multi-move optimiser sequence survives — move 2's pair exists ONLY in recommended, not candidates", () => {
  const raw: AdviceOut = {
    moves: [
      { outId: 10, inId: 20, why: "step one" },
      { outId: 30, inId: 40, why: "step two, funded by step one" },
    ],
  };
  const grounded = groundAdvice(raw, { payload: PAYLOAD_WITH_RECOMMENDED });
  assert.ok(grounded, "both pairs are real — one from candidates, one from recommended — nothing should be dropped");
  assert.equal(grounded!.moves.length, 2, "if this is 1 (or 0), groundAdvice regressed to candidates-only matching");
  assert.deepEqual(grounded!.moves.map((m) => `${m.outId}:${m.inId}`), ["10:20", "30:40"]);
});

test("groundAdvice: a recommended-only pair (never in candidates) survives on its own", () => {
  const raw: AdviceOut = { moves: [{ outId: 30, inId: 40, why: "the funding leg" }] };
  const grounded = groundAdvice(raw, { payload: PAYLOAD_WITH_RECOMMENDED });
  assert.ok(grounded, "30:40 is a real recommended pair even though it is absent from candidates");
  assert.equal(grounded!.moves.length, 1);
  assert.equal(grounded!.moves[0].outId, 30);
  assert.equal(grounded!.moves[0].inId, 40);
});

// The exact real record pulled live from FPL's bootstrap-static during build
// prep (player id 3, "Hein") — used verbatim per the engineering plan, not a
// synthetic string. (Was also used to build a whole AdvicePayload for
// groundAdvice's own why-grounding, before that moved to groundPlayerBlurbs —
// see BLURB_HEIN below, which uses it directly.)
const REAL_NEWS = "Has joined Werder Bremen on loan for the rest of the season.";

// ── groundAdvice no longer grounds "why" at all (cost defect S4) — the model
//    isn't asked for one any more (see the tool schema), and any "why" it
//    still sends anyway (a hand-built raw object simulating that) is simply
//    never read: the field the user sees is attached afterwards in
//    generateAdvice, from the pre-drafted, pre-grounded blurb map. ──────────
test("groundAdvice: a move's own 'why' is ignored entirely — a shortlist-valid pair survives regardless of its (unused) prose", () => {
  const raw: AdviceOut = {
    moves: [{ outId: 10, inId: 20, why: "Jones is finally back from his hamstring injury." }],
  };
  const grounded = groundAdvice(raw, { payload: PAYLOAD_NO_AVAILABILITY });
  assert.ok(grounded, "the pair is a real shortlist entry — it survives even though the hand-built 'why' is an unlicensed claim");
  assert.equal(grounded!.moves.length, 1);
  assert.equal(grounded!.moves[0].why, undefined, "groundAdvice itself never populates why — that happens later, from the blurb map");
});

// ── groundPlayerBlurbs — the claim-term/proper-noun grounding that used to
//    live in groundAdvice now lives here, scoped to ONE player's own facts. ──
const BLURB_JONES: BlurbPlayerInput = {
  id: 20, name: "Jones", club: "Everton", pos: "DEF", moveScore: 9,
  fixtures: [{ opp: "ARS", homeOrAway: "home", difficulty: "kind" }],
  availability: null,
};
const BLURB_HEIN: BlurbPlayerInput = {
  id: 21, name: "Hein", club: "Newcastle", pos: "GK", moveScore: 2,
  fixtures: [], availability: { status: "u", chance: 0, news: REAL_NEWS },
};

test("groundPlayerBlurbs: 'injury' with no availability data on that player is dropped", () => {
  const raw = { blurbs: [{ id: 20, why: "Jones is finally back from his hamstring injury." }] };
  const grounded = groundPlayerBlurbs(raw, [BLURB_JONES]);
  assert.equal(grounded.size, 0, "Jones has no availability data — 'injury'/'hamstring' aren't licensed");
});

test("groundPlayerBlurbs: a real FPL news string licenses 'loan'/'joined' for THAT player", () => {
  const raw = { blurbs: [{ id: 21, why: "Hein has joined Werder Bremen on loan, so look elsewhere this week." }] };
  const grounded = groundPlayerBlurbs(raw, [BLURB_HEIN]);
  assert.equal(grounded.get(21), "Hein has joined Werder Bremen on loan, so look elsewhere this week.");
});

test("groundPlayerBlurbs: a blurb can't borrow a fact that only belongs to a DIFFERENT player in the same batch", () => {
  // Hein's own facts license "loan"/"joined"/"Bremen" — but this blurb is
  // attributed to id 20 (Jones), who has no availability of his own. Grounding
  // per-player (not against the whole batch) must still catch this.
  const raw = { blurbs: [{ id: 20, why: "Jones has joined Werder Bremen on loan, so look elsewhere this week." }] };
  const grounded = groundPlayerBlurbs(raw, [BLURB_JONES, BLURB_HEIN]);
  assert.equal(grounded.size, 0, "Jones's own facts don't license 'joined'/'loan'/'Bremen', even though Hein's do");
});

test("groundPlayerBlurbs: an id outside the requested batch is dropped, never printed", () => {
  const raw = { blurbs: [{ id: 999, why: "Anything at all." }] };
  const grounded = groundPlayerBlurbs(raw, [BLURB_JONES]);
  assert.equal(grounded.size, 0);
});

test("groundPlayerBlurbs: a grounded line for a real requested id survives", () => {
  const raw = { blurbs: [{ id: 20, why: "Jones gets a kind fixture at home to ARS this week." }] };
  const grounded = groundPlayerBlurbs(raw, [BLURB_JONES]);
  assert.equal(grounded.get(20), "Jones gets a kind fixture at home to ARS this week.");
});

// ── groundAdvice — closed enums are membership-checked, not trusted ──────────
test("groundAdvice: hitVerdict/chipVerdict on the enum are kept", () => {
  const raw: AdviceOut = { moves: [], hitVerdict: "wait", chipVerdict: "hold" };
  const grounded = groundAdvice(raw, { payload: PAYLOAD_NO_AVAILABILITY });
  assert.ok(grounded, "even with zero moves, a real verdict is content worth keeping");
  assert.equal(grounded!.hitVerdict, "wait");
  assert.equal(grounded!.chipVerdict, "hold");
});

test("groundAdvice: a verdict OFF the enum is dropped, never rendered", () => {
  // The tool schema declares these enums, but that schema is enforced on
  // someone else's server. Our render path does its own check.
  const raw = {
    moves: [],
    hitVerdict: "definitely take the hit mate",
    chipVerdict: "play-triple-captain",
  } as unknown as AdviceOut;
  const grounded = groundAdvice(raw, { payload: PAYLOAD_NO_AVAILABILITY });
  assert.equal(grounded, null, "both verdicts bogus and no moves/summary → nothing to show");
});

test("groundAdvice: a bogus verdict is dropped without taking a good one with it", () => {
  const raw = {
    moves: [], hitVerdict: "wait", chipVerdict: "burn-it",
  } as unknown as AdviceOut;
  const grounded = groundAdvice(raw, { payload: PAYLOAD_NO_AVAILABILITY });
  assert.ok(grounded);
  assert.equal(grounded!.hitVerdict, "wait");
  assert.equal(grounded!.chipVerdict, undefined);
});

test("groundAdvice: truly empty output (no moves, no verdicts, no summary) grounds to null", () => {
  const grounded = groundAdvice({ moves: [] }, { payload: PAYLOAD_NO_AVAILABILITY });
  assert.equal(grounded, null);
});
