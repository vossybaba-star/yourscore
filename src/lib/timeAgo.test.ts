import { test } from "node:test";
import assert from "node:assert/strict";
import { timeAgo } from "./timeAgo";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

test("timeAgo: under a minute reads 'just now'", () => {
  assert.equal(timeAgo(ago(0)), "just now");
  assert.equal(timeAgo(ago(30_000)), "just now");
});

test("timeAgo: a future timestamp clamps to 'just now', never a negative count", () => {
  assert.equal(timeAgo(ago(-5_000)), "just now");
});

test("timeAgo: minutes, singular and plural", () => {
  assert.equal(timeAgo(ago(MIN)), "1 minute ago");
  assert.equal(timeAgo(ago(5 * MIN)), "5 minutes ago");
  assert.equal(timeAgo(ago(59 * MIN)), "59 minutes ago");
});

test("timeAgo: hours, singular and plural", () => {
  assert.equal(timeAgo(ago(HOUR)), "1 hour ago");
  assert.equal(timeAgo(ago(2 * HOUR)), "2 hours ago");
  assert.equal(timeAgo(ago(23 * HOUR)), "23 hours ago");
});

test("timeAgo: days, singular and plural, under a week", () => {
  assert.equal(timeAgo(ago(DAY)), "1 day ago");
  assert.equal(timeAgo(ago(3 * DAY)), "3 days ago");
  assert.equal(timeAgo(ago(6 * DAY)), "6 days ago");
});

test("timeAgo: weeks, from 7 days up to 4 weeks", () => {
  assert.equal(timeAgo(ago(7 * DAY)), "1 week ago");
  assert.equal(timeAgo(ago(14 * DAY)), "2 weeks ago");
  assert.equal(timeAgo(ago(28 * DAY)), "4 weeks ago");
});

test("timeAgo: the drift bug this replaces — a ~40 day old item reads in months, never '40d' or '12 weeks ago'", () => {
  const line = timeAgo(ago(40 * DAY));
  assert.equal(line, "1 month ago");
});

test("timeAgo: a ~3 month old item reads '3 months ago', never a week count", () => {
  assert.equal(timeAgo(ago(90 * DAY)), "3 months ago");
});

test("timeAgo: months, singular and plural, under a year", () => {
  assert.equal(timeAgo(ago(30 * DAY)), "1 month ago");
  assert.equal(timeAgo(ago(180 * DAY)), "6 months ago");
});

test("timeAgo: years, singular and plural", () => {
  assert.equal(timeAgo(ago(365 * DAY)), "1 year ago");
  assert.equal(timeAgo(ago(2 * 365 * DAY)), "2 years ago");
});
