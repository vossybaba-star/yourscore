/**
 * The round gate: a LIVE round opens at midnight UTC on the gameweek's first
 * match day and closes at the deadline; squad edits (isOpenForEdits) keep the
 * deadline-only bound. Replay stays self-paced with no lower bound.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenForEdits, isRoundOpen, roundOpensAt, type GwRow } from "./gameweeks";

const DAY = 24 * 60 * 60 * 1000;

const live = (over: Partial<GwRow> = {}): GwRow => ({
  gw: 1, season: "2026/27", mode: "live",
  window_start: "2026-08-21", window_end: "2026-08-24",
  deadline: "2026-08-21T17:30:00+00:00", status: "open", sm_season_id: 0,
  ...over,
});

const at = (iso: string, fn: () => void) => {
  const real = Date.now;
  Date.now = () => new Date(iso).getTime();
  try { fn(); } finally { Date.now = real; }
};

test("live round is CLOSED weeks before the gameweek, even though edits are open", () => {
  at("2026-08-03T12:00:00Z", () => {
    assert.equal(isOpenForEdits(live(), null), true, "squad edits open all pre-deadline");
    assert.equal(isRoundOpen(live(), null), false, "the quiz is not");
  });
});

test("live round opens at midnight UTC on gameday and closes at the deadline", () => {
  at("2026-08-21T00:00:01Z", () => assert.equal(isRoundOpen(live(), null), true));
  at("2026-08-21T17:29:59Z", () => assert.equal(isRoundOpen(live(), null), true));
  at("2026-08-21T17:30:01Z", () => assert.equal(isRoundOpen(live(), null), false));
});

test("a non-open status closes the round regardless of the clock", () => {
  at("2026-08-21T10:00:00Z", () =>
    assert.equal(isRoundOpen(live({ status: "locked" }), null), false));
});

test("replay has no lower bound and follows the user's own lock", () => {
  const replay = live({ mode: "replay", deadline: null });
  at("2026-08-03T12:00:00Z", () => {
    assert.equal(isRoundOpen(replay, null), true);
    assert.equal(isRoundOpen(replay, { locked_at: "2026-08-01T00:00:00Z" }), false);
  });
});

test("roundOpensAt: midnight UTC of window_start for live, null for replay", () => {
  assert.equal(roundOpensAt(live())!.toISOString(), "2026-08-21T00:00:00.000Z");
  assert.equal(roundOpensAt(live({ mode: "replay" })), null);
  // A window_start that ever arrives as a full timestamp still parses to its day.
  assert.equal(roundOpensAt(live({ window_start: "2026-08-21T00:00:00+00:00" }))!.toISOString(),
    "2026-08-21T00:00:00.000Z");
});

// Guard the day-count sanity: opens strictly before the deadline it feeds.
test("opens is before the deadline", () => {
  const gw = live();
  assert.ok(roundOpensAt(gw)!.getTime() < new Date(gw.deadline!).getTime());
  assert.ok(new Date(gw.deadline!).getTime() - roundOpensAt(gw)!.getTime() < DAY);
});
