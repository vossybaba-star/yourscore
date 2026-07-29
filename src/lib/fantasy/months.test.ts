import { test } from "node:test";
import assert from "node:assert/strict";
import { groupGwsByMonth, monthKeyOf, monthLabel } from "./months";

// ── monthKeyOf: the LAST match (window_end), Europe/London ─────────────────────
test("monthKeyOf: a gameweek is bucketed by its LAST match's calendar month", () => {
  assert.equal(monthKeyOf({ window_end: "2026-10-24" }), "2026-10");
});

test("monthKeyOf: a gameweek that ENDS in the next month counts to that month", () => {
  // Deadline could be 30 Apr, but the last game is 1 May → the gameweek belongs
  // to May. "A gameweek is just its last game" (founder 29 Jul).
  assert.equal(monthKeyOf({ window_end: "2026-05-01" }), "2026-05");
  // ...and one whose last game is 30 Apr stays in April.
  assert.equal(monthKeyOf({ window_end: "2026-04-30" }), "2026-04");
});

// ── monthLabel ──────────────────────────────────────────────────────────────
test("monthLabel: formats a YYYY-MM key as a full month name + year", () => {
  assert.equal(monthLabel("2026-10"), "October 2026");
  assert.equal(monthLabel("2026-01"), "January 2026");
  assert.equal(monthLabel("2026-12"), "December 2026");
});

// ── groupGwsByMonth ─────────────────────────────────────────────────────────
test("groupGwsByMonth: groups gws by month, no gw split across two months", () => {
  const gws = [
    { gw: 1, window_end: "2026-10-05" },
    { gw: 2, window_end: "2026-10-26" },
    { gw: 3, window_end: "2026-05-01" }, // last game 1 May → May
    { gw: 4, window_end: "2026-03-16" },
  ];
  const byMonth = groupGwsByMonth(gws);
  assert.deepEqual(byMonth.get("2026-10"), [1, 2]);
  assert.deepEqual(byMonth.get("2026-05"), [3]);
  assert.deepEqual(byMonth.get("2026-03"), [4]);

  // Every gw appears in exactly one month bucket.
  const seen = new Map<number, number>();
  for (const nums of Array.from(byMonth.values())) {
    for (const n of nums) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  for (const gw of gws) assert.equal(seen.get(gw.gw), 1);
});
