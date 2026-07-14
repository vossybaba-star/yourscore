/**
 * daily-nudge copy-engine tests. Run:
 *   node --test src/lib/notify/daily-nudge.test.ts
 * (Node 24 strips the TS types natively — same as the draft tests.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
// NB: extensionless import matches the repo's other *.test.ts (build-safe under
// tsc `bundler` resolution). To execute this suite on Node 24, run it with a
// `.ts`-extension import or a TS loader — the same caveat as the draft tests.
import { buildDailyNudge, type NudgeContext } from "./daily-nudge";

// A neutral context: not played today, idle 1 day, no hooks, WC pack live.
function base(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    firstName: "Sarah",
    playedToday: false,
    daysSinceLastPlay: 1,
    dayStreak: 0,
    hasFriends: false,
    primaryGame: "quiz",
    aheadName: null,
    aheadGap: null,
    lastPackName: null,
    lastScore: null,
    wcPackLive: true,
    ...overrides,
  };
}

test("already played today → no push", () => {
  assert.equal(buildDailyNudge(base({ playedToday: true, dayStreak: 5 })), null);
});

test("never played → no push (left to onboarding/email)", () => {
  assert.equal(buildDailyNudge(base({ daysSinceLastPlay: null })), null);
});

test("off-cadence idle day → no push (not overkill)", () => {
  // Day 5 is not in NUDGE_DAYS, and no streak → silent.
  assert.equal(buildDailyNudge(base({ daysSinceLastPlay: 5 })), null);
});

test("streak at risk wins over everything, greets by name, counts days", () => {
  const c = buildDailyNudge(base({ dayStreak: 4, aheadName: "Jamie", aheadGap: 100 }));
  assert.ok(c);
  assert.equal(c.kind, "streak");
  assert.match(c.title, /Sarah, keep your streak alive/);
  assert.match(c.body, /4-day run/);
});

test("streak fires even on an off-cadence gap check (streak short-circuits)", () => {
  const c = buildDailyNudge(base({ dayStreak: 2, daysSinceLastPlay: 1 }));
  assert.equal(c?.kind, "streak");
});

test("single-day play is not yet a streak", () => {
  // dayStreak 1 → falls through to the nudge ladder (rival here).
  const c = buildDailyNudge(base({ dayStreak: 1, aheadName: "Jamie", aheadGap: 300 }));
  assert.equal(c?.kind, "rival");
});

test("rival in reach → concrete gap copy", () => {
  const c = buildDailyNudge(base({ aheadName: "Jamie", aheadGap: 420 }));
  assert.equal(c?.kind, "rival");
  assert.match(c.title, /closing in on Jamie/);
  assert.match(c.body, /420 points behind/);
});

test("rival too far → skip to next hook", () => {
  const c = buildDailyNudge(base({ aheadName: "Jamie", aheadGap: 9000, lastPackName: "Prem Legends", lastScore: 1840 }));
  assert.equal(c?.kind, "beat-last");
});

test("beat your last score → references pack + score", () => {
  const c = buildDailyNudge(base({ lastPackName: "Prem Legends", lastScore: 1840 }));
  assert.equal(c?.kind, "beat-last");
  assert.match(c.title, /Can you beat 1,840\?/);
  assert.match(c.body, /Prem Legends/);
});

test("play with friends when they have friends and no stronger hook", () => {
  const c = buildDailyNudge(base({ hasFriends: true }));
  assert.equal(c?.kind, "friends");
});

test("win-back by game for a lapsed WC player (14 days idle)", () => {
  const c = buildDailyNudge(base({ daysSinceLastPlay: 14, primaryGame: "wc" }));
  assert.equal(c?.kind, "winback-wc");
  assert.match(c.title, /Sarah, today's World Cup XI is live/);
});

test("win-back by game for a lapsed 38-0 player", () => {
  const c = buildDailyNudge(base({ daysSinceLastPlay: 30, primaryGame: "38" }));
  assert.equal(c?.kind, "winback-38");
  assert.equal(c.url, "/38-0");
});

test("active-but-idle player with no hook gets the LOCKED WC daily copy verbatim", () => {
  // Day 3 (active range), quiz player, no rival/last/friends → fallback.
  const c = buildDailyNudge(base({ daysSinceLastPlay: 3 }));
  assert.equal(c?.kind, "wc-daily");
  assert.equal(c.title, "World Cup Mastermind Daily is live 🧠");
  assert.equal(c.body, "Draft your XI Now! Nail it and top the board!");
});

test("no WC pack today → light generic nudge, not silence", () => {
  const c = buildDailyNudge(base({ daysSinceLastPlay: 3, wcPackLive: false }));
  assert.equal(c?.kind, "generic");
  assert.equal(c.url, "/play"); // primaryGame quiz
});

test("no first name → ungreeted but still valid copy", () => {
  const c = buildDailyNudge(base({ firstName: null, dayStreak: 3 }));
  assert.equal(c?.kind, "streak");
  assert.match(c.title, /^🔥 Keep your streak alive/);
});
