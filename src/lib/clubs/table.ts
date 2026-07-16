/**
 * Club-Fan Leaderboard tally logic — pure, DB-free (mirrors src/lib/halftime/shared.ts:
 * no imports, no Supabase client, so this runs with no bundler and no DB).
 *
 * SCORING RULE (LOCKED — founder, 2026-07-16): a fan's points come ONLY from the
 * halftime quiz of the club they actually support. Other fixtures' packs are
 * playable but score nothing for the table — see ownClubFanTotals.
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
  /** The fixture the attempt's pack belongs to — required to apply the
   *  own-club rule below. Caller gets these from halftime_releases. */
  home: string;
  away: string;
}

/**
 * Per-fan gameweek total, counting ONLY the halftime packs for their OWN club's
 * fixture (LOCKED — founder, 2026-07-16).
 *
 * A fan's knowledge score is about THEIR club's match, not how many other packs
 * they grind. Counting every fixture would let a fan farm ten packs a week and
 * carry their club's average on volume, which makes the table a measure of
 * appetite rather than knowledge — and would quietly punish the fan who only
 * ever plays their own team's game (the exact person this is for).
 *
 * Shared by gameweekClubTable and result.ts's gameweekRecipients so the table
 * and the end-of-gameweek message can never disagree about who counts.
 *
 * A fan with no declared club counts for nobody. An attempt on a fixture their
 * club isn't in is simply ignored — they can still play it, it just doesn't score.
 */
export function ownClubFanTotals(
  supporters: ClubSupporterRow[],
  attempts: HalftimeAttemptRow[],
): Map<string, number> {
  const fanClub = new Map<string, string>();
  for (const s of supporters) fanClub.set(s.userId, s.club);

  const totals = new Map<string, number>();
  for (const a of attempts) {
    const club = fanClub.get(a.userId);
    if (club === undefined) continue; // no declared club — counts for nobody
    if (club !== a.home && club !== a.away) continue; // not their club's match
    totals.set(a.userId, (totals.get(a.userId) ?? 0) + a.score);
  }
  return totals;
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
  // One number per fan: their OWN club's halftime pack(s) this gameweek. A fan
  // who also played four other fixtures' packs contributes only their own club's
  // score — see ownClubFanTotals for why.
  const fanTotals = ownClubFanTotals(supporters, attempts);

  // A fan's club, from the season-locked supporter table.
  const fanClub = new Map<string, string>();
  for (const s of supporters) fanClub.set(s.userId, s.club);

  // Group participating fans' per-fan totals by club. "Participating" = supports
  // the club AND played that club's OWN halftime pack this gameweek.
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
