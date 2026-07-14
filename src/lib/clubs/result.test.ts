import { test } from "node:test";
import assert from "node:assert/strict";
import { gameweekResults, resultCopy, resultDedupeKey, ordinal } from "./result";
import type { ClubSupporterRow, HalftimeAttemptRow } from "./table";

/** n fans of one club, each with a fixed score. */
function fans(club: string, scores: number[], prefix = club): {
  supporters: ClubSupporterRow[];
  attempts: HalftimeAttemptRow[];
} {
  const supporters = scores.map((_, i) => ({ userId: `${prefix}-${i}`, club }));
  const attempts = scores.map((score, i) => ({ userId: `${prefix}-${i}`, score }));
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
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th"); // NOT 11st
  assert.equal(ordinal(12), "12th"); // NOT 12nd
  assert.equal(ordinal(13), "13th"); // NOT 13rd
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(112), "112th");
});

test("only fans who PLAYED get a result — a supporter who sat it out gets nothing", () => {
  const supporters: ClubSupporterRow[] = [
    { userId: "played", club: "Arsenal" },
    { userId: "sat-it-out", club: "Arsenal" },
  ];
  const attempts: HalftimeAttemptRow[] = [{ userId: "played", score: 5000 }];

  const { results } = gameweekResults(supporters, attempts, ["Arsenal"]);
  assert.deepEqual(results.map((r) => r.userId), ["played"]);
});

test("a player with no declared club gets no result and pollutes nobody's table", () => {
  const supporters: ClubSupporterRow[] = [{ userId: "a", club: "Arsenal" }];
  const attempts: HalftimeAttemptRow[] = [
    { userId: "a", score: 5000 },
    { userId: "undeclared", score: 99999 },
  ];

  const { results, standings } = gameweekResults(supporters, attempts, ["Arsenal"]);
  assert.deepEqual(results.map((r) => r.userId), ["a"]);
  const arsenal = standings.find((s) => s.club === "Arsenal")!;
  assert.equal(arsenal.participants, 1);
  assert.equal(arsenal.totalScore, 5000); // the 99999 is nowhere
});

test("rank within the club is by the fan's TOTAL for the week, not a single attempt", () => {
  const supporters: ClubSupporterRow[] = [
    { userId: "grinder", club: "Arsenal" },
    { userId: "one-shot", club: "Arsenal" },
  ];
  // grinder played three packs (3x2000 = 6000); one-shot played one big one (5000).
  const attempts: HalftimeAttemptRow[] = [
    { userId: "grinder", score: 2000 },
    { userId: "grinder", score: 2000 },
    { userId: "grinder", score: 2000 },
    { userId: "one-shot", score: 5000 },
  ];

  const { results } = gameweekResults(supporters, attempts, ["Arsenal"]);
  const grinder = results.find((r) => r.userId === "grinder")!;
  const oneShot = results.find((r) => r.userId === "one-shot")!;
  assert.equal(grinder.score, 6000);
  assert.equal(grinder.rankInClub, 1);
  assert.equal(oneShot.rankInClub, 2);
  assert.equal(grinder.clubFans, 2); // 4 attempts, but 2 FANS
});

test("ties inside a club share the better rank — two identical scores are both 3rd", () => {
  const { supporters, attempts } = fans("Arsenal", [900, 800, 700, 700, 600]);
  const { results } = gameweekResults(supporters, attempts, ["Arsenal"]);
  const ranks = results
    .sort((a, b) => b.score - a.score)
    .map((r) => r.rankInClub);
  assert.deepEqual(ranks, [1, 2, 3, 3, 5]); // 3,3 then 5 — never 3,4
});

test("the copy is the founder's line: club position + your position in it", () => {
  // Arsenal: 5 fans (clears the min). The viewer is the 3rd best of them.
  const { supporters, attempts } = fans("Arsenal", [900, 800, 700, 600, 500]);
  const { results } = gameweekResults(supporters, attempts, ["Arsenal"]);
  const third = results.find((r) => r.rankInClub === 3)!;
  const copy = resultCopy(third);

  assert.match(copy.title, /^Arsenal finished 1st this gameweek$/);
  assert.equal(copy.body, "You were their 3rd-best scorer out of 5.");
});

test("top scorer for their club gets the line worth leading with", () => {
  const { supporters, attempts } = fans("Arsenal", [900, 800, 700, 600, 500]);
  const { results } = gameweekResults(supporters, attempts, ["Arsenal"]);
  const best = results.find((r) => r.rankInClub === 1)!;
  assert.match(resultCopy(best).body, /best scorer/);
});

test("a club below the minimum gets an honest 'not enough of you' message, never a fake rank", () => {
  // 4 fans — below MIN_PARTICIPANTS (5).
  const { supporters, attempts } = fans("Nottingham Forest", [9000, 8000, 7000, 6000]);
  const { results } = gameweekResults(supporters, attempts, ["Nottingham Forest"]);

  assert.equal(results.length, 4);
  for (const r of results) assert.equal(r.clubRank, null); // no invented rank

  const copy = resultCopy(results[0]);
  assert.match(copy.title, /didn't make the table/);
  assert.match(copy.body, /Only 4 Nottingham Forest fans played/);
});

test("a lone fan is told they were the only one, not that they came 1st of 1", () => {
  const { supporters, attempts } = fans("Burnley", [5000]);
  const { results } = gameweekResults(supporters, attempts, ["Burnley"]);
  assert.match(resultCopy(results[0]).body, /only Burnley fan who played/);
});

test("THE PRODUCT RULE survives into the copy: the small sharp club is told it WON", () => {
  // Brentford: 5 sharp fans (5 x 9,000 = 45,000 total, avg 9,000).
  // Man United: 30 casual ones (30 x 3,000 = 90,000 total, avg 3,000).
  // United's TOTAL is double Brentford's. Brentford still wins, because we rank
  // on the AVERAGE. If anyone ever "optimises" this into a sum, this test dies.
  const brentford = fans("Brentford", Array(5).fill(9000), "bre");
  const united = fans("Man United", Array(30).fill(3000), "mun");
  const { supporters, attempts } = merge(brentford, united);

  const { standings, results } = gameweekResults(supporters, attempts, ["Brentford", "Man United"]);

  const bre = standings.find((s) => s.club === "Brentford")!;
  const mun = standings.find((s) => s.club === "Man United")!;
  assert.ok(mun.totalScore > bre.totalScore, "United's TOTAL must be bigger — that's the whole point");
  assert.equal(bre.rank, 1);
  assert.equal(mun.rank, 2);

  const breFan = results.find((r) => r.club === "Brentford")!;
  assert.match(resultCopy(breFan).title, /Brentford finished 1st/);
});

test("no score, no spoiler, no delivery-mechanism language in any copy path", () => {
  const { supporters, attempts } = fans("Arsenal", [900, 800, 700, 600, 500]);
  const { results } = gameweekResults(supporters, attempts, ["Arsenal"]);
  const banned = /\b(browser|download|app store|room|IQ)\b/i;
  for (const r of results) {
    const { title, body } = resultCopy(r);
    assert.doesNotMatch(title, banned);
    assert.doesNotMatch(body, banned);
  }
});

test("dedupe key is one per user per gameweek — exactly-once via notification_log's PK", () => {
  assert.equal(resultDedupeKey(28083, "1"), "club-gw:28083:1");
  assert.notEqual(resultDedupeKey(28083, "1"), resultDedupeKey(28083, "2"));
  assert.notEqual(resultDedupeKey(28083, "1"), resultDedupeKey(28084, "1"));
});
