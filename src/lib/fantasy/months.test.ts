import { test } from "node:test";
import assert from "node:assert/strict";
import { groupGwsByMonth, monthKeyOf, monthLabel } from "./months";

// ── monthKeyOf: deadline (Europe/London) ───────────────────────────────────────
test("monthKeyOf: deadline is bucketed by its Europe/London calendar month", () => {
  // Plain case, no DST edge: 12 Oct 2026 18:30 UTC — during BST (UTC+1), so
  // London local is 19:30 on the same calendar day → October either way.
  assert.equal(
    monthKeyOf({ deadline: "2026-10-12T18:30:00Z", window_start: "2026-10-10" }),
    "2026-10",
  );
});

test("monthKeyOf: month-boundary deadline — UTC instant is still April, but " +
  "London local (BST, UTC+1) has already crossed into May", () => {
  // 30 Apr 2026 23:30 UTC + 1h BST offset = 1 May 2026 00:30 London.
  // Pinned answer: this MUST land in May, not April, or a rescore-safe read of
  // "this month" would silently miss the gameweek whose deadline crossed
  // midnight London time.
  assert.equal(
    monthKeyOf({ deadline: "2026-04-30T23:30:00Z", window_start: "2026-04-28" }),
    "2026-05",
  );
});

test("monthKeyOf: null deadline falls back to window_start", () => {
  // Replay/demo rows never set a deadline.
  assert.equal(
    monthKeyOf({ deadline: null, window_start: "2026-03-15" }),
    "2026-03",
  );
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
    { gw: 1, deadline: "2026-10-03T18:30:00Z", window_start: "2026-10-01" },
    { gw: 2, deadline: "2026-10-24T18:30:00Z", window_start: "2026-10-22" },
    { gw: 3, deadline: "2026-04-30T23:30:00Z", window_start: "2026-04-28" }, // → May, BST
    { gw: 4, deadline: null, window_start: "2026-03-15" },
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
