/**
 * 38-0 — 2D match-engine motion (pure, deterministic, seeded).
 *
 * Each "key passage" of a half is simulated as a real possession move. It STARTS from a
 * varied, true-to-life restart (a goal kick from the back, a throw-in, a regain in
 * midfield, or a corner) — never always the centre spot — then BUILDS: an advance line
 * marches up the pitch, the ball is circulated (passes lead runners, dribbles), attackers
 * hold spread lanes and break into the box, the defending side keeps two banks goal-side
 * and presses with its nearest players, and the move finishes with a shot on the scripted
 * goal/save. Emergent from per-player behaviours — a 2D match engine — but kept cosmetic:
 * seeded RNG + scripted outcome ⇒ both live clients render the identical passage and the
 * result is unchanged. Type-strippable for `node --test`.
 */

import { seededRng } from "./score";
import { slotsFor } from "./formations";
import type { Side, Role, BeatKind, ReelBeat } from "./pitch";

export type SimPlayer = { side: Side; role: Role; x: number; y: number };
export type SimEvent = "pass" | "shot" | "goal" | "save" | "throwin" | "goalkick" | "corner";
export type SimFrame = { ball: { x: number; y: number }; inFlight: boolean; players: SimPlayer[]; event?: SimEvent };
/** `restart` = how this passage began (for the on-screen set-piece cue); `goalFrame` = the
 *  frame the ball crosses the line on a goal (so the score reveals exactly then, not early). */
export type PassageSim = { side: Side; kind: BeatKind; restart: SimEvent | "regain"; goalFrame: number; frames: SimFrame[] };

const FPS = 24;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
const attEndX = (s: Side): number => (s === "a" ? 1 : 0);

function roleOf(pos: string): Role {
  if (pos === "GK") return "gk";
  if (pos === "ST" || pos === "RW" || pos === "LW" || pos === "CAM") return "att";
  if (pos === "CDM" || pos === "CM" || pos === "RM" || pos === "LM") return "mid";
  return "def";
}

type Home = { role: Role; x: number; y: number };
function homes(side: Side): Home[] {
  return slotsFor("4-3-3").map((s) => {
    const depth = (s.y - 8) / 84;
    const baseX = 0.06 + depth * 0.44;
    const baseY = s.x / 100;
    return side === "a" ? { role: roleOf(s.pos), x: baseX, y: baseY } : { role: roleOf(s.pos), x: 1 - baseX, y: 1 - baseY };
  });
}

type Ent = { side: Side; role: Role; x: number; y: number; vx: number; vy: number; home: Home };

const SIM = {
  maxSpeed: { gk: 0.06, def: 0.135, mid: 0.15, att: 0.17 } as Record<Role, number>,
  arrive: 3.0,
  velBlend: 0.3,
  sep: 0.058, sepPush: 0.7,
  passSpeed: 0.62, shotSpeed: 1.05, friction: 0.955,
  dribble: 0.1, lead: 0.06,
  pressRadius: 0.16, controlRadius: 0.04,
  durBase: 4.6, durVar: 2.2,
  finishAt: 0.85,
  wingWide: 0.31, attAhead: 0.07, midBehind: 0.06, defUp: 0.4, defLineGap: 0.13,
} as const;

function steer(e: Ent, tx: number, ty: number): void {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const ms = SIM.maxSpeed[e.role];
  const speed = Math.min(ms, d * SIM.arrive);
  e.vx += ((dx / d) * speed - e.vx) * SIM.velBlend;
  e.vy += ((dy / d) * speed - e.vy) * SIM.velBlend;
}

function nearestDef(defs: Ent[], x: number, y: number): { e: Ent; d: number } {
  let best = defs[0], bd = Infinity;
  for (const e of defs) { const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; best = e; } }
  return { e: best, d: bd };
}
function nearestEnt(ents: Ent[], x: number, y: number): Ent {
  let best = ents[0], bd = Infinity;
  for (const e of ents) { const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; best = e; } }
  return best;
}

/** Pass target: forward & open by default; supporting (lateral/back) when circulating. */
function pickPass(atts: Ent[], holder: Ent, defs: Ent[], goalSign: number, advanceX: number, forward: boolean, rng: () => number): Ent | null {
  let best: Ent | null = null, bestScore = -Infinity;
  for (const e of atts) {
    if (e === holder || e.role === "gk") continue;
    const range = dist(e.x, e.y, holder.x, holder.y);
    if (range < 0.07 || range > 0.55) continue;
    const fwd = goalSign > 0 ? e.x - holder.x : holder.x - e.x;
    const space = nearestDef(defs, e.x, e.y).d;
    const aheadOfLine = goalSign > 0 ? e.x - advanceX : advanceX - e.x;
    const linePenalty = Math.max(0, aheadOfLine - 0.12) * 1.6;
    const dirW = forward ? 1.5 : -0.5;
    const score = fwd * dirW + space * 1.3 + rng() * 0.4 - linePenalty - Math.abs(range - 0.22) * 0.5;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/** The central attacker to aim a cross/cutback at — nearest to the penalty spot. */
function boxTarget(atts: Ent[], holder: Ent, goalX: number, goalSign: number): Ent | null {
  const spotX = goalX - goalSign * 0.1;
  let best: Ent | null = null, bd = Infinity;
  for (const e of atts) {
    if (e === holder || e.role === "gk") continue;
    const d = dist(e.x, e.y, spotX, 0.5);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function separate(ents: Ent[]): void {
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const a = ents[i], b = ents[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < SIM.sep && d > 1e-5) {
        const push = ((SIM.sep - d) / SIM.sep) * SIM.sepPush;
        a.vx += (dx / d) * push * SIM.maxSpeed[a.role]; a.vy += (dy / d) * push * SIM.maxSpeed[a.role];
        b.vx -= (dx / d) * push * SIM.maxSpeed[b.role]; b.vy -= (dy / d) * push * SIM.maxSpeed[b.role];
      }
    }
  }
}

type Origin = "goalkick" | "throwin" | "corner" | "build" | "regain";

function simulatePassage(beat: ReelBeat, matchId: string, half: 1 | 2, idx: number): PassageSim {
  const rng = seededRng(`${matchId}:${half}:passage:${idx}`);
  const att = beat.side;
  const def: Side = att === "a" ? "b" : "a";
  const goalX = attEndX(att), goalY = 0.5, goalSign = att === "a" ? 1 : -1;
  const ownGoalX = att === "a" ? 0 : 1;
  const dt = 1 / FPS;

  const ents: Ent[] = [];
  for (const side of [att, def] as Side[]) {
    for (const h of homes(side)) ents.push({ side, role: h.role, x: h.x, y: h.y, vx: 0, vy: 0, home: h });
  }
  const atts = ents.filter((e) => e.side === att);
  const defs = ents.filter((e) => e.side === def);
  const defOut = defs.filter((e) => e.role !== "gk");
  const defGk = defs.find((e) => e.role === "gk")!;
  const byRole = (r: Role) => atts.find((e) => e.role === r);

  // ── how this move begins (a real restart, not always the centre) ──
  const origin: Origin = beat.kind === "corner" ? "corner"
    : (() => { const r = rng(); return r < 0.24 ? "goalkick" : r < 0.46 ? "throwin" : r < 0.72 ? "build" : "regain"; })();
  let holder: Ent;
  let cornerCrossPending = false;
  if (origin === "goalkick") {
    holder = byRole("gk") ?? atts[0];
    holder.x = ownGoalX + goalSign * 0.06; holder.y = 0.5;
  } else if (origin === "throwin") {
    const ty = rng() < 0.5 ? 0.04 : 0.96;
    holder = [...atts].filter((e) => e.role === "def" || e.role === "mid").sort((a, b) => Math.abs(a.home.y - ty) - Math.abs(b.home.y - ty))[0] ?? atts[0];
    holder.x = lerp(ownGoalX, goalX, 0.4 + rng() * 0.18); holder.y = ty;
  } else if (origin === "corner") {
    const cy = rng() < 0.5 ? 0.04 : 0.96;
    holder = [...atts].filter((e) => e.role !== "gk").sort((a, b) => Math.abs(a.home.y - cy) - Math.abs(b.home.y - cy))[0] ?? atts[0];
    holder.x = goalX - goalSign * 0.015; holder.y = cy; cornerCrossPending = true;
  } else if (origin === "build") {
    holder = byRole("def") ?? byRole("mid") ?? atts[0];
    holder.x = lerp(ownGoalX, goalX, 0.25 + rng() * 0.12); holder.y = 0.3 + rng() * 0.4;
  } else {
    holder = byRole("mid") ?? atts[0];
    holder.x = lerp(ownGoalX, goalX, 0.46 + rng() * 0.12); holder.y = 0.22 + rng() * 0.56;
  }
  const startBallX = holder.x;
  const advanceAt = (d: number) => lerp(startBallX, goalX, Math.pow(clamp01(d / SIM.finishAt), 1.5));
  const ticks = Math.round((SIM.durBase + rng() * SIM.durVar) * FPS);

  let receiver: Ent | null = null;
  let pendingShot = false, resolved = false, goalFrame = -1;
  const restart: SimEvent | "regain" = origin === "build" ? "regain" : origin;
  const ball = { x: holder.x, y: holder.y, vx: 0, vy: 0, inFlight: false };
  const frames: SimFrame[] = [];

  for (let t = 0; t < ticks; t++) {
    const d = t / ticks;
    const advanceX = advanceAt(d);
    let event: SimEvent | undefined = t === 0 && origin !== "build" ? (origin as SimEvent) : undefined;

    if (!ball.inFlight && holder) {
      const fwdOf = goalSign > 0 ? holder.x : 1 - holder.x;
      const forceFinish = d > 0.72 && !resolved;
      const inShootZone = fwdOf > (forceFinish ? 0.6 : 0.76) && Math.abs(holder.y - 0.5) < 0.28;
      const pressD = nearestDef(defOut, holder.x, holder.y).d;
      const underPressure = pressD < SIM.pressRadius * 0.6;
      const behindLine = goalSign > 0 ? holder.x < advanceX - 0.03 : holder.x > advanceX + 0.03;

      // a corner is delivered into the box first of all
      if (cornerCrossPending) {
        const tgt = boxTarget(atts, holder, goalX, goalSign) ?? holder;
        const a = Math.atan2(0.5 - ball.y, goalX - goalSign * 0.1 - ball.x);
        ball.inFlight = true; ball.vx = Math.cos(a) * SIM.passSpeed; ball.vy = Math.sin(a) * SIM.passSpeed;
        receiver = tgt; holder = null as unknown as Ent; cornerCrossPending = false; event = "corner";
      } else if (!resolved && inShootZone && (forceFinish || rng() < 0.05)) {
        const ty = goalY + (rng() - 0.5) * 0.12;
        const a = Math.atan2(ty - ball.y, goalX - ball.x);
        ball.inFlight = true; pendingShot = true; receiver = null; holder = null as unknown as Ent;
        ball.vx = Math.cos(a) * SIM.shotSpeed; ball.vy = Math.sin(a) * SIM.shotSpeed; event = "shot";
      } else {
        const wantForward = forceFinish || behindLine || underPressure;
        const tgt = pickPass(atts, holder, defs, goalSign, advanceX, wantForward, rng);
        const doPass = tgt && (underPressure || rng() < (wantForward ? 0.45 : 0.6));
        if (doPass && tgt) {
          const la = Math.atan2(goalY - tgt.y, goalX - tgt.x);
          const ax = tgt.x + Math.cos(la) * SIM.lead, ay = tgt.y + Math.sin(la) * SIM.lead;
          const a = Math.atan2(ay - ball.y, ax - ball.x);
          ball.inFlight = true; ball.vx = Math.cos(a) * SIM.passSpeed; ball.vy = Math.sin(a) * SIM.passSpeed;
          receiver = tgt; holder = null as unknown as Ent; event = event ?? "pass";
        } else {
          const tx = wantForward ? goalX : holder.x;
          const ty = wantForward ? holder.y + (goalY - holder.y) * 0.3 : clamp01(holder.y + (rng() - 0.5) * 0.4);
          const a = Math.atan2(ty - holder.y, tx - holder.x || goalSign * 1e-3);
          holder.vx = Math.cos(a) * SIM.dribble; holder.vy = Math.sin(a) * SIM.dribble;
          ball.x = holder.x + Math.cos(a) * 0.02; ball.y = holder.y + Math.sin(a) * 0.02;
        }
      }
    } else if (ball.inFlight) {
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      ball.vx *= SIM.friction; ball.vy *= SIM.friction;
      if (pendingShot) {
        const past = att === "a" ? ball.x >= goalX - 0.012 : ball.x <= goalX + 0.012;
        if (past) {
          ball.inFlight = false; pendingShot = false; ball.vx = ball.vy = 0;
          if (beat.kind === "goal") { resolved = true; goalFrame = frames.length; ball.x = goalX; ball.y = clamp(0.5 + (ball.y - 0.5) * 0.4, 0.43, 0.57); event = "goal"; }
          else { resolved = true; ball.x = att === "a" ? goalX - 0.03 : goalX + 0.03; ball.y = goalY + (rng() - 0.5) * 0.1; defGk.x = ball.x; defGk.y = ball.y; event = "save"; }
        }
      } else if (receiver) {
        const dd = dist(ball.x, ball.y, receiver.x, receiver.y);
        const slow = Math.hypot(ball.vx, ball.vy) < 0.14;
        if (dd < SIM.controlRadius * 1.6 || (slow && dd < 0.06)) { holder = receiver; receiver = null; ball.inFlight = false; ball.vx = ball.vy = 0; ball.x = holder.x; ball.y = holder.y; }
      } else if (Math.hypot(ball.vx, ball.vy) < 0.1) { holder = nearestEnt(atts, ball.x, ball.y); ball.inFlight = false; ball.vx = ball.vy = 0; }
    }

    // ── movement: shape, runs, pressing ──
    const lineFront = advanceX;
    for (const e of atts) {
      if (e === holder || e === receiver) { if (e === receiver) steer(e, ball.x, ball.y); continue; }
      const wide = e.home.y < 0.5 ? -1 : 1;
      let tx: number, ty: number;
      if (e.role === "att") {
        const central = Math.abs(e.home.y - 0.5) < 0.12;
        const finalThird = (goalSign > 0 ? lineFront : 1 - lineFront) > 0.66;
        if (finalThird) { tx = clamp01(goalX - goalSign * (0.09 + rng() * 0.12)); ty = central ? clamp01(0.5 + (rng() - 0.5) * 0.18) : clamp01(0.5 + wide * (0.14 + rng() * 0.08)); }
        else { tx = clamp01(lineFront + goalSign * SIM.attAhead); ty = central ? clamp01(0.5 + (rng() - 0.5) * 0.04) : clamp01(0.5 + wide * SIM.wingWide); }
      } else if (e.role === "mid") {
        tx = clamp01(lineFront - goalSign * SIM.midBehind); ty = clamp01(lerp(e.home.y, 0.5, 0.18));
      } else if (e.role === "def") {
        tx = clamp01(lerp(e.home.x, lineFront, SIM.defUp)); ty = e.home.y;
      } else { tx = e.home.x; ty = lerp(0.5, ball.y, 0.25); }
      steer(e, tx, ty);
    }

    // Banks hold goal-side of the ball but never drop ONTO the goal line — they cap at the
    // box edge (only the keeper sits on the line), so the defence doesn't pile up on it.
    const defCap = goalX - goalSign * 0.13;
    const rawBack = advanceX + goalSign * SIM.defLineGap;
    const rawMid = advanceX + goalSign * SIM.defLineGap * 0.4;
    const backLineX = goalSign > 0 ? Math.min(rawBack, defCap) : Math.max(rawBack, defCap);
    const midLineX = goalSign > 0 ? Math.min(rawMid, defCap - 0.06) : Math.max(rawMid, defCap + 0.06);
    const ranked = defOut.map((e) => ({ e, d: dist(e.x, e.y, ball.x, ball.y) })).sort((a, b) => a.d - b.d);
    const pressers = new Set(ranked.slice(0, 2).map((s) => s.e));
    for (const e of defOut) {
      if (pressers.has(e)) { steer(e, ball.x, ball.y); continue; }
      steer(e, e.role === "mid" ? midLineX : backLineX, clamp01(lerp(e.home.y, ball.y, 0.12)));
    }
    steer(defGk, lerp(goalX, 0.5, 0.04), clamp(lerp(0.5, ball.y, 0.5), 0.38, 0.62));

    separate(ents);
    for (const e of ents) {
      const ms = SIM.maxSpeed[e.role], sp = Math.hypot(e.vx, e.vy);
      if (sp > ms) { e.vx = (e.vx / sp) * ms; e.vy = (e.vy / sp) * ms; }
      e.x = clamp01(e.x + e.vx * dt); e.y = clamp01(e.y + e.vy * dt);
    }
    if (holder) { ball.x = holder.x; ball.y = holder.y; }

    const ordered = [...ents.filter((e) => e.side === "a"), ...ents.filter((e) => e.side === "b")];
    frames.push({ ball: { x: clamp01(ball.x), y: clamp01(ball.y) }, inFlight: ball.inFlight, players: ordered.map((e) => ({ side: e.side, role: e.role, x: e.x, y: e.y })), event });
  }

  return { side: att, kind: beat.kind, restart, goalFrame, frames };
}

/** Simulate every key passage of a half (one per beat, in order). Deterministic. */
export function buildPassages(beats: ReelBeat[], matchId: string, half: 1 | 2): PassageSim[] {
  return beats.map((b, i) => simulatePassage(b, matchId, half, i));
}
