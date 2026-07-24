/**
 * Day-streak maths, shared by the home dashboard and the profile page.
 *
 * A "day" is a UK day — the product's day rolls over at UK midnight, not the
 * viewer's. Callers pass raw activity timestamps from whichever tables they
 * already fetched; this file has no opinion on the sources.
 */

/** UK-local YYYY-MM-DD for an ISO timestamp. The key every streak is counted in. */
export const ukDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/**
 * Caps every visible day streak. Callers must filter their activity queries to
 * this same window — raise it here and in the queries together, or the cap
 * silently wins.
 */
export const STREAK_WINDOW_DAYS = 45;

/** ISO cutoff for activity queries feeding a streak. */
export const streakCutoff = () =>
  new Date(Date.now() - STREAK_WINDOW_DAYS * 86_400_000).toISOString();

/** The set of UK days on which any of these timestamps landed. */
export function playedDays(timestamps: (string | null | undefined)[]): Set<string> {
  const days = new Set<string>();
  for (const t of timestamps) if (t) days.add(ukDay(t));
  return days;
}

/**
 * Consecutive UK days played, walking back from today. A streak is alive if it
 * includes today OR ended yesterday — today's game may simply not be played yet,
 * and zeroing it before the day is over would punish a player at 9am.
 */
export function dayStreak(played: Set<string>): number {
  const todayKey = ukDay(new Date().toISOString());
  // Noon-UTC cursor sidesteps DST edges, where a midnight cursor can land on
  // the same UK day twice (or skip one) and mis-count the run.
  let cursor = Date.parse(`${todayKey}T12:00:00Z`);
  if (!played.has(todayKey)) cursor -= 86_400_000;
  let streak = 0;
  while (played.has(ukDay(new Date(cursor).toISOString()))) {
    streak++;
    cursor -= 86_400_000;
  }
  return streak;
}
