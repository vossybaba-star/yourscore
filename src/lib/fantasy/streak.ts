/**
 * The fantasy streak: how many gameweeks in a row you've submitted a squad.
 *
 * The habit we want is turning up and setting your side every week, so the
 * streak counts consecutive gameweeks with a locked squad, ending at the most
 * recent one you locked. A gap resets it — miss a week and you start again.
 *
 * Pure and integer-only: gameweeks are 1..N, so the run is just the count of
 * consecutive integers descending from your latest locked gameweek.
 */
export function fantasyStreak(lockedGameweeks: number[]): number {
  if (lockedGameweeks.length === 0) return 0;
  const set = new Set(lockedGameweeks);
  const latest = Math.max(...lockedGameweeks);
  let streak = 0;
  for (let gw = latest; set.has(gw); gw--) streak++;
  return streak;
}
