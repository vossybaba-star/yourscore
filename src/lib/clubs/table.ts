/**
 * Club-Fan Leaderboard tally logic — pure, DB-free (mirrors src/lib/halftime/shared.ts:
 * no imports, no Supabase client, so this runs with no bundler and no DB).
 *
 * RANKING RULE (LOCKED — founder's decision #3, do not reopen): AVERAGE score per
 * participating fan, with a minimum of MIN_PARTICIPANTS fans. A raw total would
 * just rank fanbases by SIZE — the big six would win every week forever and
 * small-club fans would stop looking. Average makes it "who actually knows their
 * football", so a handful of sharp small-club fans can beat a big casual fanbase.
 * The minimum stops one lucky fan (or a tiny clique) topping the table alone.
 *
 * Callers (the API routes) own every DB read:
 *   - who supports which club — club_supporters, season-locked
 *   - who completed which halftime attempt this gameweek, and their score —
 *     quiz_attempts JOIN halftime_releases ON quiz_attempts.pack_id =
 *     halftime_releases.pack_id (the ONLY correct way to identify a halftime
 *     attempt; do not sniff quiz_packs.metadata)
 * This module only tallies pre-fetched rows. It never queries the DB and never
 * materialises anything, so there is nothing here that can go stale — the totals
 * are summed on every read, from quiz_attempts, every time.
 */

export const MIN_PARTICIPANTS = 5;

export interface ClubSupporterRow {
  userId: string;
  club: string;
}

/** One halftime quiz_attempts row (already scoped to a single gameweek by the caller). */
export interface HalftimeAttemptRow {
  userId: string;
  score: number;
}

export interface ClubStanding {
  club: string;
  /** Distinct fans who support this club AND completed >= 1 halftime attempt this gameweek. */
  participants: number;
  /** Mean of each participating fan's TOTAL halftime score this gameweek. */
  avgScore: number;
  /** Sum of each participating fan's TOTAL halftime score this gameweek. */
  totalScore: number;
  /** 1-based rank among eligible (participants >= MIN_PARTICIPANTS) clubs; null if not eligible. */
  rank: number | null;
  eligible: boolean;
}

/**
 * Tallies the gameweek club table from pre-fetched supporter + attempt rows.
 *
 * `clubs` is the full roster to report on — the caller derives it from
 * halftime_releases home/away for the season (self-maintaining, never hardcoded
 * here), so a club with zero participating fans still appears, quietly, as
 * "not enough players" rather than vanishing from the table.
 */
export function gameweekClubTable(
  supporters: ClubSupporterRow[],
  attempts: HalftimeAttemptRow[],
  clubs: string[],
): ClubStanding[] {
  // One number per fan: sum every halftime attempt they completed this gameweek.
  // A fan who played three packs this GW contributes ONE total, not three entries.
  const fanTotals = new Map<string, number>();
  for (const a of attempts) {
    fanTotals.set(a.userId, (fanTotals.get(a.userId) ?? 0) + a.score);
  }

  // A fan's club, from the season-locked supporter table.
  const fanClub = new Map<string, string>();
  for (const s of supporters) fanClub.set(s.userId, s.club);

  // Group participating fans' per-fan totals by club. "Participating" = supports
  // the club AND has at least one halftime attempt this gameweek (any fixture).
  const byClub = new Map<string, number[]>();
  for (const club of clubs) byClub.set(club, []);
  for (const [userId, total] of Array.from(fanTotals.entries())) {
    const club = fanClub.get(userId);
    if (club === undefined) continue; // no declared club — doesn't count for anyone
    if (!byClub.has(club)) byClub.set(club, []); // defensive: a stray club outside the roster
    byClub.get(club)!.push(total);
  }

  const rows: ClubStanding[] = Array.from(byClub.entries()).map(([club, totals]) => {
    const participants = totals.length;
    const totalScore = totals.reduce((sum, t) => sum + t, 0);
    const avgScore = participants > 0 ? totalScore / participants : 0;
    return {
      club,
      participants,
      avgScore,
      totalScore,
      rank: null,
      eligible: participants >= MIN_PARTICIPANTS,
    };
  });

  // Rank only the eligible clubs, by avgScore desc; tie-break totalScore desc,
  // then club name for full determinism.
  const eligible = rows
    .filter((r) => r.eligible)
    .sort((a, b) => b.avgScore - a.avgScore || b.totalScore - a.totalScore || a.club.localeCompare(b.club));
  eligible.forEach((r, i) => {
    r.rank = i + 1;
  });

  const notEnough = rows
    .filter((r) => !r.eligible)
    .sort((a, b) => a.club.localeCompare(b.club));

  // Ranked clubs first (by rank), then not-enough clubs alphabetically. Callers
  // can also just filter on `eligible` directly.
  return [...eligible, ...notEnough];
}
