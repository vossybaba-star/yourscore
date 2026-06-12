"use client";

/**
 * Interactive penalty shootout — the night-stadium scene. Tap a zone to shoot,
 * tap a side to dive. Pure presentation: every kick arrives already resolved
 * (PenKick), so this component never computes an outcome — it stages what it's
 * given. Shared by the solo flow (alternating: you shoot AND dive) and live H2H
 * (simultaneous: you shoot, the opponent's kicks stream into the scoreboard).
 *
 * Deliberately cheap: one background SVG + CSS transforms (GPU-composited), no
 * canvas, no rAF loop, no deps. The ball flies a real arc (linear X over an
 * eased Y), the keeper is articulated (set → dive → save poses), goals burst
 * particles, a kick that can settle the shootout plays in slow motion. Sound is
 * synthesized WebAudio behind a muted-by-default toggle (sfx.ts); reduced motion
 * drops to instant text outcomes.
 */

import { useEffect, useRef, useState } from "react";
import { shootoutStatus, type KickOutcome, type PenColumn, type PenKick, type PensMode, type PenZone } from "@/lib/draft/pens";
import { sfx, buzz, sfxEnabled, setSfxEnabled } from "@/lib/draft/sfx";

export type PensRole = "shoot" | "dive" | "waiting" | "done";

export type PensView = {
  /** Resolved kicks so far. `myKicks` = kicks I shot; `oppKicks` = theirs. */
  myKicks: PenKick[];
  oppKicks: PenKick[];
  suddenDeath: boolean;
  /** Which input is open right now. */
  role: PensRole;
  result: "win" | "loss" | null;
};

// ── Stage geometry (percent of the stage box; SVG viewBox 0 0 100 100) ────────
const COL_X = [27, 50, 73];
const ROW_Y = { high: 38.5, low: 53.5 } as const;
const SPOT = { x: 50, y: 86.5 };

const zoneX = (z: PenZone) => COL_X[z % 3];
const zoneY = (z: PenZone) => (z >= 3 ? ROW_Y.high : ROW_Y.low);
/** Where a missed ball ends up: over the bar for center, wide of the post for corners. */
const missTarget = (z: PenZone) => {
  const col = z % 3;
  if (col === 1) return { x: 50 + (z >= 3 ? 10 : -10), y: 14 };
  return { x: col === 0 ? 4 : 96, y: z >= 3 ? 24 : 46 };
};

const GREEN = "#00ff87";
const PINK = "#ff5c7a";
const AMBER = "#ffb800";

/** Could the NEXT kick by `kicker` settle the shootout (either way)? */
function couldDecide(my: PenKick[], opp: PenKick[], kicker: "me" | "opp", mode: PensMode): boolean {
  const K = (o: KickOutcome): PenKick => ({ shot: 1, dive: 0, outcome: o });
  const test = (o: KickOutcome) =>
    shootoutStatus(kicker === "me" ? [...my, K(o)] : my, kicker === "opp" ? [...opp, K(o)] : opp, mode).decided;
  return test("goal") || test("missed");
}

// ── Scoreboard pips ────────────────────────────────────────────────────────────
function Pips({ kicks, total, color, align }: { kicks: PenKick[]; total: number; color: string; align: "left" | "right" }) {
  const n = Math.max(total, kicks.length);
  const items = Array.from({ length: n }, (_, i) => kicks[i] ?? null);
  if (align === "right") items.reverse();
  return (
    <div className="flex gap-1.5" style={{ justifyContent: align === "left" ? "flex-start" : "flex-end" }}>
      {items.map((k, i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: 10, height: 10,
            background: k ? (k.outcome === "goal" ? color : "transparent") : "rgba(255,255,255,0.07)",
            border: k ? `1.5px solid ${k.outcome === "goal" ? color : "#5d5d72"}` : "1.5px solid rgba(255,255,255,0.15)",
            boxShadow: k?.outcome === "goal" ? `0 0 6px ${color}66` : undefined,
            position: "relative",
          }}
        >
          {k && k.outcome !== "goal" && (
            <span className="absolute inset-0 grid place-items-center" style={{ fontSize: 7, lineHeight: 1, color: "#5d5d72" }}>✕</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ── Articulated keeper ─────────────────────────────────────────────────────────
type KeeperPose = { body: string; armL: string; armR: string; legL: string; legR: string };
const POSES: Record<"set" | "stay" | "dive", KeeperPose> = {
  // Crouched, arms wide — on his toes.
  set:  { body: "scaleY(0.95)", armL: "rotate(48deg)",  armR: "rotate(-48deg)",  legL: "rotate(6deg)",   legR: "rotate(-6deg)" },
  // Stood tall, arms straight up.
  stay: { body: "scaleY(1.04)", armL: "rotate(152deg)", armR: "rotate(-152deg)", legL: "rotate(0deg)",   legR: "rotate(0deg)" },
  // Full stretch (container handles the lean/rotation; limbs reach with it).
  dive: { body: "none",         armL: "rotate(150deg)", armR: "rotate(-178deg)", legL: "rotate(-14deg)", legR: "rotate(22deg)" },
};

function Keeper({ color, dive, reach, glow, reduced }: {
  color: string;
  /** null = set position; 0/1/2 = committed dive (left/stay/right). */
  dive: PenColumn | null;
  /** Vertical reach for a committed dive: negative = flying high. */
  reach: number;
  glow: boolean;
  reduced: boolean;
}) {
  const pose = dive === null ? POSES.set : dive === 1 ? POSES.stay : POSES.dive;
  const dir = dive === 0 ? -1 : dive === 2 ? 1 : 0;
  const limb = (transform: string, origin: string): React.CSSProperties => ({
    transform, transformOrigin: origin,
    transition: reduced ? undefined : "transform 0.42s cubic-bezier(0.3, 0.9, 0.4, 1)",
  });
  return (
    <div
      className={!dive && !reduced ? "animate-pulse-slow" : undefined}
      style={{
        position: "absolute", left: "50%", top: "41%", width: "10.5%", height: "21.5%",
        transform: `translateX(-50%) translateX(${dir * 235}%) translateY(${dive !== null ? reach : 0}%) rotate(${dir * 64}deg)`,
        transformOrigin: "50% 92%",
        transition: reduced ? undefined : "transform 0.42s cubic-bezier(0.3, 0.9, 0.4, 1)",
        filter: glow ? `drop-shadow(0 0 9px ${AMBER})` : "drop-shadow(0 3px 3px rgba(0,0,0,0.45))",
        zIndex: 3,
      }}
    >
      <svg viewBox="0 0 36 60" width="100%" height="100%" style={{ overflow: "visible", transform: pose.body, transformOrigin: "50% 90%" }}>
        {/* legs + boots */}
        <g style={limb(pose.legL, "15px 35px")}>
          <rect x="13.2" y="34" width="3.8" height="16" rx="1.9" fill={color} opacity="0.82" />
          <rect x="12.4" y="49" width="5.4" height="3" rx="1.5" fill="#1a1a24" />
        </g>
        <g style={limb(pose.legR, "21px 35px")}>
          <rect x="19" y="34" width="3.8" height="16" rx="1.9" fill={color} opacity="0.82" />
          <rect x="18.2" y="49" width="5.4" height="3" rx="1.5" fill="#1a1a24" />
        </g>
        {/* shorts + torso */}
        <rect x="12" y="28.5" width="12" height="7.5" rx="2.4" fill="#10101a" />
        <path d="M13 13.5 Q18 11.5 23 13.5 L24.4 29 L11.6 29 Z" fill={color} />
        <rect x="14.6" y="16" width="6.8" height="1.6" rx="0.8" fill="rgba(0,0,0,0.25)" />
        {/* head */}
        <circle cx="18" cy="8" r="5" fill="#d9a883" />
        <path d="M13.2 6.6 A5 5 0 0 1 22.8 6.6 L22 4.4 A5 5 0 0 0 14 4.4 Z" fill="#2a2a36" />
        {/* arms + gloves */}
        <g style={limb(pose.armL, "13.6px 15px")}>
          <rect x="12" y="14" width="3.3" height="14.5" rx="1.65" fill={color} />
          <circle cx="13.6" cy="29.5" r="2.6" fill="#f2f2f6" />
        </g>
        <g style={limb(pose.armR, "22.4px 15px")}>
          <rect x="20.7" y="14" width="3.3" height="14.5" rx="1.65" fill={color} />
          <circle cx="22.4" cy="29.5" r="2.6" fill="#f2f2f6" />
        </g>
      </svg>
    </div>
  );
}

// ── The scene backdrop (one SVG: crowd, goal, net, pitch) ──────────────────────
function Backdrop() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <pattern id="pensCrowd" width="3.4" height="2.6" patternUnits="userSpaceOnUse">
          <circle cx="0.8" cy="0.7" r="0.55" fill="#3c3c52" />
          <circle cx="2.5" cy="1.9" r="0.55" fill="#2e3a4e" />
          <circle cx="1.7" cy="0.4" r="0.4" fill="#4a3a48" />
        </pattern>
        <pattern id="pensNetMesh" width="2.1" height="2.1" patternUnits="userSpaceOnUse">
          <path d="M0 0 H2.1 M0 0 V2.1" stroke="rgba(255,255,255,0.16)" strokeWidth="0.18" />
        </pattern>
        <linearGradient id="pensPitch" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d3220" />
          <stop offset="1" stopColor="#11402a" />
        </linearGradient>
      </defs>

      {/* crowd tiers */}
      <rect x="0" y="0" width="100" height="16" fill="url(#pensCrowd)" opacity="0.7" />
      <rect x="0" y="0" width="100" height="16" fill="#0a0a14" opacity="0.3" />
      <rect x="0" y="16" width="100" height="13" fill="url(#pensCrowd)" opacity="0.95" />
      <rect x="0" y="15.6" width="100" height="0.8" fill="#05050a" />
      <rect x="0" y="28.6" width="100" height="1" fill="#05050a" />
      {/* ad hoarding */}
      <rect x="0" y="29.6" width="100" height="3.6" fill="#0e1420" />
      <text x="50" y="32.3" textAnchor="middle" fontSize="2.1" letterSpacing="1.6" fill="rgba(0,255,135,0.4)" fontFamily="inherit">YOURSCORE · 38-0 · YOURSCORE · 38-0 · YOURSCORE</text>

      {/* pitch with perspective mowing bands */}
      <rect x="0" y="33.2" width="100" height="66.8" fill="url(#pensPitch)" />
      {[[33.2, 4.6], [37.8, 5.8], [49, 7.5], [64, 10], [82, 18]].map(([y, h], i) => (
        <rect key={i} x="0" y={y} width="100" height={h} fill={i % 2 ? "#0f3a26" : "#0a2a1a"} />
      ))}

      {/* goal: back plane + top + side netting, then the frame */}
      <polygon points="20,34.5 80,34.5 80,58.5 20,58.5" fill="rgba(6,8,13,0.82)" />
      <polygon points="20,34.5 80,34.5 80,58.5 20,58.5" fill="url(#pensNetMesh)" />
      <polygon points="15,30.5 85,30.5 80,34.5 20,34.5" fill="url(#pensNetMesh)" opacity="0.8" />
      <polygon points="15,30.5 20,34.5 20,58.5 15,62" fill="url(#pensNetMesh)" opacity="0.8" />
      <polygon points="85,30.5 80,34.5 80,58.5 85,62" fill="url(#pensNetMesh)" opacity="0.8" />
      <line x1="20" y1="58.5" x2="80" y2="58.5" stroke="rgba(255,255,255,0.18)" strokeWidth="0.25" />
      {/* posts + crossbar */}
      <rect x="14.3" y="30" width="1.4" height="32.4" rx="0.7" fill="#f4f4f8" />
      <rect x="84.3" y="30" width="1.4" height="32.4" rx="0.7" fill="#f4f4f8" />
      <rect x="14.3" y="29.6" width="71.4" height="1.5" rx="0.75" fill="#f4f4f8" />
      <rect x="14.3" y="30.9" width="71.4" height="0.4" fill="rgba(0,0,0,0.25)" />

      {/* markings: goal line, six-yard box, spot, arc */}
      <rect x="0" y="61.7" width="100" height="0.7" fill="rgba(255,255,255,0.5)" />
      <polygon points="24,62.4 76,62.4 79,73 21,73" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="0.55" />
      <ellipse cx="50" cy="86.5" rx="1.5" ry="0.75" fill="rgba(255,255,255,0.55)" />
      <path d="M30 100 Q50 90 70 100" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.55" />
    </svg>
  );
}

// ── The ball (white panels + spin) ─────────────────────────────────────────────
function Ball({ spinning, reduced }: { spinning: boolean; reduced: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="100%" height="100%"
      style={{ animation: spinning && !reduced ? "pensSpin 0.45s linear infinite" : undefined, display: "block" }}>
      <circle cx="10" cy="10" r="9.4" fill="#f5f5fa" />
      <circle cx="10" cy="10" r="9.4" fill="url(#pensBallShade)" />
      <defs>
        <radialGradient id="pensBallShade" cx="0.35" cy="0.3" r="0.95">
          <stop offset="0.45" stopColor="rgba(255,255,255,0)" />
          <stop offset="1" stopColor="rgba(40,40,60,0.55)" />
        </radialGradient>
      </defs>
      <polygon points="10,6.4 13.2,8.7 12,12.4 8,12.4 6.8,8.7" fill="#23232f" />
      <path d="M10 0.6 L10 6.4 M13.2 8.7 L18.8 7 M12 12.4 L15.5 17 M8 12.4 L4.5 17 M6.8 8.7 L1.2 7" stroke="#23232f" strokeWidth="1" fill="none" />
    </svg>
  );
}

type Anim =
  | { kind: "flight"; side: "me" | "opp"; kick: PenKick; slow: boolean }
  | { kind: "outcome"; side: "me" | "opp"; kick: PenKick; slow: boolean };

export function PenaltyShootout({
  view,
  myName,
  oppName,
  simultaneous,
  secondsLeft,
  onShoot,
  onDive,
}: {
  view: PensView;
  myName: string;
  oppName: string;
  /** Live H2H: opponent kicks tick into the scoreboard instead of the stage. */
  simultaneous?: boolean;
  /** Live phase timer (seconds), if any. */
  secondsLeft?: number | null;
  onShoot: (zone: PenZone) => void;
  onDive: (col: PenColumn) => void;
}) {
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);
  const mode: PensMode = simultaneous ? "simultaneous" : "alternating";

  // Reveal queue: how many kicks of each side have finished animating.
  const [shownMe, setShownMe] = useState(view.myKicks.length);
  const [shownOpp, setShownOpp] = useState(view.oppKicks.length);
  const [anim, setAnim] = useState<Anim | null>(null);
  // My pending aim/dive (tapped, kick not resolved yet) — the ball/keeper start
  // moving immediately so server RTT hides under the flight.
  const [aim, setAim] = useState<PenZone | null>(null);
  const [myDive, setMyDive] = useState<PenColumn | null>(null);
  const [sound, setSound] = useState(false);
  useEffect(() => { setSound(sfxEnabled()); }, []);

  const flightMs = (slow: boolean) => (reduced.current ? 0 : slow ? 1050 : 560);
  const OUTCOME_MS = reduced.current ? 650 : 950;

  // Start animating the next unrevealed kick (mine first, then opp).
  useEffect(() => {
    if (anim) return;
    const aPrev = view.myKicks.slice(0, shownMe);
    const bPrev = view.oppKicks.slice(0, shownOpp);
    if (shownMe < view.myKicks.length) {
      const slow = !reduced.current && couldDecide(aPrev, bPrev, "me", mode);
      if (slow) sfx.whistle();
      setAnim({ kind: "flight", side: "me", kick: view.myKicks[shownMe], slow });
      return;
    }
    if (shownOpp < view.oppKicks.length) {
      if (simultaneous) { setShownOpp((n) => n + 1); return; } // scoreboard only
      const slow = !reduced.current && couldDecide(aPrev, bPrev, "opp", mode);
      sfx.kick();
      setAnim({ kind: "flight", side: "opp", kick: view.oppKicks[shownOpp], slow });
    }
  }, [anim, shownMe, shownOpp, view.myKicks, view.oppKicks, simultaneous, mode]);

  // Flight lands → show the outcome. (Separate effect so re-renders can't cancel it.)
  useEffect(() => {
    if (anim?.kind !== "flight") return;
    const t = setTimeout(() => setAnim({ ...anim, kind: "outcome" }), flightMs(anim.slow));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);

  // Outcome shown → sound/buzz once, then bank the kick and clear the stage.
  useEffect(() => {
    if (anim?.kind !== "outcome") return;
    const { side, kick } = anim;
    if (kick.outcome === "goal") { if (side === "me") { sfx.goal(); buzz([25, 40, 80]); } else { sfx.miss(); buzz(15); } }
    else if (kick.outcome === "saved") { sfx.save(); buzz(side === "me" ? 60 : [40, 30, 40]); }
    else { sfx.miss(); buzz(side === "me" ? 30 : 15); }
    const t = setTimeout(() => {
      if (side === "me") setShownMe((n) => n + 1);
      else setShownOpp((n) => n + 1);
      setAnim(null);
      setAim(null);
      setMyDive(null);
    }, OUTCOME_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);

  // Final banner sound, once everything has been revealed.
  const cheered = useRef(false);
  const allShown = shownMe >= view.myKicks.length && shownOpp >= view.oppKicks.length;
  useEffect(() => {
    if (!view.result || anim || !allShown || cheered.current) return;
    cheered.current = true;
    if (view.result === "win") { sfx.win(); buzz([40, 60, 40, 60, 120]); }
    else { sfx.loss(); buzz(80); }
  }, [view.result, anim, allShown]);

  const busy = anim !== null || aim !== null || myDive !== null;
  const canShoot = view.role === "shoot" && !busy;
  const canDive = view.role === "dive" && !busy;

  // ── Stage state (ball, keeper, label) ────────────────────────────────────────
  const stageSide: "me" | "opp" =
    anim ? anim.side : myDive !== null || view.role === "dive" ? "opp" : "me";
  const stageKick = anim?.kick ?? null;
  const inFlight = anim?.kind === "flight" || (!anim && aim !== null);
  const slowMo = (anim?.slow ?? false) && anim?.kind === "flight";

  let ball = { x: SPOT.x, y: SPOT.y, scale: 1 };
  if (stageKick) {
    const to = stageKick.outcome === "missed" ? missTarget(stageKick.shot) : { x: zoneX(stageKick.shot), y: zoneY(stageKick.shot) };
    ball = { x: to.x, y: to.y, scale: 0.52 };
  } else if (aim !== null) {
    ball = { x: zoneX(aim), y: zoneY(aim), scale: 0.52 }; // optimistic flight to my aim
  }
  const dur = flightMs(anim?.slow ?? false);

  // Keeper: resolved kick's dive, or my optimistic pick while waiting.
  const diveCol: PenColumn | null = stageKick ? stageKick.dive : myDive;
  const keeperColor = stageSide === "me" ? PINK : GREEN;
  const saved = anim?.kind === "outcome" && anim.kick.outcome === "saved";
  // A saving keeper reaches the ball's row; a beaten one goes low.
  const reach = stageKick && diveCol !== null && diveCol !== 1
    ? (stageKick.outcome === "saved" && stageKick.shot >= 3 ? -34 : -6)
    : 0;

  const outcome = anim?.kind === "outcome" ? anim.kick.outcome : null;
  const outcomeText = outcome === "goal" ? "GOAL!" : outcome === "saved" ? "SAVED!" : outcome ? (anim!.kick.shot >= 3 && anim!.kick.shot % 3 === 1 ? "OVER!" : "WIDE!") : null;
  const outcomeColor = outcome === "goal" ? (stageSide === "me" ? GREEN : PINK) : outcome === "saved" ? AMBER : "#aab";

  const myGoals = view.myKicks.reduce((s, k) => s + (k.outcome === "goal" ? 1 : 0), 0);
  const oppGoals = view.oppKicks.reduce((s, k) => s + (k.outcome === "goal" ? 1 : 0), 0);
  const kickNo = Math.min(view.myKicks.length + (view.role === "shoot" ? 1 : 0), 5);

  const caption =
    view.result ? "" :
    view.role === "shoot" ? "Pick your spot — tap where you want to put it" :
    view.role === "dive" ? `${oppName} steps up — pick a way to dive` :
    simultaneous ? `Waiting for ${oppName}…` : "…";

  return (
    <div className="w-full select-none">
      <style>{`
        @keyframes pensNet { 0% { transform: scaleY(1); } 40% { transform: scaleY(1.06) translateY(1.5%); } 100% { transform: scaleY(1); } }
        @keyframes pensShake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
        @keyframes pensPop { 0% { transform: scale(0.55); opacity: 0; } 60% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes pensSpin { to { transform: rotate(360deg); } }
        @keyframes pensBurst { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(0.25); opacity: 0; } }
        @keyframes pensConfetti { 0% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translateY(46vh) rotate(540deg); opacity: 0; } }
      `}</style>

      {/* Scoreboard */}
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex-1 min-w-0">
          <div className="font-body truncate" style={{ fontSize: 11, color: GREEN }}>{myName}</div>
          <Pips kicks={view.myKicks} total={5} color={GREEN} align="left" />
        </div>
        <div className="px-3 text-center">
          <div className="font-display tabular-nums" style={{ fontSize: 27, color: "#fff", letterSpacing: 2, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
            {myGoals}–{oppGoals}
          </div>
          <div className="font-display" style={{ fontSize: 10, letterSpacing: 2, color: view.suddenDeath ? AMBER : "#8888aa" }}>
            {view.result ? "PENALTIES" : view.suddenDeath ? "☠ SUDDEN DEATH" : `KICK ${Math.max(kickNo, 1)} OF 5`}
          </div>
        </div>
        <div className="flex-1 min-w-0 text-right">
          <div className="font-body truncate" style={{ fontSize: 11, color: PINK }}>{oppName}</div>
          <Pips kicks={view.oppKicks} total={5} color={PINK} align="right" />
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative w-full overflow-hidden rounded-2xl"
        style={{
          aspectRatio: "10/8",
          background:
            "radial-gradient(ellipse 60% 38% at 18% -6%, rgba(210,225,255,0.14) 0%, transparent 60%)," +
            "radial-gradient(ellipse 60% 38% at 82% -6%, rgba(210,225,255,0.14) 0%, transparent 60%)," +
            "linear-gradient(180deg, #07070f 0%, #0b0d1a 30%, #0d3220 34%, #11402a 100%)",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "inset 0 -18px 40px rgba(0,0,0,0.35)",
          transform: slowMo ? "scale(1.025)" : undefined,
          transition: "transform 0.5s ease",
          animation: outcome === "missed" && !reduced.current ? "pensShake 0.16s linear 2" : undefined,
        }}
      >
        <Backdrop />

        {/* sudden-death / slow-mo vignette */}
        {(view.suddenDeath || slowMo) && !view.result && (
          <div className={`absolute inset-0 pointer-events-none${reduced.current ? "" : " animate-pulse-slow"}`}
            style={{ boxShadow: `inset 0 0 46px ${slowMo ? "rgba(255,184,0,0.4)" : "rgba(255,184,0,0.22)"}`, borderRadius: 16 }} />
        )}
        {slowMo && (
          <div className="absolute left-1/2 -translate-x-1/2 rounded-md px-2 py-0.5 font-display"
            style={{ top: "6%", fontSize: 10, letterSpacing: 2, color: "#0a0a0f", background: AMBER, zIndex: 6 }}>
            DECIDING KICK
          </div>
        )}

        {/* net ripple overlay on goals (re-renders the mesh with the animation) */}
        {outcome === "goal" && !reduced.current && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ zIndex: 2 }}>
            <g style={{ animation: "pensNet 0.45s ease-out", transformOrigin: "50% 35%" }}>
              <polygon points="20,34.5 80,34.5 80,58.5 20,58.5" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
            </g>
            <ellipse cx={zoneX(anim!.kick.shot)} cy={zoneY(anim!.kick.shot)} rx="7" ry="6" fill={`${outcomeColor}26`} />
          </svg>
        )}

        {/* Keeper */}
        <Keeper color={keeperColor} dive={diveCol} reach={reach} glow={saved} reduced={reduced.current} />

        {/* Aim zones (shoot mode) */}
        {canShoot &&
          ([3, 4, 5, 0, 1, 2] as PenZone[]).map((z) => (
            <button
              key={z}
              onClick={() => { setAim(z); sfx.kick(); buzz(15); onShoot(z); }}
              className="absolute rounded-lg active:scale-95"
              style={{
                left: `${zoneX(z) - 10.5}%`, top: `${zoneY(z) - 7.2}%`, width: "21%", height: "14.5%",
                border: "1px dashed rgba(0,255,135,0.16)",
                background: "transparent",
                zIndex: 5,
              }}
              aria-label={`Aim ${z >= 3 ? "high" : "low"} ${z % 3 === 0 ? "left" : z % 3 === 1 ? "center" : "right"}`}
            >
              <span className="absolute rounded-full" style={{ left: "50%", top: "50%", width: 3, height: 3, transform: "translate(-50%,-50%)", background: "rgba(0,255,135,0.4)" }} />
            </button>
          ))}

        {/* Ball + trail. The arc: the outer wrapper eases X linearly while the
            inner ball eases Y on a fast-rise curve — independent easings make a
            parabola. Ghosts lag via transition-delay for a motion trail. */}
        {[2, 1, 0].map((g) => {
          const ghost = g > 0;
          return (
            <div
              key={g}
              className="absolute inset-y-0 pointer-events-none"
              style={{
                left: `${ball.x}%`, width: "6%",
                transform: "translateX(-50%)",
                transition: reduced.current ? undefined : `left ${dur}ms linear ${g * 55}ms`,
                opacity: ghost ? (inFlight ? (g === 1 ? 0.3 : 0.15) : 0) : outcome === "missed" ? 0.35 : 1,
                zIndex: 4,
              }}
            >
              <div
                className="absolute w-full"
                style={{
                  aspectRatio: "1",
                  top: `${ball.y}%`,
                  transform: `translateY(-50%) scale(${inFlight || stageKick ? ball.scale : 1})`,
                  transition: reduced.current ? undefined
                    : `top ${dur}ms cubic-bezier(0.2, 0.85, 0.4, 1) ${g * 55}ms, transform ${dur}ms ease-out ${g * 55}ms`,
                  filter: ghost ? "blur(1px)" : "drop-shadow(0 3px 3px rgba(0,0,0,0.45))",
                }}
              >
                <Ball spinning={!!inFlight && !ghost} reduced={reduced.current} />
              </div>
            </div>
          );
        })}

        {/* Goal burst particles */}
        {outcome === "goal" && !reduced.current && (
          <div className="absolute pointer-events-none" style={{ left: `${zoneX(anim!.kick.shot)}%`, top: `${zoneY(anim!.kick.shot)}%`, zIndex: 5 }}>
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              return (
                <span key={i} className="absolute rounded-full" style={{
                  width: i % 3 ? 5 : 7, height: i % 3 ? 5 : 7,
                  background: i % 4 === 0 ? "#fff" : outcomeColor,
                  ["--dx" as never]: `${Math.cos(a) * (34 + (i % 3) * 14)}px` as never,
                  ["--dy" as never]: `${Math.sin(a) * (26 + (i % 3) * 12)}px` as never,
                  animation: "pensBurst 0.65s ease-out forwards",
                }} />
              );
            })}
          </div>
        )}

        {/* Outcome label */}
        {outcomeText && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 6 }}>
            <span className="font-display" style={{ fontSize: 40, letterSpacing: 3, color: outcomeColor, textShadow: "0 2px 16px rgba(0,0,0,0.8)", animation: reduced.current ? undefined : "pensPop 0.3s ease-out" }}>
              {outcomeText}
            </span>
          </div>
        )}

        {/* Final banner */}
        {view.result && !anim && allShown && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(6,6,12,0.84)", zIndex: 7 }}>
            {view.result === "win" && !reduced.current && (
              <div className="absolute inset-x-0 top-0 pointer-events-none">
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i} className="absolute" style={{
                    left: `${6 + i * 6.5}%`, top: "-4%", width: 6, height: 10,
                    background: [GREEN, AMBER, "#fff", PINK][i % 4],
                    animation: `pensConfetti ${1.6 + (i % 5) * 0.3}s ease-in ${(i % 7) * 0.12}s forwards`,
                  }} />
                ))}
              </div>
            )}
            <div className="font-display" style={{ fontSize: 37, letterSpacing: 3, color: view.result === "win" ? GREEN : PINK, textShadow: `0 0 26px ${view.result === "win" ? GREEN : PINK}55`, animation: reduced.current ? undefined : "pensPop 0.35s ease-out" }}>
              {view.result === "win" ? "YOU WIN ON PENS" : "LOST ON PENS"}
            </div>
            <div className="font-display tabular-nums" style={{ fontSize: 23, color: "#fff", letterSpacing: 2 }}>
              {myGoals}–{oppGoals}
            </div>
          </div>
        )}

        {/* Sound toggle */}
        <button
          onClick={() => { const next = !sound; setSound(next); setSfxEnabled(next); if (next) sfx.whistle(); }}
          className="absolute top-2 left-2 rounded-md px-1.5 py-1"
          style={{ fontSize: 11, background: "rgba(10,10,15,0.65)", border: "1px solid rgba(255,255,255,0.1)", zIndex: 8, lineHeight: 1, opacity: 0.85 }}
          aria-label={sound ? "Mute sound" : "Enable sound"}
        >
          {sound ? "🔊" : "🔇"}
        </button>

        {/* Timer chip (live) */}
        {secondsLeft != null && !view.result && (
          <div className="absolute top-2 right-2 rounded-lg px-2 py-0.5 font-display tabular-nums" style={{ fontSize: 13, color: secondsLeft <= 10 ? AMBER : "#fff", background: "rgba(10,10,15,0.7)", letterSpacing: 1, zIndex: 8 }}>
            {secondsLeft}s
          </div>
        )}
      </div>

      {/* Dive buttons / caption */}
      {canDive ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([0, 1, 2] as PenColumn[]).map((c) => (
            <button
              key={c}
              onClick={() => { setMyDive(c); sfx.kick(); buzz(15); onDive(c); }}
              className="rounded-xl py-3 font-display active:scale-[0.97] transition-transform"
              style={{ fontSize: 14, letterSpacing: 1.5, color: GREEN, background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.35)" }}
            >
              {c === 0 ? "◀ DIVE LEFT" : c === 1 ? "STAY BIG" : "DIVE RIGHT ▶"}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-center font-body" style={{ fontSize: 12, color: "#9a9ab0", minHeight: 18 }}>
          {caption}
        </div>
      )}
    </div>
  );
}
