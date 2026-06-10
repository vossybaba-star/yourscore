/**
 * 38-0 "Watch the Half" — 2D pitch playback core (pure, deterministic, seeded).
 *
 * Turns an already-computed HalfSim into a fast-forward HIGHLIGHT REEL on a 2D pitch:
 * the clock spins between moments and slows to watchable speed on each key beat (a
 * chance or a goal), where 22 dots + the ball play the buildup → strike → outcome.
 * Pure given (sim, half, matchId, progress) — no React, no timing, no wall-clock — so
 * both live clients render the identical reel and the whole thing unit-tests under
 * `node --test`. The caller injects `progress` (0→1 over the half's real seconds).
 *
 * There is NO spatial data in the engine; this is choreography over the event timeline,
 * not a tactical simulation. The match result is unchanged.
 *
 * Type-strippable (string unions, no enums) so it compiles for `node --test`.
 */

import { seededRng } from "./score";
import { scheduleBeats } from "./playback";
import { slotsFor } from "./formations";
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
  /** How far the higher-possession side pushes the neutral ball into the opponent half
   *  (0→1 of a half-width). The possession bias. */
  possessionBias: 0.34,
  /** How hard a dot leans toward the ball, by role. */
  roleAttract: { gk: 0.03, def: 0.07, mid: 0.13, att: 0.19 } as Record<Role, number>,
  /** Forward push for the side in possession / drop for the side defending (in x). */
  attackPush: 0.1,
  defendDrop: 0.06,
  /** Amplitude of the smooth idle wobble that keeps dots alive (deterministic). */
  jitter: 0.012,
} as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

// ── Pitch geometry ──────────────────────────────────────────────────────────
// Normalised pitch: x = goal-to-goal (0 = side A's goal line, 1 = side B's goal
// line); side A attacks toward x=1, side B toward x=0. y = touchline-to-touchline.

const attackEndX = (side: Side): number => (side === "a" ? 1 : 0);
const ownEndX = (side: Side): number => (side === "a" ? 0 : 1);

function roleOf(pos: string): Role {
  if (pos === "GK") return "gk";
  if (pos === "ST" || pos === "RW" || pos === "LW" || pos === "CAM") return "att";
  if (pos === "CDM" || pos === "CM" || pos === "RM" || pos === "LM") return "mid";
  return "def";
}

/** A team's neutral anchor shape, derived once from a 4-3-3 (representational). The
 *  formation `y` (depth 8→92) maps to x within the team's own half→halfway; the
 *  formation `x` (width 0→100) maps to pitch y. Side B is the mirror. */
type Anchor = { role: Role; x: number; y: number };

function teamAnchors(side: Side): Anchor[] {
  const slots = slotsFor("4-3-3");
  return slots.map((s) => {
    const depth = (s.y - 8) / 84;        // 0 (GK) → 1 (front line)
    const baseX = 0.06 + depth * 0.44;   // own box → ~halfway
    const baseY = s.x / 100;
    return side === "a"
      ? { role: roleOf(s.pos), x: baseX, y: baseY }
      : { role: roleOf(s.pos), x: 1 - baseX, y: 1 - baseY };
  });
}

const ANCHORS: Record<Side, Anchor[]> = { a: teamAnchors("a"), b: teamAnchors("b") };

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

  // Goals — always candidates (and always selected later).
  const goalMinutes = new Set<string>();
  for (const e of sim.events) {
    const m = e.minute - base;
    goalMinutes.add(`${e.side}:${m}`);
    out.push({ kind: "goal", side: e.side, minute: m, laneY: laneY() });
  }

  // On-target attempts that weren't goals → saves.
  for (const side of ["a", "b"] as const) {
    const onTarget = side === "a" ? sim.shotsOnTarget.a : sim.shotsOnTarget.b;
    for (const m of scheduleBeats(`${matchId}:${half}:ontarget:${side}`, onTarget, M)) {
      if (goalMinutes.has(`${side}:${m}`)) continue;
      out.push({ kind: "shot", side, minute: m, laneY: laneY() });
    }
  }

  // A little corner filler.
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

  // Top up dull halves with spread-out ambient half-chances.
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

  // Minute boundaries: dwell_i spans [s_i, e_i] around beat minute; skips fill gaps.
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

  // Allocate progress width by weight (dwell vs skip) — independent of real seconds.
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

function segmentAt(reel: Reel, progress: number): { seg: Segment; localT: number } {
  const p = clamp01(progress);
  for (const seg of reel.segments) {
    if (p < seg.p1 || seg.p1 >= 1) {
      const span = seg.p1 - seg.p0 || 1;
      return { seg, localT: clamp01((p - seg.p0) / span) };
    }
  }
  const last = reel.segments[reel.segments.length - 1];
  return { seg: last, localT: 1 };
}

// ── Frame ───────────────────────────────────────────────────────────────────

export type PitchFrame = {
  matchMinute: number;        // remapped clock (spins fast during skips)
  ball: { x: number; y: number };
  players: { side: Side; role: Role; x: number; y: number }[]; // 22
  beat?: { kind: BeatKind; side: Side; phase: BeatPhase };
  speed: "skip" | "play";
  goalsA: number;
  goalsB: number;
};

function phaseOf(beat: ReelBeat, matchMinute: number): BeatPhase {
  if (matchMinute < beat.minute - 0.35) return "buildup";
  if (matchMinute > beat.minute + 0.35) return "outcome";
  return "strike";
}

/** Ball position during a beat's dwell: up the channel, strike to goal, then settle. */
function dwellBall(beat: ReelBeat, matchMinute: number): { x: number; y: number } {
  const att = attackEndX(beat.side);
  const boxX = lerp(att, 0.5, 0.18);            // edge of the box
  const goalY = 0.5;
  if (matchMinute <= beat.minute) {
    // buildup: from the attacking half up to the box, drifting into the lane.
    const t = clamp01((matchMinute - (beat.minute - PITCH_CONFIG.dwellBeforeMin)) / PITCH_CONFIG.dwellBeforeMin);
    const startX = lerp(0.5, att, 0.35);
    return { x: lerp(startX, boxX, t), y: lerp(0.5, beat.laneY, t) };
  }
  // strike → outcome: streak to the goal mouth and stay (goal) / rebound out (save).
  const t = clamp01((matchMinute - beat.minute) / Math.max(0.5, PITCH_CONFIG.dwellAfterMin));
  if (beat.kind === "goal") return { x: lerp(boxX, att, Math.min(1, t * 3)), y: lerp(beat.laneY, goalY, Math.min(1, t * 3)) };
  // save/corner: ball to the line then pushed back out toward the corner.
  const peak = Math.min(1, t * 3);
  return { x: lerp(boxX, lerp(att, 0.5, 0.08), peak), y: lerp(beat.laneY, beat.laneY < 0.5 ? 0.12 : 0.88, peak) };
}

export function pitchFrame(sim: HalfSim, half: 1 | 2, matchId: string, progress: number): PitchFrame {
  const M = PITCH_CONFIG.matchMinutesPerHalf;
  const base = half === 2 ? M : 0;
  const reel = buildReel(sim, half, matchId);
  const { seg, localT } = segmentAt(reel, progress);
  const matchMinute = lerp(seg.m0, seg.m1, localT);

  // Goals revealed so far.
  let goalsA = 0, goalsB = 0;
  for (const e of sim.events) {
    if (e.minute - base <= matchMinute + 1e-6) {
      if (e.side === "a") goalsA++; else goalsB++;
    }
  }

  // Which side is driving play right now (for team shape).
  const nextBeat = seg.beat ?? reel.segments.find((s) => s.beat && s.p0 >= seg.p0)?.beat ?? reel.beats[0];
  const activeSide: Side | undefined = seg.beat ? seg.beat.side : nextBeat?.side;

  // Ball.
  let ball: { x: number; y: number };
  if (seg.type === "dwell" && seg.beat) {
    ball = dwellBall(seg.beat, matchMinute);
  } else {
    // skip: race the ball from a neutral, possession-biased spot toward the next move.
    const posA = sim.possession.a; // %
    const neutralX = clamp01(0.5 + PITCH_CONFIG.possessionBias * ((posA - 50) / 50) * 0.5);
    const targetX = nextBeat ? lerp(0.5, attackEndX(nextBeat.side), 0.4) : 0.5;
    ball = { x: lerp(neutralX, targetX, localT), y: lerp(0.5, nextBeat ? nextBeat.laneY : 0.5, localT) };
  }
  ball = { x: clamp01(ball.x), y: clamp01(ball.y) };

  // Players: anchors, leaning toward the ball, with team push + alive wobble.
  const players = (["a", "b"] as const).flatMap((side) =>
    ANCHORS[side].map((anc, i) => {
      const attract = PITCH_CONFIG.roleAttract[anc.role];
      let x = lerp(anc.x, ball.x, attract);
      let y = lerp(anc.y, ball.y, attract);
      if (activeSide && anc.role !== "gk") {
        const dir = side === activeSide ? attackEndX(side) : ownEndX(side);
        const push = side === activeSide ? PITCH_CONFIG.attackPush : PITCH_CONFIG.defendDrop;
        x = lerp(x, dir, push * (anc.role === "att" ? 1 : anc.role === "mid" ? 0.7 : 0.4));
      }
      // Smooth deterministic wobble (function of progress — no per-frame RNG).
      const ph = (i + (side === "a" ? 0 : 11)) * 1.7;
      x += Math.sin(progress * 22 + ph) * PITCH_CONFIG.jitter;
      y += Math.cos(progress * 19 + ph) * PITCH_CONFIG.jitter;
      return { side, role: anc.role, x: clamp01(x), y: clamp01(y) };
    }),
  );

  const beat = seg.type === "dwell" && seg.beat
    ? { kind: seg.beat.kind, side: seg.beat.side, phase: phaseOf(seg.beat, matchMinute) }
    : undefined;

  return {
    matchMinute: base + matchMinute,
    ball,
    players,
    beat,
    speed: seg.type === "dwell" ? "play" : "skip",
    goalsA,
    goalsB,
  };
}
