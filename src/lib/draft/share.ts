/**
 * Share helpers for the 38-0 live result card. Pure — used by the public unfurl
 * page (server) and the in-app full-time Share button (client) so both build the
 * exact same /api/draft/live-og image params.
 */

import type { GoalEvent, MatchReport } from "./live-score";

/** "Salah 2 · Henry · Bergkamp" — top scorers by goals (for the card strip). */
export function scorerSummary(events: GoalEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.scorerName, (counts.get(e.scorerName) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, n]) => (n > 1 ? `${name} ${n}` : name))
    .join(" · ");
}

export type LiveShareInput = {
  p1: string; p2: string;            // names (side a / side b)
  s1: number; s2: number;            // aggregate goals
  str1?: number | null; str2?: number | null;
  pens?: { a: number; b: number } | null;
  report: MatchReport;
};

/** Query string for /api/draft/live-og from a finished match's report. */
export function liveOgQuery(i: LiveShareInput): string {
  const q = new URLSearchParams();
  q.set("p1", i.p1); q.set("p2", i.p2);
  q.set("s1", String(i.s1)); q.set("s2", String(i.s2));
  if (i.str1 != null) q.set("str1", String(Math.round(Number(i.str1))));
  if (i.str2 != null) q.set("str2", String(Math.round(Number(i.str2))));
  if (i.pens) q.set("pens", `${i.pens.a}-${i.pens.b}`);
  if (i.report.potm) { q.set("potm", i.report.potm.name); q.set("potmR", i.report.potm.rating.toFixed(1)); }
  const a = i.report.a, b = i.report.b;
  q.set("pos", `${a.possession}-${b.possession}`);
  q.set("sh", `${a.shots}-${b.shots}`);
  q.set("sot", `${a.shotsOnTarget}-${b.shotsOnTarget}`);
  q.set("cor", `${a.corners}-${b.corners}`);
  q.set("fo", `${a.fouls}-${b.fouls}`);
  q.set("off", `${a.offsides}-${b.offsides}`);
  q.set("thr", `${a.throwins}-${b.throwins}`);
  const sc = scorerSummary(i.report.events);
  if (sc) q.set("sc", sc);
  return q.toString();
}
