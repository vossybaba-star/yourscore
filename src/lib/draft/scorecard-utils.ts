/**
 * Pure data-transform utilities for scorecard rendering.
 *
 * Extracted from components/draft/Scorecard.tsx so that server components
 * (e.g. /38-0/match/[id]/page.tsx) can import and call them without hitting
 * the "use client" boundary that makes the functions unavailable in the server
 * bundle. Scorecard.tsx re-exports everything from here for backward compat.
 */

import type { MatchReport } from "@/lib/draft/live-score";

export type ScorecardStat = { label: string; a: number; b: number; suffix?: string };
export type ScorecardGoal = { minute: number; mine: boolean; name: string; assist?: string };
export type ScorecardPotm = {
  name: string; rating: number; mine: boolean;
  pos?: string; goals?: number; assists?: number; sideName?: string;
};

/** Pull the standard stat sections out of a MatchReport (side a = you, b = opp). */
export function statsFromReport(rep: MatchReport): ScorecardStat[] {
  return [
    { label: "Possession", a: rep.a.possession, b: rep.b.possession, suffix: "%" },
    { label: "Shots", a: rep.a.shots, b: rep.b.shots },
    { label: "On target", a: rep.a.shotsOnTarget, b: rep.b.shotsOnTarget },
    { label: "Corners", a: rep.a.corners, b: rep.b.corners },
    { label: "Fouls", a: rep.a.fouls, b: rep.b.fouls },
    { label: "Offsides", a: rep.a.offsides, b: rep.b.offsides },
    { label: "Throw-ins", a: rep.a.throwins, b: rep.b.throwins },
  ];
}

export function goalsFromReport(rep: MatchReport): ScorecardGoal[] {
  return [...rep.events]
    .sort((x, y) => x.minute - y.minute)
    .map((e) => ({ minute: e.minute, mine: e.side === "a", name: e.scorerName, assist: e.assistName }));
}

export function potmFromReport(rep: MatchReport, youName: string, oppName: string): ScorecardPotm | null {
  if (!rep.potm) return null;
  const mine = rep.potm.side === "a";
  return {
    name: rep.potm.name, rating: rep.potm.rating, mine,
    pos: rep.potm.pos, goals: rep.potm.goals, assists: rep.potm.assists,
    sideName: mine ? youName : oppName,
  };
}
