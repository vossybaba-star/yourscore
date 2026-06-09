/**
 * 38-0 "Watch the Half" — playback core (pure, deterministic, seeded).
 *
 * Turns an already-computed HalfSim into "what's on screen at progress p (0→1)" so a
 * half can be played out in ~30 seconds: a running clock, the scoreline revealed goal
 * by goal, stats ticking up, and a Championship-Manager-style commentary feed. No
 * React, no timing — the caller injects `progress` (live: from the phase deadline;
 * quick match: from a local ticker). Seeded, so both live clients render identically.
 *
 * Type-strippable (no enums) so it runs under `node --test`.
 */

import { seededRng } from "./score";
import type { HalfSim } from "./live-score";

export const WATCH_CONFIG = {
  /** Real seconds a half plays out over. */
  halfSeconds: 30,
  /** Match minutes in a half (the clock runs 0→45 / 45→90). */
  matchMinutesPerHalf: 45,
  /** Fraction of a side's shots that surface as a commentary "chance" beat. */
  shotCommentaryShare: 0.34,
} as const;

export type BeatKind = "kickoff" | "goal" | "corner" | "shot" | "offside" | "halftime" | "fulltime";

export type Beat = {
  minute: number;        // match minute (1–90)
  kind: BeatKind;
  side?: "a" | "b";
  text: string;
};

type Pair = { a: number; b: number };

export type TickStats = {
  possession: Pair;
  shots: Pair;
  shotsOnTarget: Pair;
  corners: Pair;
  fouls: Pair;
  offsides: Pair;
  throwins: Pair;
};

export type WatchFrame = {
  clockMinute: number;     // displayed match minute (0–90)
  goalsA: number;          // goals revealed SO FAR this half
  goalsB: number;
  stats: TickStats;        // current ticking values
  feed: Beat[];            // beats revealed so far, chronological
};

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * `count` event-minutes in [1, maxMinute], sorted. Deterministic for a seed; the
 * length is always exactly `count`, so a stat scheduled this way reaches its real
 * total precisely at full time.
 */
export function scheduleBeats(seed: string, count: number, maxMinute: number): number[] {
  if (count <= 0) return [];
  const rng = seededRng(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(1 + Math.floor(rng() * maxMinute));
  return out.sort((a, b) => a - b);
}

const SHOT_LINES = ["Saved!", "Off the post!", "Dragged wide", "Blocked on the line", "Over the bar"];

/** All beats for a half, chronological. Independent of progress (cheap to rebuild). */
function buildBeats(sim: HalfSim, half: 1 | 2, matchId: string): Beat[] {
  const M = WATCH_CONFIG.matchMinutesPerHalf;
  const base = half === 2 ? M : 0;
  const beats: Beat[] = [];

  beats.push({ minute: base, kind: "kickoff", text: half === 1 ? "Kick-off!" : "Back underway for the second half" });

  for (const e of sim.events) {
    const assist = e.assistName ? ` (assist ${e.assistName})` : "";
    beats.push({ minute: e.minute, kind: "goal", side: e.side, text: `⚽ GOAL — ${e.scorerName}${assist}` });
  }

  for (const side of ["a", "b"] as const) {
    for (const m of scheduleBeats(`${matchId}:${half}:corners:${side}`, side === "a" ? sim.corners.a : sim.corners.b, M)) {
      beats.push({ minute: base + m, kind: "corner", side, text: "Corner" });
    }
    for (const m of scheduleBeats(`${matchId}:${half}:offsides:${side}`, side === "a" ? sim.offsides.a : sim.offsides.b, M)) {
      beats.push({ minute: base + m, kind: "offside", side, text: "Flag's up — offside" });
    }
    const shots = side === "a" ? sim.shots.a : sim.shots.b;
    const chances = Math.round(shots * WATCH_CONFIG.shotCommentaryShare);
    for (const m of scheduleBeats(`${matchId}:${half}:shotbeats:${side}`, chances, M)) {
      const line = SHOT_LINES[Math.floor(seededRng(`${matchId}:${half}:shottext:${side}:${m}`)() * SHOT_LINES.length)];
      beats.push({ minute: base + m, kind: "shot", side, text: line });
    }
  }

  beats.push({ minute: base + M, kind: half === 2 ? "fulltime" : "halftime", text: half === 2 ? "Full time" : "Half time" });
  return beats.sort((x, y) => x.minute - y.minute);
}

/** Count a side's scheduled stat events that have happened by `elapsed` minutes. */
function tickStat(matchId: string, half: 1 | 2, key: string, finalA: number, finalB: number, elapsed: number): Pair {
  const M = WATCH_CONFIG.matchMinutesPerHalf;
  const a = scheduleBeats(`${matchId}:${half}:${key}:a`, finalA, M).filter((m) => m <= elapsed).length;
  const b = scheduleBeats(`${matchId}:${half}:${key}:b`, finalB, M).filter((m) => m <= elapsed).length;
  return { a, b };
}

/**
 * What to show at `progress` (0→1) through this half. Goals/stats/feed all reach the
 * sim's real values exactly at progress = 1.
 */
export function watchFrame(sim: HalfSim, half: 1 | 2, matchId: string, progress: number): WatchFrame {
  const M = WATCH_CONFIG.matchMinutesPerHalf;
  const p = clamp01(progress);
  const elapsed = Math.min(M, Math.floor(p * M)); // 0..45 within this half
  const base = half === 2 ? M : 0;
  const clockMinute = base + elapsed;

  let goalsA = 0;
  let goalsB = 0;
  for (const e of sim.events) {
    if (e.minute - base <= elapsed) {
      if (e.side === "a") goalsA++;
      else goalsB++;
    }
  }

  // Possession eases from an even 50/50 toward the half's real split.
  const posA = Math.round(50 + (sim.possession.a - 50) * p);
  const stats: TickStats = {
    possession: { a: posA, b: 100 - posA },
    shots: tickStat(matchId, half, "shots", sim.shots.a, sim.shots.b, elapsed),
    shotsOnTarget: tickStat(matchId, half, "shotsOnTarget", sim.shotsOnTarget.a, sim.shotsOnTarget.b, elapsed),
    corners: tickStat(matchId, half, "corners", sim.corners.a, sim.corners.b, elapsed),
    fouls: tickStat(matchId, half, "fouls", sim.fouls.a, sim.fouls.b, elapsed),
    offsides: tickStat(matchId, half, "offsides", sim.offsides.a, sim.offsides.b, elapsed),
    throwins: tickStat(matchId, half, "throwins", sim.throwins.a, sim.throwins.b, elapsed),
  };

  const feed = buildBeats(sim, half, matchId).filter((b) => b.minute <= clockMinute);

  return { clockMinute, goalsA, goalsB, stats, feed };
}
