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

/** "YYYY-MM" for the Europe/London calendar month a gameweek falls in. */
export function monthKeyOf(gw: { deadline: string | null; window_start: string }): string {
  const iso = gw.deadline ?? gw.window_start;
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
  gws: { gw: number; deadline: string | null; window_start: string }[],
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
