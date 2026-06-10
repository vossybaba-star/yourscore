/**
 * 38-0 "Watch the Half" — 2D pitch playback core (pure, deterministic, seeded).
 *
 * Turns an already-computed HalfSim into a fast-forward HIGHLIGHT REEL: the clock spins
 * between moments and slows onto each key beat (a chance or a goal). Each watched beat is
 * a genuinely SIMULATED passage (see matchsim.ts) — a real possession move with passing,
 * runs, pressing and a shot — not a choreographed path. This module owns the reel
 * schedule (the time-remap) and plays back the precomputed passage frames; the skips
 * between beats fast-forward by transitioning from one passage to the next.
 *
 * Pure given (sim, half, matchId, progress) — no React, no wall-clock — so both live
 * clients render the identical match. The match result is unchanged. Type-strippable
 * (string unions, no enums) so it compiles for `node --test`.
 */

import { seededRng } from "./score";
import { scheduleBeats } from "./playback";
import { buildPassages, type PassageSim, type SimFrame, type SimPlayer } from "./matchsim";
import type { HalfSim } from "./live-score";

export type Side = "a" | "b";
export type Role = "gk" | "def" | "mid" | "att";
export type BeatKind = "goal" | "shot" | "corner";
export type BeatPhase = "buildup" | "strike" | "outcome";

export const PITCH_CONFIG = {
  /** Half length in match-minutes (clock runs 0→45 within a half). */
  matchMinutesPerHalf: 45,
  /** Most beats we'll stage in a half (goals always get a slot first). */
  maxBeats: 7,
  /** Fewest beats — a dull 0–0 half still gets this many (ambient half-chances). */
  minBeats: 3,
  /** Progress-space weight of a watched moment vs a fast-forward skip. The ratio (not
   *  the absolute) sets pacing, so this stays independent of the real-seconds budget. */
  dwellWeight: 1,
  skipWeight: 0.22,
  /** Match-minutes either side of a beat that the dwell window spans. */
  dwellBeforeMin: 5,
  dwellAfterMin: 2,
  /** How far the higher-possession side carries the skip ball into the opponent half. */
  possessionBias: 0.34,
} as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);

// ── Reel schedule (time-remap) ──────────────────────────────────────────────

export type ReelBeat = {
  kind: BeatKind;
  side: Side;
  minute: number;       // half-minute in [1, 45] (base already subtracted)
  /** Shooting-position y the move funnels toward (seeded, 0..1). */
  laneY: number;
};

type Segment = {
  type: "skip" | "dwell";
  /** progress span [p0, p1) and the match-minutes it covers [m0, m1]. */
  p0: number; p1: number; m0: number; m1: number;
  beat?: ReelBeat;      // present on dwell segments
};

export type Reel = {
  beats: ReelBeat[];
  segments: Segment[];
};

/** All candidate beats for a half, before selection. Goals come from the sim's real
 *  events; on-target attempts that aren't goals become "saved" chances; a couple of
 *  corners round it out. Seeded so both clients agree. */
function candidateBeats(sim: HalfSim, half: 1 | 2, matchId: string): ReelBeat[] {
  const M = PITCH_CONFIG.matchMinutesPerHalf;
  const base = half === 2 ? M : 0;
  const out: ReelBeat[] = [];
  const laneRng = seededRng(`${matchId}:${half}:lane`);
  const laneY = () => 0.28 + laneRng() * 0.44;

  const goalMinutes = new Set<string>();
  for (const e of sim.events) {
    const m = e.minute - base;
    goalMinutes.add(`${e.side}:${m}`);
    out.push({ kind: "goal", side: e.side, minute: m, laneY: laneY() });
  }

  for (const side of ["a", "b"] as const) {
    const onTarget = side === "a" ? sim.shotsOnTarget.a : sim.shotsOnTarget.b;
    for (const m of scheduleBeats(`${matchId}:${half}:ontarget:${side}`, onTarget, M)) {
      if (goalMinutes.has(`${side}:${m}`)) continue;
      out.push({ kind: "shot", side, minute: m, laneY: laneY() });
    }
  }

  for (const side of ["a", "b"] as const) {
    const corners = side === "a" ? sim.corners.a : sim.corners.b;
    for (const m of scheduleBeats(`${matchId}:${half}:cornerbeat:${side}`, Math.min(2, corners), M)) {
      out.push({ kind: "corner", side, minute: m, laneY: laneY() });
    }
  }

  return out;
}

/** Select the beats to stage (goals first, then chances, then corners), top up to
 *  minBeats with ambient half-chances so the reel is never empty, sort by minute. */
function selectBeats(candidates: ReelBeat[], matchId: string, half: 1 | 2): ReelBeat[] {
  const rank = { goal: 0, shot: 1, corner: 2 } as Record<BeatKind, number>;
  const ordered = [...candidates].sort((x, y) => rank[x.kind] - rank[y.kind] || x.minute - y.minute);
  const goals = ordered.filter((b) => b.kind === "goal");
  const rest = ordered.filter((b) => b.kind !== "goal");

  const picked: ReelBeat[] = [...goals];
  for (const b of rest) {
    if (picked.length >= PITCH_CONFIG.maxBeats) break;
    picked.push(b);
  }

  const ambientRng = seededRng(`${matchId}:${half}:ambient`);
  let guard = 0;
  while (picked.length < PITCH_CONFIG.minBeats && guard++ < 20) {
    const minute = 6 + Math.floor(ambientRng() * 34);
    const side: Side = ambientRng() < 0.5 ? "a" : "b";
    picked.push({ kind: "shot", side, minute, laneY: 0.3 + ambientRng() * 0.4 });
  }

  return picked.sort((x, y) => x.minute - y.minute);
}

/** Build the reel: selected beats + a piecewise progress→minute remap with fast skips
 *  between dwells. Monotonic, starts at minute 0, ends at minute 45. */
export function buildReel(sim: HalfSim, half: 1 | 2, matchId: string): Reel {
  const M = PITCH_CONFIG.matchMinutesPerHalf;
  const beats = selectBeats(candidateBeats(sim, half, matchId), matchId, half);
  const N = beats.length;

  const segMinutes: { m0: number; m1: number; beat?: ReelBeat; type: "skip" | "dwell" }[] = [];
  let cursor = 0;
  for (let i = 0; i < N; i++) {
    const b = beats[i];
    const s = Math.max(cursor, Math.min(M, b.minute - PITCH_CONFIG.dwellBeforeMin));
    const e = Math.max(s, Math.min(M, b.minute + PITCH_CONFIG.dwellAfterMin));
    if (s > cursor) segMinutes.push({ type: "skip", m0: cursor, m1: s });
    segMinutes.push({ type: "dwell", m0: s, m1: e, beat: b });
    cursor = e;
  }
  if (cursor < M) segMinutes.push({ type: "skip", m0: cursor, m1: M });
  if (segMinutes.length === 0) segMinutes.push({ type: "skip", m0: 0, m1: M });

  const weightOf = (t: "skip" | "dwell") => (t === "dwell" ? PITCH_CONFIG.dwellWeight : PITCH_CONFIG.skipWeight);
  const total = segMinutes.reduce((s, seg) => s + weightOf(seg.type), 0);
  const segments: Segment[] = [];
  let p = 0;
  for (const seg of segMinutes) {
    const w = weightOf(seg.type) / total;
    segments.push({ type: seg.type, p0: p, p1: p + w, m0: seg.m0, m1: seg.m1, beat: seg.beat });
    p += w;
  }
  if (segments.length) segments[segments.length - 1].p1 = 1; // kill rounding drift

  return { beats, segments };
}

function phaseOf(beat: ReelBeat, matchMinute: number): BeatPhase {
  if (matchMinute < beat.minute - 0.35) return "buildup";
  if (matchMinute > beat.minute + 0.35) return "outcome";
  return "strike";
}

// ── Frame ───────────────────────────────────────────────────────────────────

export type PitchFrame = {
  matchMinute: number;        // remapped clock (spins fast during skips)
  ball: { x: number; y: number };
  players: SimPlayer[];       // 22, canonical order (side a then side b)
  beat?: { kind: BeatKind; side: Side; phase: BeatPhase };
  speed: "skip" | "play";
  inFlight: boolean;          // the ball is travelling (pass/shot) — for the trail
  goalsA: number;
  goalsB: number;
};

/** Memoised per (matchId, half, sim signature): the reel + the simulated passages. Built
 *  once (it steps the engine), then every frame is an O(1) lookup. Deterministic, so both
 *  live clients build the identical motion from the seed. */
const motionCache = new Map<string, { reel: Reel; passages: PassageSim[] }>();
function getMotion(sim: HalfSim, half: 1 | 2, matchId: string): { reel: Reel; passages: PassageSim[] } {
  const key = `${matchId}:${half}:${sim.events.length}:${sim.shotsOnTarget.a}:${sim.shotsOnTarget.b}:${sim.corners.a}:${sim.corners.b}`;
  let m = motionCache.get(key);
  if (!m) {
    const reel = buildReel(sim, half, matchId);
    m = { reel, passages: buildPassages(reel.beats, matchId, half) };
    motionCache.set(key, m);
  }
  return m;
}

function frameAt(p: PassageSim, localT: number): SimFrame {
  const i = Math.max(0, Math.min(p.frames.length - 1, Math.round(localT * (p.frames.length - 1))));
  return p.frames[i];
}

export function pitchFrame(sim: HalfSim, half: 1 | 2, matchId: string, progress: number): PitchFrame {
  const M = PITCH_CONFIG.matchMinutesPerHalf;
  const base = half === 2 ? M : 0;
  const { reel, passages } = getMotion(sim, half, matchId);
  const segs = reel.segments;

  const pr = clamp01(progress);
  let segIdx = segs.length - 1;
  for (let i = 0; i < segs.length; i++) {
    if (pr < segs[i].p1 || segs[i].p1 >= 1) { segIdx = i; break; }
  }
  const seg = segs[segIdx];
  const localT = clamp01((pr - seg.p0) / (seg.p1 - seg.p0 || 1));
  const matchMinute = lerp(seg.m0, seg.m1, localT);

  // Reveal a goal on the scoreboard only when its simulated shot actually crosses the line
  // (the passage's goalFrame), NOT when the clock passes the minute — so the scoreline
  // never gives the goal away before you see it.
  let goalsA = 0, goalsB = 0;
  for (let bi = 0; bi < reel.beats.length; bi++) {
    const b = reel.beats[bi];
    if (b.kind !== "goal") continue;
    const dseg = segs.find((s) => s.beat === b);
    let revealed: boolean;
    if (!dseg) revealed = pr >= 1;
    else if (pr >= dseg.p1) revealed = true;
    else if (pr < dseg.p0) revealed = false;
    else {
      const lt = (pr - dseg.p0) / (dseg.p1 - dseg.p0 || 1);
      const psg = passages[bi];
      const gf = psg.goalFrame >= 0 && psg.frames.length > 1 ? psg.goalFrame / (psg.frames.length - 1) : 1;
      revealed = lt >= gf;
    }
    if (revealed) { if (b.side === "a") goalsA++; else goalsB++; }
  }

  let players: SimPlayer[];
  let ball: { x: number; y: number };
  let inFlight = false;
  let beat: PitchFrame["beat"];

  if (seg.type === "dwell" && seg.beat) {
    const f = frameAt(passages[reel.beats.indexOf(seg.beat)], localT);
    players = f.players;
    ball = f.ball;
    inFlight = f.inFlight;
    beat = { kind: seg.beat.kind, side: seg.beat.side, phase: phaseOf(seg.beat, matchMinute) };
  } else {
    // Skip: fast-forward by transitioning from the previous passage's last frame to the
    // next passage's first frame (players line up index-for-index — canonical order).
    let prevP: PassageSim | undefined, nextP: PassageSim | undefined;
    for (let i = segIdx - 1; i >= 0; i--) if (segs[i].beat) { prevP = passages[reel.beats.indexOf(segs[i].beat!)]; break; }
    for (let i = segIdx + 1; i < segs.length; i++) if (segs[i].beat) { nextP = passages[reel.beats.indexOf(segs[i].beat!)]; break; }
    const a = prevP?.frames[prevP.frames.length - 1];
    const b = nextP?.frames[0];
    const t = smooth(localT);
    if (a && b) {
      players = a.players.map((pa, i) => ({ side: pa.side, role: pa.role, x: lerp(pa.x, b.players[i].x, t), y: lerp(pa.y, b.players[i].y, t) }));
      ball = { x: lerp(a.ball.x, b.ball.x, t), y: lerp(a.ball.y, b.ball.y, t) };
    } else if (b) { players = b.players; ball = b.ball; }
    else if (a) { players = a.players; ball = a.ball; }
    else { players = []; ball = { x: 0.5, y: 0.5 }; }
  }

  return {
    matchMinute: base + matchMinute,
    ball: { x: clamp01(ball.x), y: clamp01(ball.y) },
    players,
    beat,
    speed: seg.type === "dwell" ? "play" : "skip",
    inFlight,
    goalsA,
    goalsB,
  };
}
