/**
 * End-of-gameweek club message — what every fan is told once their club's
 * gameweek is done. TWO sends, and EVERYONE with a declared club gets both:
 *
 *   'results'  (the morning after the gameweek's final match)
 *     played     → "Arsenal finished 3rd this gameweek. You were their 12th-best scorer."
 *     didn't     → "Arsenal finished 3rd this gameweek. Their fans did the work without you."
 *   'newweek'  (as the next gameweek kicks off)
 *     everyone   → "New gameweek — represent Arsenal. They sat 3rd last week."
 *
 * WHY everyone, not just players (founder, 2026-07-15): the message that reaches
 * a fan who DIDN'T play is the one that pulls them in next week. The personal
 * "you were 12th-best" line is naturally dropped for them — they've nothing to
 * rank — but they still see where their fanbase landed, and that's the hook.
 *
 * Pure and DB-free, like table.ts — the caller owns every read. It tallies
 * pre-fetched rows so it can be unit-tested with no DB and no bundler.
 */

import {
  gameweekClubTable,
  ownClubFanTotals,
  type ClubStanding,
  type ClubSupporterRow,
  type HalftimeAttemptRow,
} from "./table";

export type SendType = "results" | "newweek";

export interface Recipient {
  userId: string;
  club: string;
  /** Did this fan complete >= 1 halftime attempt this gameweek. */
  played: boolean;
  /** 1-based rank within their club (by gameweek total); null if they didn't play. */
  rankInClub: number | null;
  /** How many of the club's fans played this gameweek. */
  clubFans: number;
  /** The club's rank this gameweek; null if the club missed the min-participants bar. */
  clubRank: number | null;
  /** How many clubs were ranked at all (the "of N"). */
  clubsRanked: number;
}

/** 1st / 2nd / 3rd / 4th … (correct through the 11–13 teens, where naive code breaks). */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Every fan who should be messaged for a completed gameweek: ALL declared
 * supporters of the clubs that had a fixture this round. Players are annotated
 * with their in-club rank; non-players are included with played=false.
 *
 * `clubs` MUST be the clubs that actually PLAYED this round (clubsForRound, not
 * clubsForSeason) — otherwise, on a blank gameweek, a club that didn't play
 * would wrongly be told it "didn't have enough players".
 */
export function gameweekRecipients(
  supporters: ClubSupporterRow[],
  attempts: HalftimeAttemptRow[],
  clubs: string[],
): { standings: ClubStanding[]; recipients: Recipient[] } {
  const standings = gameweekClubTable(supporters, attempts, clubs);
  const standingByClub = new Map(standings.map((s) => [s.club, s]));
  const clubsRanked = standings.filter((s) => s.eligible).length;
  const playingClubs = new Set(clubs);

  // One total per fan, counting ONLY their own club's halftime pack — the exact
  // helper gameweekClubTable uses, so the message and the table can never
  // disagree about who played and who counts.
  const fanTotals = ownClubFanTotals(supporters, attempts);

  // Rank the players inside each club.
  const byClub = new Map<string, { userId: string; score: number }[]>();
  const fanClub = new Map<string, string>();
  for (const s of supporters) fanClub.set(s.userId, s.club);
  for (const [userId, score] of Array.from(fanTotals.entries())) {
    const club = fanClub.get(userId);
    if (club === undefined) continue; // played but never declared — counts for nobody
    if (!byClub.has(club)) byClub.set(club, []);
    byClub.get(club)!.push({ userId, score });
  }

  const rankInClub = new Map<string, number>();
  const clubFanCount = new Map<string, number>();
  for (const [club, fans] of Array.from(byClub.entries())) {
    const sorted = [...fans].sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
    clubFanCount.set(club, sorted.length);
    let lastScore: number | null = null;
    let lastRank = 0;
    sorted.forEach((fan, i) => {
      // Ties share the better rank: [100, 100, 90] → 1, 1, 3.
      const rank = lastScore !== null && fan.score === lastScore ? lastRank : i + 1;
      lastScore = fan.score;
      lastRank = rank;
      rankInClub.set(fan.userId, rank);
    });
  }

  const recipients: Recipient[] = [];
  for (const s of supporters) {
    // Only fans of clubs that actually played this round get a message.
    if (!playingClubs.has(s.club)) continue;
    const standing = standingByClub.get(s.club);
    const played = fanTotals.has(s.userId);
    recipients.push({
      userId: s.userId,
      club: s.club,
      played,
      rankInClub: played ? rankInClub.get(s.userId) ?? null : null,
      clubFans: clubFanCount.get(s.club) ?? 0,
      clubRank: standing?.eligible ? standing.rank : null,
      clubsRanked,
    });
  }

  return { standings, recipients };
}

/**
 * The copy for one recipient + one send. No match score anywhere (the halftime
 * spoiler rule still holds — people play these packs later), no
 * delivery-mechanism language, locked vocabulary.
 */
export function resultCopy(send: SendType, r: Recipient): { title: string; body: string } {
  const ranked = r.clubRank !== null;

  if (send === "newweek") {
    // The re-engagement beat. Everyone, framed forward. Reference last week's
    // standing as the reason to act; players defend, non-players represent.
    const stood = ranked
      ? `${r.club} sat ${ordinal(r.clubRank!)} last week.`
      : `${r.club} didn't field enough players last week.`;
    if (r.played) {
      return { title: `New gameweek — defend ${r.club}'s spot`, body: `${stood} The halftime quizzes are live again — go again.` };
    }
    return { title: `New gameweek — represent ${r.club}`, body: `${stood} Play a halftime quiz and put ${r.club} on the board.` };
  }

  // send === "results" — the morning-after recap.
  if (!ranked) {
    /**
     * The bar is 2 (MIN_PARTICIPANTS), so a club misses the table on exactly two
     * counts: nobody played, or ONE fan did. Both are addressed, because "one
     * played" is the interesting one — that fan turned up and got nothing for it,
     * and they're one mate away from ranking.
     */
    if (r.played) {
      // We're unranked and you played, so you were the only one — by definition.
      return {
        title: `${r.club} didn't make the table`,
        body: `You were the only ${r.club} fan who played. Two of you and they're on the board.`,
      };
    }
    return {
      title: `${r.club} didn't make the table`,
      body:
        r.clubFans === 1
          ? `One lone ${r.club} fan played. They needed one more — you.`
          : `Not one ${r.club} fan played this gameweek. Next week, be the one.`,
    };
  }

  const title = `${r.club} finished ${ordinal(r.clubRank!)} this gameweek`;

  if (!r.played) {
    return { title, body: `Their fans did the work without you. Get in next gameweek.` };
  }
  if (r.rankInClub === 1 && r.clubFans > 1) {
    return { title, body: `And you were their best scorer, out of ${r.clubFans}. Nice.` };
  }
  return { title, body: `You were their ${ordinal(r.rankInClub!)}-best scorer out of ${r.clubFans}.` };
}

/** One key per user per gameweek per send + channel — notification_log's PK makes it exactly-once. */
export function resultDedupeKey(send: SendType, channel: "push" | "email", seasonId: number, roundName: string): string {
  return `club-${send}-${channel}:${seasonId}:${roundName}`;
}

/**
 * Email tokens for the 24-club-gameweek template. The subject, headline and the
 * boxed "personal" line come straight from resultCopy() so email and push always
 * say the same thing — email just has room for a badge, a framing sub-line and a
 * button. Everything here is plain text; the template escapes nothing, so no HTML.
 */
export function emailContent(
  send: SendType,
  r: Recipient,
  roundName: string,
): {
  subject: string;
  preheader: string;
  badge: string;
  headline: string;
  subline: string;
  personal: string;
  ctaLabel: string;
} {
  const copy = resultCopy(send, r);

  if (send === "newweek") {
    return {
      subject: copy.title,
      preheader: copy.body,
      badge: "New gameweek · Kick-off",
      headline: (r.played ? `DEFEND ${r.club}` : `REPRESENT ${r.club}`).toUpperCase(),
      subline: "The halftime quizzes are live again this gameweek.",
      personal: copy.body,
      ctaLabel: "Play a halftime quiz",
    };
  }

  // results
  const ranked = r.clubRank !== null;
  const headline = ranked
    ? `${r.club} — ${ordinal(r.clubRank!)}`.toUpperCase()
    : `${r.club} — short-handed`.toUpperCase();
  return {
    subject: copy.title,
    preheader: copy.body,
    badge: `Gameweek ${roundName} · Results`,
    headline,
    subline: ranked
      ? "In this gameweek's fan-knowledge table."
      : "Not enough fans played to make the table.",
    personal: copy.body,
    ctaLabel: "See the club table",
  };
}
