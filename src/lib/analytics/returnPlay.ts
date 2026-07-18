// Pure ReturnPlay logic — no imports, no side effects, so it can be unit-tested
// directly. The storage read/write + pixel fan-out that use these live in
// trackGame.ts (maybeTrackReturnPlay / fireReturnPlay).

// Local calendar date as YYYY-MM-DD — "distinct day" is the player's own day, so
// a return matches how they'd perceive coming back tomorrow.
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Whole calendar days between two YYYY-MM-DD strings (parsed as UTC midnights, so
// DST never shifts the count). Returns 0 on unparseable input.
export function dayDiff(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Pure decision for the ReturnPlay milestone. Given the stored first-play day,
 * whether ReturnPlay already fired, and today's local date, returns whether to
 * fire now, the first-play day to persist (today only on the first-ever play,
 * otherwise unchanged), and days-since-first.
 *
 * Fires once, when a player plays on a later calendar day than their first play.
 */
export function evaluateReturnPlay(
  storedFirstDay: string | null,
  alreadyFired: boolean,
  today: string,
): { shouldFire: boolean; firstDay: string; daysSinceFirst: number } {
  if (!storedFirstDay) return { shouldFire: false, firstDay: today, daysSinceFirst: 0 };
  const daysSinceFirst = dayDiff(storedFirstDay, today);
  const shouldFire = !alreadyFired && daysSinceFirst >= 1;
  return { shouldFire, firstDay: storedFirstDay, daysSinceFirst };
}
