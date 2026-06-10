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
  /** Collective shape: how far the block slides toward the ball, in / out of possession. */
  teamFollow: { poss: 0.5, def: 0.42 },
  teamFollowY: 0.55,
  /** Each role's share of that block slide — the keeper barely follows, attackers most. */
  roleShift: { gk: 0.25, def: 0.7, mid: 1, att: 1.15 } as Record<Role, number>,
  /** The possessing block commits forward; the defending block drops off (in x). */
  possCommit: 0.14,
  defDrop: 0.07,
  /** Off-ball run amplitude by role — players are always repositioning, not jittering. */
  runAmp: { gk: 0.018, def: 0.05, mid: 0.075, att: 0.1 } as Record<Role, number>,
  /** Attackers surge toward the goal during their own team's attack. */
  forwardRun: 0.16,
  /** The nearest N outfield defenders sprint at the ball carrier. */
  press: { count: 2, pull: 0.5 },
  /** Passing: cadence in progress-space (~1 pass/sec over a 45s half), the fraction of a
   *  pass spent in flight, and how far in front of the carrier's feet the ball sits. */
  passProgress: 0.022,
  passFlight: 0.35,
  footOffset: 0.013,
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

type Pt = { x: number; y: number };

/** Pick the player to receive pass `k`: a seeded choice biased to whoever is forward and
 *  near play, so the ball generally advances while still varying foot-to-foot. */
function carrier(poss: Pt[], focus: Pt, attEnd: number, k: number, seed: string): Pt {
  if (k < 0 || poss.length === 0) return { x: 0.5, y: 0.5 };
  const rng = seededRng(`${seed}:${k}`);
  let best = poss[0], bestScore = -Infinity;
  for (const p of poss) {
    const fwd = attEnd === 1 ? p.x : 1 - p.x;                       // 0 (own half) → 1 (attacking)
    const near = 1 - Math.min(1, Math.hypot(p.x - focus.x, p.y - focus.y) / 0.5);
    const score = near + fwd * 0.7 + rng() * 0.6;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return { x: best.x, y: best.y };
}

/** The shown ball when it's in open play: passed between the possessing side's outfielders.
 *  It flies quickly to a receiver then rests at their (moving) feet until the next pass. */
function passBall(players: { side: Side; role: Role; x: number; y: number }[], possSide: Side, focus: Pt, progress: number, matchId: string): Pt {
  const poss = players.filter((p) => p.side === possSide && p.role !== "gk").map((p) => ({ x: p.x, y: p.y }));
  if (poss.length === 0) return focus;
  const attEnd = attackEndX(possSide);
  const seed = `${matchId}:${possSide}:carry`;
  const dur = PITCH_CONFIG.passProgress;
  const k = Math.floor(progress / dur);
  const local = (progress - k * dur) / dur;
  const to = carrier(poss, focus, attEnd, k, seed);
  const from = carrier(poss, focus, attEnd, k - 1, seed);
  const t = local < PITCH_CONFIG.passFlight ? local / PITCH_CONFIG.passFlight : 1;
  const off = (attEnd === 1 ? 1 : -1) * PITCH_CONFIG.footOffset * t;
  return { x: lerp(from.x, to.x, t) + off, y: lerp(from.y, to.y, t) };
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

  // Where play is focused right now — the macro ball path: funnelling up the channel on a
  // dwell, racing to the next move on a skip. Players orient to this; the SHOWN ball is a
  // pass among the players around it.
  const phase: BeatPhase | undefined = seg.beat ? phaseOf(seg.beat, matchMinute) : undefined;
  let focus: { x: number; y: number };
  if (seg.type === "dwell" && seg.beat) {
    focus = dwellBall(seg.beat, matchMinute);
  } else {
    const posA = sim.possession.a; // %
    const neutralX = clamp01(0.5 + PITCH_CONFIG.possessionBias * ((posA - 50) / 50) * 0.5);
    const targetX = nextBeat ? lerp(0.5, attackEndX(nextBeat.side), 0.4) : 0.5;
    focus = { x: lerp(neutralX, targetX, localT), y: lerp(0.5, nextBeat ? nextBeat.laneY : 0.5, localT) };
  }
  focus = { x: clamp01(focus.x), y: clamp01(focus.y) };

  const defSide: Side | undefined = activeSide ? (activeSide === "a" ? "b" : "a") : undefined;

  // Players move as a unit toward play, make continuous off-ball runs, and the front line
  // surges forward when their side attacks.
  type P = { side: Side; role: Role; x: number; y: number };
  const players: P[] = [];
  for (const side of ["a", "b"] as const) {
    const isPoss = side === activeSide;
    const attEnd = attackEndX(side), ownEnd = ownEndX(side);
    const follow = isPoss ? PITCH_CONFIG.teamFollow.poss : PITCH_CONFIG.teamFollow.def;
    const commit = isPoss ? (attEnd - 0.5) * PITCH_CONFIG.possCommit : (ownEnd - 0.5) * PITCH_CONFIG.defDrop;
    const shiftX = (focus.x - 0.5) * follow + commit * 2;
    const shiftY = (focus.y - 0.5) * PITCH_CONFIG.teamFollowY;
    ANCHORS[side].forEach((anc, i) => {
      const gi = i + (side === "a" ? 0 : 11);
      const rw = PITCH_CONFIG.roleShift[anc.role];
      let x = anc.x + shiftX * rw;
      let y = anc.y + shiftY * rw;
      // Off-ball runs — continuous, role-scaled, gliding (low frequency reads as runs, not buzz).
      const ph = gi * 2.3999632;
      const amp = PITCH_CONFIG.runAmp[anc.role];
      x += amp * (0.7 * Math.sin(progress * 9 + ph) + 0.3 * Math.sin(progress * 17 + ph * 1.7));
      y += amp * (0.7 * Math.cos(progress * 8 + ph * 1.3) + 0.3 * Math.sin(progress * 15 + ph * 0.6));
      // Front line surges toward goal during their own attack.
      if (isPoss && (anc.role === "att" || anc.role === "mid")) {
        x = lerp(x, attEnd, PITCH_CONFIG.forwardRun * (anc.role === "att" ? 1 : 0.45));
      }
      players.push({ side, role: anc.role, x, y });
    });
  }

  // Pressing: the nearest outfield defenders sprint at the ball.
  if (defSide) {
    const d2 = (p: P) => (p.x - focus.x) ** 2 + (p.y - focus.y) ** 2;
    const defenders = players.filter((p) => p.side === defSide && p.role !== "gk").sort((a, b) => d2(a) - d2(b));
    for (let i = 0; i < Math.min(PITCH_CONFIG.press.count, defenders.length); i++) {
      defenders[i].x = lerp(defenders[i].x, focus.x, PITCH_CONFIG.press.pull);
      defenders[i].y = lerp(defenders[i].y, focus.y, PITCH_CONFIG.press.pull);
    }
  }
  for (const p of players) { p.x = clamp01(p.x); p.y = clamp01(p.y); }

  // The shown ball: a strike streaks to goal; otherwise it's passed foot-to-foot among
  // the possessing side's outfielders near play.
  let ball: { x: number; y: number };
  if (seg.type === "dwell" && seg.beat && (phase === "strike" || phase === "outcome")) {
    ball = focus;
  } else if (activeSide) {
    ball = passBall(players, activeSide, focus, progress, matchId);
  } else {
    ball = focus;
  }
  ball = { x: clamp01(ball.x), y: clamp01(ball.y) };

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
