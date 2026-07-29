/**
 * Monthly mini-season grouping (spec §2). Pure — NO `server-only` import, so this
 * is unit-testable through the plain tsc-compile test harness (see months.test.ts
 * and scripts/fantasy/run-tests.sh).
 *
 * A gameweek belongs to the calendar month of its `deadline` (Europe/London).
 * When `deadline` is null (replay/demo rows), fall back to `window_start`. A
 * gameweek is NEVER split across months.
 */

const LONDON_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit",
});

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "YYYY-MM" for the Europe/London calendar month a gameweek belongs to — keyed on
 *  its LAST match (window_end): a gameweek counts to the month it ENDS in (founder
 *  29 Jul, "a gameweek is just its last game"). A gameweek that straddles a month
 *  boundary counts entirely to the month of its final game. */
export function monthKeyOf(gw: { window_end: string }): string {
  // window_end is a date ("2026-08-24"); pin to noon UTC so the London calendar
  // month is unambiguous. A full timestamp (if ever passed) is used as-is.
  const iso = gw.window_end.length <= 10 ? `${gw.window_end}T12:00:00Z` : gw.window_end;
  const parts = LONDON_MONTH.formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

/** "2026-10" → "October 2026". */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const name = MONTH_NAMES[Number(month) - 1] ?? month;
  return `${name} ${year}`;
}

/** Group a list of gameweeks by their month key → the gw numbers in that month. */
export function groupGwsByMonth(
  gws: { gw: number; window_end: string }[],
): Map<string, number[]> {
  const byMonth = new Map<string, number[]>();
  for (const gw of gws) {
    const key = monthKeyOf(gw);
    const list = byMonth.get(key);
    if (list) list.push(gw.gw);
    else byMonth.set(key, [gw.gw]);
  }
  return byMonth;
}
