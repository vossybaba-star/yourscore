/**
 * Club popularity among our own players — the pure half.
 *
 * No DB, no "server-only": both the client picker (src/app/versus/quiz/page.tsx)
 * and server matchmaking (src/lib/versus/quiz-matchmaking.ts) import this, and
 * they MUST agree on the name-squashing or the two surfaces disagree about which
 * club leads. Each caller owns its own query; only the shared logic lives here.
 */

export interface ClubPopularity {
  club: string;
  fans: number;
}

/**
 * Squash a club name to a form both sides agree on. `club_supporters` and the
 * quiz pack names genuinely disagree — "Brighton & Hove Albion" vs "Brighton",
 * "AFC Bournemouth" vs "Bournemouth" — and pack.parameter is the SEASON
 * ("2025/26"), not the club, so matching has to go through the name.
 */
export function clubKey(name: string): string {
  return name.toLowerCase()
    .replace(/^afc\s+/, "")
    .replace(/\s*&\s*hove albion\b/, "")
    .replace(/\s+(fc|afc)$/, "")
    .trim();
}

/** Rank below every real club — an unmatched pack sorts last, never first. */
export const UNRANKED = 9_999;

/**
 * Distinct supporters per club, most-supported first.
 *
 * Counts PEOPLE, not rows: club_supporters' PK is (user_id, season_id), so a fan
 * who declared in two seasons has two rows and would otherwise count twice.
 * Ties break alphabetically so the order is stable request to request rather
 * than reshuffling on whatever order Postgres happened to return.
 */
export function rankClubs(rows: { user_id: string | null; club: string | null }[]): ClubPopularity[] {
  const byClub = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.club || !row.user_id) continue;
    const users = byClub.get(row.club) ?? new Set<string>();
    users.add(row.user_id);
    byClub.set(row.club, users);
  }
  return Array.from(byClub.entries())
    .map(([club, users]) => ({ club, fans: users.size }))
    .sort((a, b) => b.fans - a.fans || a.club.localeCompare(b.club));
}

/** club key → 0-based rank, for sorting packs by how popular their club is. */
export function clubRankMap(clubs: ClubPopularity[]): Map<string, number> {
  return new Map(clubs.map((c, i) => [clubKey(c.club), i]));
}
