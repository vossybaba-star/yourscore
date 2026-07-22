import { test } from "node:test";
import assert from "node:assert/strict";
import { gameweekRecipients, resultCopy, resultDedupeKey, ordinal } from "./result";
import type { ClubSupporterRow, HalftimeAttemptRow } from "./table";

/** n fans of one club; `played` many of them post `score`, the rest declared but sat out. */
function club(
  name: string,
  playedScores: number[],
  benched = 0,
): { supporters: ClubSupporterRow[]; attempts: HalftimeAttemptRow[] } {
  const supporters: ClubSupporterRow[] = [];
  const attempts: HalftimeAttemptRow[] = [];
  playedScores.forEach((score, i) => {
    const id = `${name}-p${i}`;
    supporters.push({ userId: id, club: name });
    // Own-club rule: a fan only scores off THEIR club's fixture.
    attempts.push({ userId: id, score, home: name, away: "Opponent FC" });
  });
  for (let i = 0; i < benched; i++) supporters.push({ userId: `${name}-b${i}`, club: name });
  return { supporters, attempts };
}

function merge(...parts: { supporters: ClubSupporterRow[]; attempts: HalftimeAttemptRow[] }[]) {
  return {
    supporters: parts.flatMap((p) => p.supporters),
    attempts: parts.flatMap((p) => p.attempts),
  };
}

test("ordinal handles the teens, which is where naive code breaks", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(11), "11th"); // NOT 11st
  assert.equal(ordinal(12), "12th");
  assert.equal(ordinal(13), "13th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(112), "112th");
});

test("EVERYONE with a declared club is a recipient — players AND the fans who sat out", () => {
  // Arsenal: 5 played, 3 declared-but-benched.
  const { supporters, attempts } = club("Arsenal", [900, 800, 700, 600, 500], 3);
  const { recipients } = gameweekRecipients(supporters, attempts, ["Arsenal", "Chelsea"]);
  assert.equal(recipients.length, 8); // all 8 Arsenal fans
  assert.equal(recipients.filter((r) => r.played).length, 5);
  assert.equal(recipients.filter((r) => !r.played).length, 3);
});

test("a benched fan gets NO personal rank (they've nothing to rank) but still the club result", () => {
  const { supporters, attempts } = club("Arsenal", [900, 800, 700, 600, 500], 1);
  const { recipients } = gameweekRecipients(supporters, attempts, ["Arsenal"]);
  const benched = recipients.find((r) => !r.played)!;
  assert.equal(benched.rankInClub, null);
  assert.equal(benched.clubRank, 1); // still knows the club came 1st
});

test("only fans of clubs that PLAYED this round are messaged (blank-gameweek safety)", () => {
  // Everton declared fans, but Everton has NO fixture this round (not in clubs).
  const arsenal = club("Arsenal", [900, 800, 700, 600, 500]);
  const evertonBenched: ClubSupporterRow[] = [{ userId: "ev1", club: "Everton" }];
  const { recipients } = gameweekRecipients(
    [...arsenal.supporters, ...evertonBenched],
    arsenal.attempts,
    ["Arsenal", "Chelsea"], // Everton not playing
  );
  assert.equal(recipients.some((r) => r.club === "Everton"), false);
});

test("a player with no declared club is a recipient for nobody and pollutes no table", () => {
  const { supporters, attempts } = club("Arsenal", [900, 800, 700, 600, 500]);
  attempts.push({ userId: "nomad", score: 99999, home: "Arsenal", away: "Chelsea" });
  const { recipients, standings } = gameweekRecipients(supporters, attempts, ["Arsenal"]);
  assert.equal(recipients.some((r) => r.userId === "nomad"), false);
  assert.equal(standings.find((s) => s.club === "Arsenal")!.totalScore, 3500);
});

test("rank within the club is by the fan's TOTAL for the week, not one attempt; ties share the better rank", () => {
  const supporters: ClubSupporterRow[] = [
    { userId: "grinder", club: "Arsenal" },
    { userId: "oneshot", club: "Arsenal" },
    { userId: "tieA", club: "Arsenal" },
    { userId: "tieB", club: "Arsenal" },
    { userId: "low", club: "Arsenal" },
  ];
  const attempts: HalftimeAttemptRow[] = [
    // Arsenal in a rare triple-fixture week; every row is an ARSENAL fixture,
    // because only own-club packs score.
    { userId: "grinder", score: 2000, home: "Arsenal", away: "Chelsea" },
    { userId: "grinder", score: 2000, home: "Arsenal", away: "Everton" },
    { userId: "grinder", score: 2000, home: "Arsenal", away: "Fulham" }, // 6000
    { userId: "oneshot", score: 5000, home: "Arsenal", away: "Chelsea" },
    { userId: "tieA", score: 3000, home: "Arsenal", away: "Chelsea" }, { userId: "tieB", score: 3000, home: "Arsenal", away: "Chelsea" },
    { userId: "low", score: 1000, home: "Arsenal", away: "Chelsea" },
  ];
  const { recipients } = gameweekRecipients(supporters, attempts, ["Arsenal"]);
  const rank = (id: string) => recipients.find((r) => r.userId === id)!.rankInClub;
  assert.equal(rank("grinder"), 1); // 6000 total beats the 5000 single
  assert.equal(rank("oneshot"), 2);
  assert.equal(rank("tieA"), 3);
  assert.equal(rank("tieB"), 3); // tie shares
  assert.equal(rank("low"), 5); // ...then 5, never 4
});

// ── the copy, both beats, all four fan states ────────────────────────────────

test("RESULTS copy — a player gets club position + their personal position", () => {
  const { supporters, attempts } = club("Arsenal", [900, 800, 700, 600, 500]);
  const { recipients } = gameweekRecipients(supporters, attempts, ["Arsenal"]);
  const third = recipients.find((r) => r.rankInClub === 3)!;
  const copy = resultCopy("results", third);
  assert.match(copy.title, /^Arsenal finished 1st this gameweek$/);
  assert.equal(copy.body, "You were their 3rd-best scorer out of 5.");
});

test("RESULTS copy — a NON-player is told the club result and nudged, with NO fake personal rank", () => {
  const { supporters, attempts } = club("Arsenal", [900, 800, 700, 600, 500], 1);
  const { recipients } = gameweekRecipients(supporters, attempts, ["Arsenal"]);
  const benched = recipients.find((r) => !r.played)!;
  const copy = resultCopy("results", benched);
  assert.match(copy.title, /Arsenal finished 1st/);
  assert.match(copy.body, /without you|get in/i);
  assert.doesNotMatch(copy.body, /\d+(st|nd|rd|th)-best/); // never a personal rank they didn't earn
});

test("NEWWEEK copy — everyone gets a forward nudge referencing last week's standing", () => {
  const { supporters, attempts } = club("Arsenal", [900, 800, 700, 600, 500], 1);
  const { recipients } = gameweekRecipients(supporters, attempts, ["Arsenal"]);
  const player = recipients.find((r) => r.played)!;
  const benched = recipients.find((r) => !r.played)!;
  assert.match(resultCopy("newweek", player).title, /defend Arsenal/i);
  assert.match(resultCopy("newweek", benched).title, /represent Arsenal/i);
  assert.match(resultCopy("newweek", benched).body, /1st last week/);
});

test("no floor: 4 players now RANK — the old 'not enough of you' path is gone", () => {
  const { supporters, attempts } = club("Nottingham Forest", [9000, 8000, 7000, 6000], 2); // 4 played, 2 benched
  const { recipients } = gameweekRecipients(supporters, attempts, ["Nottingham Forest"]);
  for (const r of recipients) assert.equal(r.clubRank, 1, "one club, four players — it's ranked");
  const player = recipients.find((r) => r.played)!;
  assert.match(resultCopy("results", player).title, /finished 1st/);
});

test("ONE lone player misses the bar (2) — and is told they were on their own", () => {
  const { supporters, attempts } = club("Nottingham Forest", [9000], 2); // 1 played, 2 benched
  const { recipients } = gameweekRecipients(supporters, attempts, ["Nottingham Forest"]);
  const player = recipients.find((r) => r.played)!;
  const benched = recipients.find((r) => !r.played)!;

  assert.equal(player.clubRank, null, "1 player is under the 2-fan bar");
  assert.match(resultCopy("results", player).body, /only Nottingham Forest fan who played/);
  assert.match(resultCopy("results", benched).body, /One lone Nottingham Forest fan played/);
});

test("a club NOBODY played for is unranked, and its fans are told exactly that", () => {
  // The only way to miss the table now: not a single fan played the club's game.
  const { supporters } = club("Nottingham Forest", [], 3); // 3 declared, 0 played
  const { recipients } = gameweekRecipients(supporters, [], ["Nottingham Forest"]);
  assert.equal(recipients.length, 3);
  for (const r of recipients) {
    assert.equal(r.clubRank, null);
    assert.equal(r.played, false);
  }
  const copy = resultCopy("results", recipients[0]);
  assert.match(copy.title, /didn't make the table/);
  assert.match(copy.body, /Not one Nottingham Forest fan played/);
});

test("THE PRODUCT RULE survives into the copy: the small sharp club is told it WON", () => {
  const brentford = club("Brentford", Array(5).fill(9000)); // avg 9,000, total 45,000
  const united = club("Man United", Array(30).fill(3000)); // avg 3,000, total 90,000 (DOUBLE)
  const { supporters, attempts } = merge(brentford, united);
  const { standings, recipients } = gameweekRecipients(supporters, attempts, ["Brentford", "Man United"]);
  assert.ok(
    standings.find((s) => s.club === "Man United")!.totalScore > standings.find((s) => s.club === "Brentford")!.totalScore,
    "United's TOTAL must be bigger — that's the whole point",
  );
  const breFan = recipients.find((r) => r.club === "Brentford")!;
  assert.match(resultCopy("results", breFan).title, /Brentford finished 1st/);
});

test("no score, no spoiler, no delivery-mechanism language in any copy path", () => {
  const { supporters, attempts } = club("Arsenal", [900, 800, 700, 600, 500], 2);
  const { recipients } = gameweekRecipients(supporters, attempts, ["Arsenal"]);
  const banned = /\b(browser|download|app store|room|IQ)\b/i;
  for (const send of ["results", "newweek"] as const) {
    for (const r of recipients) {
      const { title, body } = resultCopy(send, r);
      assert.doesNotMatch(title, banned);
      assert.doesNotMatch(body, banned);
    }
  }
});

test("dedupe key is unique per send AND per channel AND per gameweek — so push and email never collide", () => {
  assert.equal(resultDedupeKey("results", "push", 28083, "1"), "club-results-push:28083:1");
  assert.notEqual(resultDedupeKey("results", "push", 28083, "1"), resultDedupeKey("results", "email", 28083, "1"));
  assert.notEqual(resultDedupeKey("results", "push", 28083, "1"), resultDedupeKey("newweek", "push", 28083, "1"));
  assert.notEqual(resultDedupeKey("results", "push", 28083, "1"), resultDedupeKey("results", "push", 28083, "2"));
});
