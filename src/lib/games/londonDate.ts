/**
 * Europe/London "today" — the calendar date every daily slot is keyed to.
 *
 * Its own leaf module (no Supabase, no pool) so edge code can import it without
 * dragging perfect10.ts — and therefore @supabase/supabase-js — into the
 * bundle. The Higher-or-Lower link-preview card (/api/og/higher-lower) rebuilds
 * the pinned daily round on the edge and needs exactly this and nothing else.
 *
 * Daily lists are assigned by the London calendar date, not UTC — computed via
 * Intl so a UTC-midnight rollover doesn't run a day early/late for UK players.
 */

export function londonDateISO(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
