import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAsk, type PushAskState } from "./onboarding";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;
const st = (declines: number, agoMs: number): PushAskState =>
  ({ declines, lastAskAt: NOW - agoMs });

test("granted never asks, however long it has been", () => {
  assert.equal(nextAsk("granted", st(0, 365 * DAY), NOW), false);
});

test("a fresh install is asked immediately", () => {
  assert.equal(nextAsk("prompt", { declines: 0, lastAskAt: 0 }, NOW), true);
});

test("asks on every app open while the OS will still show its dialog", () => {
  // The founder's ask: effectively every time, not once a week.
  for (const declines of [0, 1, 2, 3, 4]) {
    assert.equal(nextAsk("prompt", st(declines, 2 * HOUR), NOW), true,
      `should still ask after ${declines} declines`);
  }
});

test("a resume seconds after a decline does NOT re-show the card", () => {
  // appStateChange fires on tab switches too; without the floor the card
  // flickers straight back after someone taps Maybe later.
  assert.equal(nextAsk("prompt", st(1, 5 * MIN), NOW), false);
  assert.equal(nextAsk("prompt", st(1, 31 * MIN), NOW), true);
});

test("softens to daily once someone has declined enough times", () => {
  assert.equal(nextAsk("prompt", st(5, 2 * HOUR), NOW), false);
  assert.equal(nextAsk("prompt", st(5, 25 * HOUR), NOW), true);
});

test("OS-denied is asked rarely, because the button can only open Settings", () => {
  assert.equal(nextAsk("denied", st(0, 2 * DAY), NOW), false);
  assert.equal(nextAsk("denied", st(0, 15 * DAY), NOW), true);
});

test("declines do not make a denied user asked MORE often", () => {
  assert.equal(nextAsk("denied", st(9, 2 * DAY), NOW), false);
});
