/**
 * fantasy-ops — tests against the pure comparators in ops-diff.ts.
 *
 * ops.ts itself (`import "server-only"`) can't be `require()`d under a plain
 * `node --test` run — the server-only package throws unconditionally outside
 * a React Server Component context. Same wall context.ts hit; same fix: the
 * pure decision logic lives in ops-diff.ts (no server-only, no I/O) and is
 * tested directly here. ops.ts is the thin DB/fetch/Telegram wrapper around it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autosyncEnabled, buildAlertText, dedupeDecision, diffCalendar, diffFacts, fingerprint,
  GUARD_B_TIER, hasLiveData, interpretHoldRead, selectGuardAScope, shouldAutosync,
  type FplElementMeta, type FplEvent, type FplLiveElement, type GwCalRow, type OpsRound, type StoredScoreRow,
} from "./ops-diff";
import { ZERO_FACTS, type FantasyPos, type MatchFacts } from "./values";

// ── Guard A: selectGuardAScope ────────────────────────────────────────────────
test("selectGuardAScope: current (lowest non-final) + next 2, sorted, final excluded", () => {
  const gws: GwCalRow[] = [
    { gw: 3, window_start: "", window_end: "", deadline: null, status: "open", sm_season_id: 1 },
    { gw: 1, window_start: "", window_end: "", deadline: null, status: "final", sm_season_id: 1 },
    { gw: 2, window_start: "", window_end: "", deadline: null, status: "locked", sm_season_id: 1 },
    { gw: 4, window_start: "", window_end: "", deadline: null, status: "open", sm_season_id: 1 },
    { gw: 5, window_start: "", window_end: "", deadline: null, status: "open", sm_season_id: 1 },
  ];
  const scope = selectGuardAScope(gws);
  assert.deepEqual(scope.map((g) => g.gw), [2, 3, 4], "gw1 is final (excluded); 2,3,4 are the next 3 non-final");
});

// ── Guard A: diffCalendar finding types ───────────────────────────────────────
function round(gw: number, fixtures: OpsRound["fixtures"]): OpsRound {
  return { gw, fixtures };
}
const fx = (id: number, startingAt: string | null, clubIds: number[], stateId: number | null = 5) => ({
  id, startingAt, stateId, clubIds, clubNames: clubIds.map((c) => `Club${c}`),
});
/** 10 fixtures, 20 distinct clubs, all on 21 Aug — a clean round. */
function cleanRoundFixtures() {
  const out = [];
  for (let i = 0; i < 10; i++) out.push(fx(i, "2026-08-21 15:00:00", [i * 2 + 1, i * 2 + 2]));
  return out;
}
function baseGw(overrides: Partial<GwCalRow> = {}): GwCalRow {
  return {
    gw: 1, window_start: "2026-08-21", window_end: "2026-08-23",
    deadline: "2026-08-21T13:30:00.000Z", status: "open", sm_season_id: 28083,
    ...overrides,
  };
}

test("diffCalendar: deadline drift — DB deadline far from SM first-kickoff−90m", () => {
  const gw = baseGw({ deadline: "2026-08-21T10:00:00.000Z" }); // way off from 13:30
  const rounds = new Map([[1, round(1, cleanRoundFixtures())]]);
  const findings = diffCalendar([gw], rounds, []);
  assert.ok(findings.some((f) => f.type === "deadline_drift"), "should flag the drift");
});
test("diffCalendar: deadline drift — also checks against FPL's own event deadline", () => {
  const gw = baseGw(); // DB deadline agrees with SM (13:30)
  const rounds = new Map([[1, round(1, cleanRoundFixtures())]]);
  const fplEvents: FplEvent[] = [{ id: 1, deadline_time: "2026-08-21T09:00:00.000Z" }]; // way off
  const findings = diffCalendar([gw], rounds, fplEvents);
  assert.ok(findings.some((f) => f.type === "deadline_drift" && f.detail.includes("FPL event")));
});
test("diffCalendar: within tolerance produces no deadline_drift finding", () => {
  const gw = baseGw();
  const rounds = new Map([[1, round(1, cleanRoundFixtures())]]);
  const fplEvents: FplEvent[] = [{ id: 1, deadline_time: "2026-08-21T13:30:00.000Z" }];
  const findings = diffCalendar([gw], rounds, fplEvents);
  assert.equal(findings.filter((f) => f.type === "deadline_drift").length, 0);
});

test("diffCalendar: out_of_window — a fixture kicking off outside the DB window", () => {
  const gw = baseGw();
  const fixtures = cleanRoundFixtures();
  fixtures[0] = fx(0, "2026-08-30 15:00:00", [1, 2]); // moved out of [21,23] Aug
  const rounds = new Map([[1, round(1, fixtures)]]);
  const findings = diffCalendar([gw], rounds, []);
  const f = findings.find((x) => x.type === "out_of_window");
  assert.ok(f, "should catch a fixture that moved out of the window");
  assert.match(f!.detail, /fixture 0/);
});

test("diffCalendar: bad_state — a currently-locked gw with a postponed/suspended fixture", () => {
  const gw = baseGw({ status: "locked" });
  const fixtures = cleanRoundFixtures();
  fixtures[0] = fx(0, "2026-08-21 15:00:00", [1, 2], 11); // SUSPENDED
  const rounds = new Map([[1, round(1, fixtures)]]);
  const findings = diffCalendar([gw], rounds, []);
  assert.ok(findings.some((f) => f.type === "bad_state" && f.detail.includes("state_id=11")));
});
test("diffCalendar: bad_state is NOT checked on a gw that isn't locked", () => {
  const gw = baseGw({ status: "open" });
  const fixtures = cleanRoundFixtures();
  fixtures[0] = fx(0, "2026-08-21 15:00:00", [1, 2], 11);
  const rounds = new Map([[1, round(1, fixtures)]]);
  const findings = diffCalendar([gw], rounds, []);
  assert.equal(findings.filter((f) => f.type === "bad_state").length, 0);
});

test("diffCalendar: club_count — wrong fixture count and a doubled/missing club", () => {
  const gw = baseGw();
  const fixtures = cleanRoundFixtures().slice(0, 9); // 9 fixtures, not 10
  fixtures[0] = fx(0, "2026-08-21 15:00:00", [1, 3]); // club 3 now appears twice (was 3 vs 4 originally elsewhere)
  const rounds = new Map([[1, round(1, fixtures)]]);
  const findings = diffCalendar([gw], rounds, []);
  assert.ok(findings.some((f) => f.type === "club_count" && f.detail.includes("9 fixtures")));
  assert.ok(findings.some((f) => f.type === "club_count" && f.detail.includes("distinct clubs")));
});

// ── Guard A (BUG 8): FPL deadline check independent of SM kickoff presence ──
test("diffCalendar: no kickoff data yet is a VISIBLE finding, not a silent skip — and the FPL check still runs", () => {
  const gw = baseGw();
  const fixturesNoKickoff = cleanRoundFixtures().map((f) => ({ ...f, startingAt: null }));
  const rounds = new Map([[1, round(1, fixturesNoKickoff)]]);
  const fplEvents: FplEvent[] = [{ id: 1, deadline_time: "2026-08-21T09:00:00.000Z" }]; // way off DB's 13:30
  const findings = diffCalendar([gw], rounds, fplEvents);
  assert.ok(findings.some((f) => f.type === "no_kickoff_data"), "must surface, not silently skip");
  assert.ok(
    findings.some((f) => f.type === "deadline_drift" && f.detail.includes("FPL event")),
    "the FPL cross-check must run even though SM hasn't published kickoff times yet",
  );
});

// ── Guard A: autosync eligibility ─────────────────────────────────────────────
test("shouldAutosync: only status=open with a future deadline is eligible", () => {
  const now = Date.parse("2026-08-01T00:00:00Z");
  assert.equal(shouldAutosync("open", "2026-08-02T00:00:00Z", now), true);
  assert.equal(shouldAutosync("open", "2026-07-31T00:00:00Z", now), false, "deadline already passed");
  assert.equal(shouldAutosync("open", null, now), false, "no deadline to compare against");
  for (const status of ["locked", "scored", "final"]) {
    assert.equal(shouldAutosync(status, "2026-08-02T00:00:00Z", now), false, `${status} is never eligible`);
  }
});
test("autosyncEnabled: default OFF — only the literal string 'true' turns writes on", () => {
  assert.equal(autosyncEnabled(undefined), false);
  assert.equal(autosyncEnabled("false"), false);
  assert.equal(autosyncEnabled("1"), false);
  assert.equal(autosyncEnabled("true"), true);
});

// ── Guard B: hasLiveData (the pre-season empty-elements no-op) ───────────────
test("hasLiveData: null and empty elements are both the pre-season no-op", () => {
  assert.equal(hasLiveData(null), false);
  assert.equal(hasLiveData([]), false);
  assert.equal(hasLiveData([{ id: 1, stats: {} as unknown as FplLiveElement["stats"] }]), true);
});

// ── Guard B: diffFacts RED conditions (each asserts its TIER too — BUG 3+4) ──
const facts = (o: Partial<MatchFacts>): MatchFacts => ({ ...ZERO_FACTS, minutes: 90, ...o });
const liveStats = (o: Partial<FplLiveElement["stats"]>): FplLiveElement["stats"] => ({
  minutes: 90, goals_scored: 0, assists: 0, saves: 0, clean_sheets: 0,
  clearances_blocks_interceptions: 0, tackles: 0, recoveries: 0, defensive_contribution: 0,
  ...o,
});
const posOf = (pos: FantasyPos) => new Map<number, FantasyPos>([[1, pos]]);
const owned5pct = new Map<number, FplElementMeta>([[1, { id: 1, selectedByPercent: 10 }]]);
const unowned = new Map<number, FplElementMeta>([[1, { id: 1, selectedByPercent: 1 }]]);
const pool1 = new Set([1]);
const pool12345 = new Set([1, 2, 3, 4, 5]);

test("diffFacts: goals mismatch on a ≥5%-owned player is HOLD tier", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ goals: 1 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ goals_scored: 2 }) }];
  const findings = diffFacts(stored, live, pool1, owned5pct, posOf("FWD"), new Set());
  const f = findings.find((x) => x.type === "goals" && x.playerId === 1);
  assert.ok(f);
  assert.equal(f!.tier, "hold", "goals mismatch is unambiguous — it's allowed to veto finalise");
});
test("diffFacts: assists mismatch on a ≥5%-owned player is ALERT-only", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ assists: 0 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ assists: 1 }) }];
  const findings = diffFacts(stored, live, pool1, owned5pct, posOf("MID"), new Set());
  const f = findings.find((x) => x.type === "assists" && x.playerId === 1);
  assert.ok(f);
  assert.equal(f!.tier, "alert", "Opta vs FPL assist attribution differs — must never veto finalise alone");
});
test("diffFacts: clean-sheet flag mismatch on a DEF/GK, ≥5% owned, is ALERT-only", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ cleanSheet: 1 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ clean_sheets: 0 }) }];
  const findings = diffFacts(stored, live, pool1, owned5pct, posOf("DEF"), new Set());
  const f = findings.find((x) => x.type === "clean_sheet" && x.playerId === 1);
  assert.ok(f);
  assert.equal(f!.tier, "alert", "60min+subbed vs full-match-conceded definitional slop — must never veto finalise alone");
});
test("diffFacts: clean-sheet mismatch is NOT flagged for a MID/FWD", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ cleanSheet: 1 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ clean_sheets: 0 }) }];
  const findings = diffFacts(stored, live, pool1, owned5pct, posOf("FWD"), new Set());
  assert.equal(findings.filter((f) => f.type === "clean_sheet").length, 0);
});
test("diffFacts: minutes drift on ≥5 players fires ONE ALERT-only minutes finding", () => {
  const stored: StoredScoreRow[] = [1, 2, 3, 4, 5].map((id) => ({ playerId: id, facts: facts({ minutes: 90 }) }));
  const live: FplLiveElement[] = [1, 2, 3, 4, 5].map((id) => ({ id, stats: liveStats({ minutes: 80 }) })); // Δ10 each
  const findings = diffFacts(stored, live, pool12345, new Map(), new Map(), new Set());
  const minutesFindings = findings.filter((f) => f.type === "minutes");
  assert.equal(minutesFindings.length, 1);
  assert.equal(minutesFindings[0].tier, "alert", "a broad minutes drift pages the founder but never vetoes finalise alone");
});
test("diffFacts: minutes drift on only 4 players does NOT fire", () => {
  const stored: StoredScoreRow[] = [1, 2, 3, 4].map((id) => ({ playerId: id, facts: facts({ minutes: 90 }) }));
  const live: FplLiveElement[] = [1, 2, 3, 4].map((id) => ({ id, stats: liveStats({ minutes: 80 }) }));
  const findings = diffFacts(stored, live, pool12345, new Map(), new Map(), new Set());
  assert.equal(findings.filter((f) => f.type === "minutes").length, 0);
});
test("diffFacts: dc/dcr drift beyond ±2 tolerance is ALERT-only", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ dc: 10, dcRec: 12 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ clearances_blocks_interceptions: 3, tackles: 2, defensive_contribution: 9 }) }];
  // fplDc = 3+2=5, ourDc=10 → Δ5 > 2 → finding. fplDcr=9, ourDcRec=12 → Δ3 > 2 → finding.
  const findings = diffFacts(stored, live, pool1, new Map(), new Map(), new Set());
  const dcFindings = findings.filter((f) => f.type === "dc");
  assert.equal(dcFindings.length, 2);
  assert.ok(dcFindings.every((f) => f.tier === "alert"), "dc is position-insensitive and our own approximation — never vetoes alone");
});
test("diffFacts: dc/dcr drift WITHIN ±2 tolerance does not fire", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ dc: 10, dcRec: 12 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ clearances_blocks_interceptions: 6, tackles: 3, defensive_contribution: 11 }) }];
  // fplDc = 9, ourDc = 10 → Δ1. fplDcr = 11, ourDcRec = 12 → Δ1.
  const findings = diffFacts(stored, live, pool1, new Map(), new Map(), new Set());
  assert.equal(findings.filter((f) => f.type === "dc").length, 0);
});
test("diffFacts: coverage (owned, 0-min) is HOLD tier", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ minutes: 0 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ minutes: 90 }) }];
  const findings = diffFacts(stored, live, pool1, new Map(), new Map(), new Set([1]));
  const f = findings.find((x) => x.type === "coverage");
  assert.ok(f);
  assert.equal(f!.tier, "hold", "a real manager's pick showing a blank score is unambiguous — allowed to veto");
});
test("GUARD_B_TIER: exactly goals + coverage are HOLD; assists/clean_sheet/minutes/dc are ALERT-only", () => {
  assert.equal(GUARD_B_TIER.goals, "hold");
  assert.equal(GUARD_B_TIER.coverage, "hold");
  for (const t of ["assists", "clean_sheet", "minutes", "dc"] as const) {
    assert.equal(GUARD_B_TIER[t], "alert", `${t} must never veto finalise on its own`);
  }
});

// ── Guard B (BUG 1): pool-scoping ─────────────────────────────────────────────
test("diffFacts: pool-scoping — a >5%-owned FPL player who ISN'T in our pool never fires (the Diop case)", () => {
  // 21.4% owned on FPL, a real goals mismatch by the raw numbers, but he's one
  // of the ~36 FPL players not in our 522-player pool — must be silent.
  const stored: StoredScoreRow[] = []; // never ingested — not our player
  const live: FplLiveElement[] = [{ id: 999, stats: liveStats({ goals_scored: 1 }) }];
  const meta = new Map<number, FplElementMeta>([[999, { id: 999, selectedByPercent: 21.4 }]]);
  const poolIds = new Set<number>([1, 2, 3]); // 999 is not a member
  const findings = diffFacts(stored, live, poolIds, meta, new Map(), new Set());
  assert.equal(findings.length, 0, "an FPL-only player must never trip a false RED, let alone a false hold");
});
test("diffFacts: pool-scoping — the SAME player fires once he's actually in the pool", () => {
  const stored: StoredScoreRow[] = [{ playerId: 999, facts: facts({ goals: 0 }) }];
  const live: FplLiveElement[] = [{ id: 999, stats: liveStats({ goals_scored: 1 }) }];
  const meta = new Map<number, FplElementMeta>([[999, { id: 999, selectedByPercent: 21.4 }]]);
  const poolIds = new Set<number>([999]);
  const findings = diffFacts(stored, live, poolIds, meta, new Map(), new Set());
  assert.ok(findings.some((f) => f.type === "goals" && f.playerId === 999 && f.tier === "hold"));
});
test("diffFacts: pool-scoping applies to minutes-drift and dc too, not just goals/assists/CS", () => {
  // 5 out-of-pool players all drift >5 minutes — must not count toward the
  // aggregate minutes finding, and their dc drift must not fire either.
  const stored: StoredScoreRow[] = [901, 902, 903, 904, 905].map((id) => ({ playerId: id, facts: facts({ minutes: 90, dc: 10 }) }));
  const live: FplLiveElement[] = [901, 902, 903, 904, 905].map((id) => ({ id, stats: liveStats({ minutes: 0, clearances_blocks_interceptions: 0, tackles: 0 }) }));
  const poolIds = new Set<number>(); // none of them are in the pool
  const findings = diffFacts(stored, live, poolIds, new Map(), new Map(), new Set());
  assert.equal(findings.length, 0);
});
test("diffFacts: an owned pick is still checked even in a hypothetical pool/live mismatch (belt-and-braces)", () => {
  // ownedIds is unioned in regardless of poolIds — a real manager's pick must
  // never go unchecked just because pool.json and this run disagree.
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ minutes: 0 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ minutes: 90 }) }];
  const poolIds = new Set<number>(); // deliberately empty
  const findings = diffFacts(stored, live, poolIds, new Map(), new Map(), new Set([1]));
  assert.ok(findings.some((f) => f.type === "coverage" && f.playerId === 1));
});

// ── Guard B: selected_by_percent≥5 filter vs coverage-uses-ownership ─────────
test("diffFacts: a <5%-owned player's goals mismatch is filtered out", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ goals: 0 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ goals_scored: 1 }) }];
  const findings = diffFacts(stored, live, pool1, unowned, posOf("FWD"), new Set()); // not a real manager's pick either
  assert.equal(findings.length, 0, "below the familiarity floor and nobody owns him — quiet");
});
test("diffFacts: the SAME <5%-owned player still fires coverage if a real manager owns him and shows 0 min", () => {
  const stored: StoredScoreRow[] = [{ playerId: 1, facts: facts({ minutes: 0, goals: 0 }) }];
  const live: FplLiveElement[] = [{ id: 1, stats: liveStats({ minutes: 90, goals_scored: 1 }) }];
  const findings = diffFacts(stored, live, pool1, unowned, posOf("FWD"), new Set([1])); // owned by a real manager
  assert.ok(findings.some((f) => f.type === "coverage" && f.playerId === 1),
    "coverage is ownership-gated, not percent-gated — a real squad showing a blank is never quiet");
  assert.equal(findings.filter((f) => f.type === "goals").length, 0, "goals mismatch is still filtered — separate gate");
});

// ── fingerprint dedupe ─────────────────────────────────────────────────────────
test("fingerprint: identical finding sets hash identically, structurally different sets differ", () => {
  const a = [{ type: "goals", playerId: 1, ourValue: 0, fplValue: 1 }];
  const b = [{ type: "goals", playerId: 1, ourValue: 0, fplValue: 1 }];
  const c = [{ type: "goals", playerId: 2, ourValue: 0, fplValue: 1 }];
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(c));
});
test("dedupeDecision: unchanged → silent, changed → alert, clean → ONE all-clear then quiet", () => {
  const findingsA = [{ type: "deadline_drift", gw: 1, key: "sm:65" }];
  const findingsB = [{ type: "deadline_drift", gw: 1, key: "sm:120" }]; // the drift got worse — structurally different
  const fpA = fingerprint(findingsA);
  const fpB = fingerprint(findingsB);
  const emptyFp = fingerprint([]);

  assert.equal(dedupeDecision(null, findingsA.length, fpA), "alert", "first-ever finding → alert");
  assert.equal(dedupeDecision(fpA, findingsA.length, fpA), "silent", "unchanged next tick → no repeat telegram");
  assert.equal(dedupeDecision(fpA, findingsB.length, fpB), "alert", "findings changed → alert again");
  assert.equal(dedupeDecision(fpB, 0, emptyFp), "clear", "was alerting, now clean → ONE all-clear");
  assert.equal(dedupeDecision(emptyFp, 0, emptyFp), "green", "clean tick AFTER the all-clear → quiet, no repeat");
  assert.equal(dedupeDecision(null, 0, emptyFp), "green", "never alerted, still clean → quiet from the start");
});

// ── fingerprint (BUG 5): stable under row reordering + volatile-text-proof ──
test("fingerprint: STABLE under reordering — fantasy_player_scores has no ORDER BY, so row order isn't guaranteed tick to tick", () => {
  const a = [
    { type: "goals", tier: "hold", playerId: 1, ourValue: 0, fplValue: 1, detail: "our goals 0 vs FPL 1 (12.3% owned)" },
    { type: "assists", tier: "alert", playerId: 2, ourValue: 0, fplValue: 1, detail: "our assists 0 vs FPL 1 (7.1% owned)" },
  ];
  const shuffled = [a[1], a[0]];
  assert.equal(fingerprint(a), fingerprint(shuffled), "same findings, different array order → identical fingerprint");
});
test("fingerprint: does NOT churn when only the volatile display text (ownership %) drifts", () => {
  const a = [{ type: "goals", tier: "hold", playerId: 1, ourValue: 0, fplValue: 1, detail: "our goals 0 vs FPL 1 (12.3% owned)" }];
  const b = [{ type: "goals", tier: "hold", playerId: 1, ourValue: 0, fplValue: 1, detail: "our goals 0 vs FPL 1 (14.9% owned)" }]; // % ticked up overnight
  assert.equal(fingerprint(a), fingerprint(b), "ownership % is display-only — must never churn the dedupe key");
});
test("fingerprint: DOES change when a structural value actually changes", () => {
  const a = [{ type: "goals", tier: "hold", playerId: 1, ourValue: 0, fplValue: 1, detail: "x" }];
  const b = [{ type: "goals", tier: "hold", playerId: 1, ourValue: 0, fplValue: 2, detail: "x" }]; // fplValue changed
  assert.notEqual(fingerprint(a), fingerprint(b), "a real change to the substance must still re-alert");
});

// ── fail-open (BUG 2) ──────────────────────────────────────────────────────────
test("interpretHoldRead: a read error FAILS OPEN — finalise must never stall on the watchdog's own read", () => {
  assert.equal(interpretHoldRead(null, new Error(`column "ops_hold" does not exist`)), false, "migration not applied yet → proceed, not held");
  assert.equal(interpretHoldRead(null, new Error("network blip")), false, "any read error → proceed, not held");
  assert.equal(interpretHoldRead(null, null), false, "no row yet (race) → not held");
  assert.equal(interpretHoldRead({ ops_hold: false }, null), false);
  assert.equal(interpretHoldRead({ ops_hold: true }, null), true, "only an explicit true row ever holds");
});

// ── Telegram truncation (BUG 6) ────────────────────────────────────────────────
test("buildAlertText: truncates to the top N lines + a footer, and stays under Telegram's cap", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `• finding ${i} — a moderately long line of text to bulk this out a bit`);
  const text = buildAlertText("<b>header</b>", lines, "footer text");
  assert.ok(text.length <= 3900, `text is ${text.length} chars, must stay under Telegram's 4096 cap`);
  assert.match(text, /…and \d+ more/);
  assert.match(text, /^<b>header<\/b>/);
  assert.match(text, /footer text$/);
});
test("buildAlertText: short lists pass through untouched — no truncation footer", () => {
  const text = buildAlertText("H", ["a", "b"], "F");
  assert.equal(text, "H\na\nb\nF");
});
