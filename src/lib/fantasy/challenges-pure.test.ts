// Extensionless import matches the repo's other lib tests (src/lib/draft/*.test.ts) and keeps
// `tsc --noEmit` clean. Run under the same bare-tsc harness as ops-diff.test.ts / clubKey.test.ts:
//   npx tsc src/lib/fantasy/challenges-pure.ts src/lib/fantasy/challenges-pure.test.ts --outDir /tmp/cpt \
//     --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
//     && node --test /tmp/cpt/challenges-pure.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChallengeMessage, normalizeCreatedFrom, MESSAGE_MAX_LEN, DEFAULT_CREATED_FROM, deriveDuelOutcome, isGamedayPack } from "./challenges-pure";

// ── normalizeChallengeMessage ────────────────────────────────────────────────

test("normalizeChallengeMessage: trims surrounding whitespace", () => {
  const r = normalizeChallengeMessage("  beat this  ");
  assert.deepEqual(r, { ok: true, message: "beat this" });
});

test("normalizeChallengeMessage: strips newlines to a single line", () => {
  const r = normalizeChallengeMessage("line one\nline two\r\nline three");
  assert.deepEqual(r, { ok: true, message: "line one line two line three" });
});

test("normalizeChallengeMessage: no message is fine — null, not rejected", () => {
  assert.deepEqual(normalizeChallengeMessage(undefined), { ok: true, message: null });
  assert.deepEqual(normalizeChallengeMessage(null), { ok: true, message: null });
  assert.deepEqual(normalizeChallengeMessage(""), { ok: true, message: null });
});

test("normalizeChallengeMessage: blank-after-trim collapses to null, not an empty string", () => {
  assert.deepEqual(normalizeChallengeMessage("   \n\n  "), { ok: true, message: null });
});

test("normalizeChallengeMessage: a non-string input is treated as no message", () => {
  assert.deepEqual(normalizeChallengeMessage(42), { ok: true, message: null });
  assert.deepEqual(normalizeChallengeMessage({ text: "hi" }), { ok: true, message: null });
});

test("normalizeChallengeMessage: exactly 140 characters is accepted", () => {
  const msg = "a".repeat(MESSAGE_MAX_LEN);
  const r = normalizeChallengeMessage(msg);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.message, msg);
});

test("normalizeChallengeMessage: over 140 characters is rejected with the exact copy", () => {
  const msg = "a".repeat(MESSAGE_MAX_LEN + 1);
  const r = normalizeChallengeMessage(msg);
  assert.deepEqual(r, { ok: false, error: "Keep the message under 140 characters." });
});

test("normalizeChallengeMessage: the cap is measured AFTER trim/newline-strip, not before", () => {
  // Newlines collapse to single spaces first — a message that's over the cap
  // only counting its raw \n characters must not be rejected once they're gone.
  const raw = "a".repeat(70) + "\n".repeat(80) + "b".repeat(70); // 220 raw chars
  const r = normalizeChallengeMessage(raw);
  // After stripping: "a"x70 + " " (newlines collapse to one run) + "b"x70 = 141 chars — still over.
  assert.equal(r.ok, false);
  // But trimmed-and-collapsed input that lands AT or under the cap must pass,
  // even though the raw string was longer than 140.
  const raw2 = "a".repeat(60) + "\n".repeat(50) + "b".repeat(60); // 170 raw chars
  const r2 = normalizeChallengeMessage(raw2);
  assert.equal(r2.ok, true);
  assert.equal(r2.ok && r2.message!.length, 121); // 60 + 1 (collapsed) + 60
});

// ── normalizeCreatedFrom ──────────────────────────────────────────────────────

test("normalizeCreatedFrom: every whitelisted surface passes through unchanged", () => {
  for (const v of ["member_action", "league_table", "league_chat", "profile", "compare_squads", "social_post"]) {
    assert.equal(normalizeCreatedFrom(v), v);
  }
});

test("normalizeCreatedFrom: an unrecognised value falls back to the default silently", () => {
  assert.equal(normalizeCreatedFrom("some_future_surface"), DEFAULT_CREATED_FROM);
  assert.equal(normalizeCreatedFrom("MEMBER_ACTION"), DEFAULT_CREATED_FROM); // case-sensitive, not fuzzy
});

test("normalizeCreatedFrom: missing/non-string input falls back to the default", () => {
  assert.equal(normalizeCreatedFrom(undefined), DEFAULT_CREATED_FROM);
  assert.equal(normalizeCreatedFrom(null), DEFAULT_CREATED_FROM);
  assert.equal(normalizeCreatedFrom(123), DEFAULT_CREATED_FROM);
});

// ── deriveDuelOutcome ─────────────────────────────────────────────────────

test("deriveDuelOutcome: zero attempts is waiting", () => {
  assert.deepEqual(deriveDuelOutcome([]), { status: "waiting" });
});

test("deriveDuelOutcome: one side missing is waiting, not a result", () => {
  assert.deepEqual(deriveDuelOutcome([{ userId: "a", score: 900 }]), { status: "waiting" });
});

test("deriveDuelOutcome: higher score wins once both attempts exist", () => {
  assert.deepEqual(
    deriveDuelOutcome([{ userId: "a", score: 900 }, { userId: "b", score: 700 }]),
    { status: "completed", winnerId: "a" },
  );
  // Order-independent — the second attempt in can still be the higher score.
  assert.deepEqual(
    deriveDuelOutcome([{ userId: "a", score: 500 }, { userId: "b", score: 800 }]),
    { status: "completed", winnerId: "b" },
  );
});

test("deriveDuelOutcome: an exact tie completes with no winner", () => {
  assert.deepEqual(
    deriveDuelOutcome([{ userId: "a", score: 650 }, { userId: "b", score: 650 }]),
    { status: "completed", winnerId: null },
  );
});

test("deriveDuelOutcome: a third stray attempt row is ignored (only the first two count)", () => {
  // Defensive — the unique(h2h_id, user_id) constraint means this shouldn't
  // happen, but the pure function shouldn't blow up if it somehow did.
  assert.deepEqual(
    deriveDuelOutcome([{ userId: "a", score: 900 }, { userId: "b", score: 100 }, { userId: "c", score: 999 }]),
    { status: "completed", winnerId: "a" },
  );
});

// ── isGamedayPack ─────────────────────────────────────────────────────────

test("isGamedayPack: a fixture pack's metadata.gameday marker matches", () => {
  assert.equal(isGamedayPack({ gameday: { fixture_id: 123, home: "Arsenal", away: "Chelsea" } }), true);
});

test("isGamedayPack: a recap pack's metadata.recap does NOT match", () => {
  assert.equal(isGamedayPack({ recap: { season_id: 1, gameweek: 5 } }), false);
});

test("isGamedayPack: an ordinary pack with no metadata.gameday does not match", () => {
  assert.equal(isGamedayPack({ cover_image: "x.png" }), false);
  assert.equal(isGamedayPack({}), false);
});

test("isGamedayPack: null/undefined/non-object metadata does not match", () => {
  assert.equal(isGamedayPack(null), false);
  assert.equal(isGamedayPack(undefined), false);
  assert.equal(isGamedayPack("gameday"), false);
  assert.equal(isGamedayPack(42), false);
});

test("isGamedayPack: a falsy gameday value does not match", () => {
  assert.equal(isGamedayPack({ gameday: null }), false);
  assert.equal(isGamedayPack({ gameday: false }), false);
});
