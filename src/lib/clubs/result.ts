/**
 * End-of-gameweek result — what each fan is told once their club's gameweek is done.
 *
 * "Arsenal finished 3rd this gameweek. You were their 12th-best scorer."
 *
 * This closes the loop the founder spotted was missing: today exactly ONE halftime
 * notification exists (the release push at the whistle) and NOTHING fires after a
 * player actually plays. The gameweek result is the thing that belongs in that
 * empty slot — a reason to come back, and a reason to drag a mate in.
 *
 * Pure and DB-free, like table.ts — it tallies pre-fetched rows so it can be
 * unit-tested with no DB and no bundler. The caller owns every read.
 *
 * WHO GETS TOLD: only fans who actually PLAYED a halftime pack that gameweek.
 * A supporter who didn't play gets nothing — telling someone "your club came 3rd,
 * you didn't take part" is a nag, not a notification, and it would burn the one
 * push we get with them. (A separate "your club needs you" nudge is a different
 * feature with a different consent conversation; it is deliberately not this.)
 */

import { gameweekClubTable, type ClubStanding, type ClubSupporterRow, type HalftimeAttemptRow } from "./table";

export interface GameweekResult {
  userId: string;
  club: string;
  /** The club's rank this gameweek; null if the club missed the minimum-participants bar. */
  clubRank: number | null;
  /** How many clubs were ranked at all this gameweek (the "of N" in "3rd of 18"). */
  clubsRanked: number;
  /** This fan's 1-based rank WITHIN their own club, by their gameweek total. */
  rankInClub: number;
  /** How many of their club's fans played this gameweek. */
  clubFans: number;
  /** This fan's total halftime score this gameweek. */
  score: number;
}

/** 1st / 2nd / 3rd / 4th … */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Per-fan results for a completed gameweek. Only fans who played are returned.
 *
 * Ties within a club share the better rank (two fans on the same score are both
 * "3rd"), because telling two identical performers different things is a bug a
 * user would notice and never forgive.
 */
export function gameweekResults(
  supporters: ClubSupporterRow[],
  attempts: HalftimeAttemptRow[],
  clubs: string[],
): { standings: ClubStanding[]; results: GameweekResult[] } {
  const standings = gameweekClubTable(supporters, attempts, clubs);

  const standingByClub = new Map(standings.map((s) => [s.club, s]));
  const clubsRanked = standings.filter((s) => s.eligible).length;

  // One total per fan (a fan who played three packs contributes one number) —
  // the same rule table.ts applies, so the two can never disagree.
  const fanTotals = new Map<string, number>();
  for (const a of attempts) {
    fanTotals.set(a.userId, (fanTotals.get(a.userId) ?? 0) + a.score);
  }

  const fanClub = new Map<string, string>();
  for (const s of supporters) fanClub.set(s.userId, s.club);

  // Group participating fans by club so we can rank them inside it.
  const byClub = new Map<string, { userId: string; score: number }[]>();
  for (const [userId, score] of Array.from(fanTotals.entries())) {
    const club = fanClub.get(userId);
    if (club === undefined) continue; // played, but never declared a club
    if (!byClub.has(club)) byClub.set(club, []);
    byClub.get(club)!.push({ userId, score });
  }

  const results: GameweekResult[] = [];
  for (const [club, fans] of Array.from(byClub.entries())) {
    const sorted = [...fans].sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
    const standing = standingByClub.get(club);

    let lastScore: number | null = null;
    let lastRank = 0;
    sorted.forEach((fan, i) => {
      // Ties share the better rank: [100, 100, 90] → ranks 1, 1, 3.
      const rank = lastScore !== null && fan.score === lastScore ? lastRank : i + 1;
      lastScore = fan.score;
      lastRank = rank;

      results.push({
        userId: fan.userId,
        club,
        clubRank: standing?.eligible ? standing.rank : null,
        clubsRanked,
        rankInClub: rank,
        clubFans: sorted.length,
        score: fan.score,
      });
    });
  }

  return { standings, results };
}

/**
 * The push copy. No score from any match in it (the halftime spoiler rule still
 * applies — people play these packs later in the day), no delivery-mechanism
 * language, locked vocabulary.
 */
export function resultCopy(r: GameweekResult): { title: string; body: string } {
  // The club missed the minimum-participants bar — there is no club rank to
  // report, so make it about the fan and the fact their club was short-handed.
  if (r.clubRank === null) {
    return {
      title: `${r.club} didn't make the table`,
      body:
        r.clubFans === 1
          ? `You were the only ${r.club} fan who played this week. Bring some backup.`
          : `Only ${r.clubFans} ${r.club} fans played — not enough to rank. Drag a few more in.`,
    };
  }

  const title = `${r.club} finished ${ordinal(r.clubRank)} this gameweek`;

  // Top scorer for their club is the line worth leading with.
  if (r.rankInClub === 1 && r.clubFans > 1) {
    return { title, body: `And you were their best scorer, out of ${r.clubFans}. Nice.` };
  }

  return {
    title,
    body: `You were their ${ordinal(r.rankInClub)}-best scorer out of ${r.clubFans}.`,
  };
}

/** One key per user per gameweek — notification_log's PK (user_id, key) makes it exactly-once. */
export function resultDedupeKey(seasonId: number, roundName: string): string {
  return `club-gw:${seasonId}:${roundName}`;
}
