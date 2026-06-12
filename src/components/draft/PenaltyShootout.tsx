"use client";

/**
 * Interactive penalty shootout — cinematic night-stadium scene, shot from low
 * behind the penalty spot the way real penalty games frame it: the goal dominates
 * the top of the frame, the ball sits big in the foreground, floodlights flare
 * over a bokeh crowd, and the pitch stripes converge to a vanishing point.
 *
 * Pure presentation: every kick arrives already resolved (PenKick) — this
 * component never computes an outcome, it stages what it's given. Shared by the
 * solo flow (alternating: you shoot AND dive) and live H2H (simultaneous: you
 * shoot, the opponent's kicks stream into the scoreboard).
 *
 * Still deliberately cheap: one backdrop SVG + CSS transforms, no canvas, no rAF
 * loop, no deps, no image assets. Synthesized sound + haptics live in sfx.ts
 * behind a muted-by-default toggle; reduced motion gets instant text outcomes.
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

// ── Stage geometry (percent of the stage box; backdrop viewBox 0 0 100 100) ───
const GOAL = { left: 10, right: 90, bar: 20, line: 56 };
const COL_X = [25.5, 50, 74.5];
const ROW_Y = { high: 29, low: 46 } as const;
const SPOT = { x: 50, y: 85 };

const zoneX = (z: PenZone) => COL_X[z % 3];
const zoneY = (z: PenZone) => (z >= 3 ? ROW_Y.high : ROW_Y.low);
/** Where a missed ball ends up: over the bar for center, wide of the post for corners. */
const missTarget = (z: PenZone) => {
  const col = z % 3;
  if (col === 1) return { x: 50 + (z >= 3 ? 11 : -11), y: 6 };
  return { x: col === 0 ? 2 : 98, y: z >= 3 ? 14 : 36 };
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

// ── Crowd bokeh (deterministic so SSR/CSR match) ───────────────────────────────
const CROWD_COLORS = ["#41415e", "#37475e", "#503d52", "#3c5557", "#45405f", "#574a44"];
const CROWD = Array.from({ length: 240 }, (_, i) => {
  const row = Math.floor(i / 24);
  const wob = ((i * 73) % 17) / 17;
  return {
    x: ((i * 41) % 96) + 2 + wob * 2.2,
    y: 3 + row * 4.7 + (((i * 29) % 11) / 11) * 2.4,
    r: 0.55 + row * 0.075 + (((i * 53) % 7) / 7) * 0.22,
    c: CROWD_COLORS[i % CROWD_COLORS.length],
  };
});
const FLASHES = Array.from({ length: 7 }, (_, i) => ({
  x: ((i * 137) % 90) + 5,
  y: 5 + ((i * 61) % 40),
  d: (i * 0.9) % 4.2,
}));

// Converging mow stripes: bottom edge → vanishing point above the goal line.
const VANISH = { x: 50, y: 30 };
const STRIPES = Array.from({ length: 9 }, (_, i) => {
  const b0 = -22 + i * 16;
  const b1 = b0 + 16;
  const tx = (x: number) => VANISH.x + (x - VANISH.x) * 0.30;
  return { pts: `${b0},100 ${b1},100 ${tx(b1)},${GOAL.line} ${tx(b0)},${GOAL.line}`, dark: i % 2 === 0 };
});

function Backdrop({ reduced }: { reduced: boolean }) {
  // Net mesh: vertical strands bow outward, horizontals sag — a hung net, not a grid.
  const netV = Array.from({ length: 13 }, (_, i) => {
    const x = GOAL.left + 2.5 + i * ((GOAL.right - GOAL.left - 5) / 12);
    const bow = (x - 50) * 0.045;
    return `M ${x} ${GOAL.bar + 1.2} Q ${x + bow} ${(GOAL.bar + GOAL.line) / 2} ${x - bow * 0.4} ${GOAL.line - 0.8}`;
  });
  const netH = Array.from({ length: 8 }, (_, i) => {
    const y = GOAL.bar + 2.5 + i * ((GOAL.line - GOAL.bar - 5) / 7);
    return `M ${GOAL.left + 1.5} ${y} Q 50 ${y + 1.6} ${GOAL.right - 1.5} ${y}`;
  });
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pensSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05060d" />
          <stop offset="0.7" stopColor="#0b0e1d" />
          <stop offset="1" stopColor="#121627" />
        </linearGradient>
        <linearGradient id="pensTurf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c5c38" />
          <stop offset="0.5" stopColor="#15532f" />
          <stop offset="1" stopColor="#0b3a20" />
        </linearGradient>
        <radialGradient id="pensPool" cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" stopColor="rgba(235,255,240,0.16)" />
          <stop offset="0.55" stopColor="rgba(235,255,240,0.05)" />
          <stop offset="1" stopColor="rgba(235,255,240,0)" />
        </radialGradient>
        <radialGradient id="pensFlare" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(225,235,255,0.85)" />
          <stop offset="0.25" stopColor="rgba(205,220,255,0.28)" />
          <stop offset="1" stopColor="rgba(205,220,255,0)" />
        </radialGradient>
        <linearGradient id="pensBeam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(215,230,255,0.10)" />
          <stop offset="1" stopColor="rgba(215,230,255,0)" />
        </linearGradient>
      </defs>

      {/* night stand behind the goal + bokeh crowd */}
      <rect x="0" y="0" width="100" height="54" fill="url(#pensSky)" />
      <g opacity="0.6">
        {CROWD.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} />)}
      </g>
      <rect x="0" y="0" width="100" height="54" fill="rgba(4,5,10,0.5)" />
      {/* phone flashes twinkling in the crowd */}
      {!reduced && FLASHES.map((f, i) => (
        <circle key={i} cx={f.x} cy={f.y} r="0.5" fill="#fff"
          style={{ animation: `pensTwinkle 4.2s ease-in-out ${f.d}s infinite` }} />
      ))}

      {/* floodlight beams sweeping down onto the pitch */}
      <polygon points="2,0 22,0 64,56 30,56" fill="url(#pensBeam)" />
      <polygon points="78,0 98,0 70,56 36,56" fill="url(#pensBeam)" />

      {/* LED hoarding under the stand */}
      <rect x="0" y="50.2" width="100" height="3.9" fill="#070b14" />
      <rect x="0" y="50.2" width="100" height="3.9" fill="rgba(0,255,135,0.05)" />
      <text x="50" y="53.1" textAnchor="middle" fontSize="2.3" letterSpacing="1.7" fill="rgba(0,255,135,0.55)" fontFamily="inherit" fontWeight="bold">
        Y O U R S C O R E   ·   3 8 - 0   ·   Y O U R S C O R E   ·   3 8 - 0
      </text>

      {/* floodlit pitch with converging stripes */}
      <rect x="0" y="54" width="100" height="46" fill="url(#pensTurf)" />
      {STRIPES.map((s, i) => s.dark && <polygon key={i} points={s.pts} fill="rgba(0,0,0,0.16)" />)}
      <rect x="0" y="54" width="100" height="46" fill="url(#pensPool)" />
      {/* goal line + the D */}
      <rect x="0" y={GOAL.line - 0.35} width="100" height="0.8" fill="rgba(255,255,255,0.6)" />
      <path d={`M 14 100 Q 50 ${SPOT.y - 17} 86 100`} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
      <ellipse cx={SPOT.x} cy={SPOT.y + 0.5} rx="1.7" ry="0.6" fill="rgba(255,255,255,0.5)" />

      {/* goal mouth: dark interior, hung net, side panels */}
      <polygon points={`${GOAL.left},${GOAL.bar} ${GOAL.right},${GOAL.bar} ${GOAL.right},${GOAL.line} ${GOAL.left},${GOAL.line}`} fill="rgba(3,4,8,0.82)" />
      <g stroke="rgba(235,240,255,0.22)" strokeWidth="0.22" fill="none">
        {netV.map((d, i) => <path key={`v${i}`} d={d} />)}
        {netH.map((d, i) => <path key={`h${i}`} d={d} />)}
      </g>
      {/* side-net shading at the posts */}
      <polygon points={`${GOAL.left},${GOAL.bar} ${GOAL.left + 4.5},${GOAL.bar + 3} ${GOAL.left + 4.5},${GOAL.line} ${GOAL.left},${GOAL.line}`} fill="rgba(10,12,20,0.4)" />
      <polygon points={`${GOAL.right},${GOAL.bar} ${GOAL.right - 4.5},${GOAL.bar + 3} ${GOAL.right - 4.5},${GOAL.line} ${GOAL.right},${GOAL.line}`} fill="rgba(10,12,20,0.4)" />

      {/* frame: posts + crossbar with a 3D inner face and ground shadows */}
      <rect x={GOAL.left - 1} y={GOAL.bar - 0.4} width="1.8" height={GOAL.line - GOAL.bar + 0.4} rx="0.9" fill="#eef0f8" />
      <rect x={GOAL.left + 0.55} y={GOAL.bar} width="0.55" height={GOAL.line - GOAL.bar} fill="#9aa0b8" />
      <rect x={GOAL.right - 0.8} y={GOAL.bar - 0.4} width="1.8" height={GOAL.line - GOAL.bar + 0.4} rx="0.9" fill="#eef0f8" />
      <rect x={GOAL.right - 1.1} y={GOAL.bar} width="0.55" height={GOAL.line - GOAL.bar} fill="#9aa0b8" />
      <rect x={GOAL.left - 1} y={GOAL.bar - 1.1} width={GOAL.right - GOAL.left + 2} height="1.9" rx="0.95" fill="#eef0f8" />
      <rect x={GOAL.left - 1} y={GOAL.bar + 0.45} width={GOAL.right - GOAL.left + 2} height="0.55" fill="#9aa0b8" />
      <ellipse cx={GOAL.left} cy={GOAL.line + 0.5} rx="2.6" ry="0.55" fill="rgba(0,0,0,0.4)" />
      <ellipse cx={GOAL.right} cy={GOAL.line + 0.5} rx="2.6" ry="0.55" fill="rgba(0,0,0,0.4)" />

      {/* floodlight flares in the top corners */}
      <circle cx="7" cy="2" r="13" fill="url(#pensFlare)" />
      <circle cx="93" cy="2" r="13" fill="url(#pensFlare)" />
      <path d="M 1 2 H 13 M 7 -4 V 8" stroke="rgba(230,240,255,0.5)" strokeWidth="0.3" />
      <path d="M 87 2 H 99 M 93 -4 V 8" stroke="rgba(230,240,255,0.5)" strokeWidth="0.3" />
    </svg>
  );
}

// ── Articulated, shaded keeper ─────────────────────────────────────────────────
type KeeperPose = { body: string; armL: string; armR: string; legL: string; legR: string };
const POSES: Record<"set" | "stay" | "dive", KeeperPose> = {
  // Crouched on his toes, arms wide.
  set:  { body: "scaleY(0.94)", armL: "rotate(52deg)",  armR: "rotate(-52deg)",  legL: "rotate(7deg)",   legR: "rotate(-7deg)" },
  // Stood tall, arms straight up.
  stay: { body: "scaleY(1.05)", armL: "rotate(155deg)", armR: "rotate(-155deg)", legL: "rotate(0deg)",   legR: "rotate(0deg)" },
  // Full stretch (container handles the lean; the limbs reach with it).
  dive: { body: "none",         armL: "rotate(148deg)", armR: "rotate(-178deg)", legL: "rotate(-16deg)", legR: "rotate(24deg)" },
};

function Keeper({ color, dive, reach, glow, reduced }: {
  color: string;
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
      style={{
        position: "absolute", left: "50%", top: "31%", width: "13%", height: "26%",
        transform: `translateX(-50%) translateX(${dir * 182}%) translateY(${dive !== null ? reach : 0}%) rotate(${dir * 62}deg)`,
        transformOrigin: "50% 94%",
        transition: reduced ? undefined : "transform 0.42s cubic-bezier(0.3, 0.9, 0.4, 1)",
        filter: glow ? `drop-shadow(0 0 10px ${AMBER})` : "drop-shadow(0 4px 4px rgba(0,0,0,0.55))",
        zIndex: 3,
      }}
    >
      <svg viewBox="0 0 44 70" width="100%" height="100%" style={{ overflow: "visible", transform: pose.body, transformOrigin: "50% 92%" }}>
        <defs>
          <linearGradient id="pensKitShade" x1="0" y1="0" x2="1" y2="0.2">
            <stop offset="0" stopColor="rgba(255,255,255,0.28)" />
            <stop offset="0.45" stopColor="rgba(255,255,255,0)" />
            <stop offset="1" stopColor="rgba(0,0,0,0.34)" />
          </linearGradient>
        </defs>
        {/* legs: sock + boot */}
        <g style={limb(POSES === undefined ? "" : pose.legL, "17px 40px")}>
          <rect x="14.6" y="38" width="4.6" height="14" rx="2.3" fill={color} />
          <rect x="14.6" y="38" width="4.6" height="14" rx="2.3" fill="url(#pensKitShade)" />
          <rect x="14.6" y="47" width="4.6" height="5" rx="2" fill="#e8e8f0" />
          <path d="M 13.6 56.5 q 0 -3.4 3.3 -3.4 h 1.4 v 3.4 z" fill="#15151f" />
        </g>
        <g style={limb(pose.legR, "27px 40px")}>
          <rect x="24.8" y="38" width="4.6" height="14" rx="2.3" fill={color} />
          <rect x="24.8" y="38" width="4.6" height="14" rx="2.3" fill="url(#pensKitShade)" />
          <rect x="24.8" y="47" width="4.6" height="5" rx="2" fill="#e8e8f0" />
          <path d="M 30.4 56.5 q 0 -3.4 -3.3 -3.4 h -1.4 v 3.4 z" fill="#15151f" />
        </g>
        {/* shorts */}
        <path d="M 14 33 H 30 L 30.8 41 H 23.4 L 22 37.6 L 20.6 41 H 13.2 Z" fill="#11131d" />
        {/* torso: tapered jersey + form shading + collar */}
        <path d="M 15 16 Q 22 13.4 29 16 L 30.4 34 Q 22 36 13.6 34 Z" fill={color} />
        <path d="M 15 16 Q 22 13.4 29 16 L 30.4 34 Q 22 36 13.6 34 Z" fill="url(#pensKitShade)" />
        <path d="M 18.6 15.2 Q 22 17.4 25.4 15.2 L 24.4 18.4 H 19.6 Z" fill="rgba(0,0,0,0.3)" />
        <text x="22" y="27" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill="rgba(255,255,255,0.85)" fontFamily="inherit">1</text>
        {/* head: neck, face, hair */}
        <rect x="19.8" y="10.5" width="4.4" height="4" fill="#caa07e" />
        <circle cx="22" cy="7.6" r="5.6" fill="#d9ab84" />
        <circle cx="22" cy="7.6" r="5.6" fill="url(#pensKitShade)" opacity="0.5" />
        <path d="M 16.4 6.8 A 5.6 5.6 0 0 1 27.6 6.8 L 26.6 3.6 Q 22 0.9 17.4 3.6 Z" fill="#23222d" />
        {/* arms: capsule + glove */}
        <g style={limb(pose.armL, "16px 18px")}>
          <rect x="14" y="17" width="4.2" height="17" rx="2.1" fill={color} />
          <rect x="14" y="17" width="4.2" height="17" rx="2.1" fill="url(#pensKitShade)" />
          <circle cx="16.1" cy="35.4" r="3" fill="#f4f4f8" />
          <circle cx="16.1" cy="35.4" r="3" fill="url(#pensKitShade)" opacity="0.6" />
        </g>
        <g style={limb(pose.armR, "28px 18px")}>
          <rect x="25.8" y="17" width="4.2" height="17" rx="2.1" fill={color} />
          <rect x="25.8" y="17" width="4.2" height="17" rx="2.1" fill="url(#pensKitShade)" />
          <circle cx="27.9" cy="35.4" r="3" fill="#f4f4f8" />
          <circle cx="27.9" cy="35.4" r="3" fill="url(#pensKitShade)" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}

// ── The ball (panelled, lit from the floodlights) ──────────────────────────────
function Ball({ spinning, reduced }: { spinning: boolean; reduced: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="100%" height="100%"
      style={{ animation: spinning && !reduced ? "pensSpin 0.4s linear infinite" : undefined, display: "block" }}>
      <defs>
        <radialGradient id="pensBallLight" cx="0.32" cy="0.26" r="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e9e9f2" />
          <stop offset="1" stopColor="#7e8298" />
        </radialGradient>
      </defs>
      <circle cx="10" cy="10" r="9.5" fill="url(#pensBallLight)" />
      <polygon points="10,6.2 13.4,8.6 12.1,12.5 7.9,12.5 6.6,8.6" fill="#1d1d28" />
      <path d="M10 0.5 L10 6.2 M13.4 8.6 L19 6.8 M12.1 12.5 L15.8 17.2 M7.9 12.5 L4.2 17.2 M6.6 8.6 L1 6.8"
        stroke="#1d1d28" strokeWidth="1.05" fill="none" strokeLinecap="round" />
      <ellipse cx="7" cy="5.6" rx="2.6" ry="1.6" fill="rgba(255,255,255,0.65)" transform="rotate(-28 7 5.6)" />
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
    ball = { x: to.x, y: to.y, scale: 0.42 };
  } else if (aim !== null) {
    ball = { x: zoneX(aim), y: zoneY(aim), scale: 0.42 }; // optimistic flight to my aim
  }
  const dur = flightMs(anim?.slow ?? false);
  const ballHome = !inFlight && !stageKick;

  // Keeper: resolved kick's dive, or my optimistic pick while waiting.
  const diveCol: PenColumn | null = stageKick ? stageKick.dive : myDive;
  const keeperColor = stageSide === "me" ? PINK : GREEN;
  const saved = anim?.kind === "outcome" && anim.kick.outcome === "saved";
  // A saving keeper reaches the ball's row; a beaten one goes low.
  const reach = stageKick && diveCol !== null && diveCol !== 1
    ? (stageKick.outcome === "saved" && stageKick.shot >= 3 ? -30 : -4)
    : 0;

  const outcome = anim?.kind === "outcome" ? anim.kick.outcome : null;
  const outcomeText = outcome === "goal" ? "GOAL!" : outcome === "saved" ? "SAVED!" : outcome ? (anim!.kick.shot >= 3 && anim!.kick.shot % 3 === 1 ? "OVER!" : "WIDE!") : null;
  const outcomeColor = outcome === "goal" ? (stageSide === "me" ? GREEN : PINK) : outcome === "saved" ? AMBER : "#aab";

  const myGoals = view.myKicks.reduce((s, k) => s + (k.outcome === "goal" ? 1 : 0), 0);
  const oppGoals = view.oppKicks.reduce((s, k) => s + (k.outcome === "goal" ? 1 : 0), 0);
  const kickNo = Math.min(view.myKicks.length + (view.role === "shoot" ? 1 : 0), 5);

  const caption =
    view.result ? "" :
    view.role === "shoot" ? "Pick your spot — tap a target to put it there" :
    view.role === "dive" ? `${oppName} steps up — pick a way to dive` :
    simultaneous ? `Waiting for ${oppName}…` : "…";

  return (
    <div className="w-full select-none">
      <style>{`
        @keyframes pensNet { 0% { transform: scaleY(1); } 40% { transform: scaleY(1.05) translateY(1%); } 100% { transform: scaleY(1); } }
        @keyframes pensShake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
        @keyframes pensPop { 0% { transform: scale(0.55); opacity: 0; } 60% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes pensSpin { to { transform: rotate(360deg); } }
        @keyframes pensBurst { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(0.25); opacity: 0; } }
        @keyframes pensConfetti { 0% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translateY(46vh) rotate(540deg); opacity: 0; } }
        @keyframes pensTwinkle { 0%, 86%, 100% { opacity: 0; } 90% { opacity: 0.95; } 94% { opacity: 0.2; } }
        @keyframes pensRing { 0%, 100% { transform: scale(1); opacity: 0.75; } 50% { transform: scale(1.07); opacity: 1; } }
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
          aspectRatio: "10/9",
          background: "#05060d",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "inset 0 -26px 50px rgba(0,0,0,0.5), inset 0 14px 30px rgba(0,0,0,0.3)",
          transform: slowMo ? "scale(1.025)" : undefined,
          transition: "transform 0.5s ease",
          animation: outcome === "missed" && !reduced.current ? "pensShake 0.16s linear 2" : undefined,
        }}
      >
        <Backdrop reduced={reduced.current} />

        {/* sudden-death / slow-mo vignette */}
        {(view.suddenDeath || slowMo) && !view.result && (
          <div className={`absolute inset-0 pointer-events-none${reduced.current ? "" : " animate-pulse-slow"}`}
            style={{ boxShadow: `inset 0 0 52px ${slowMo ? "rgba(255,184,0,0.42)" : "rgba(255,184,0,0.22)"}`, borderRadius: 16, zIndex: 6 }} />
        )}
        {slowMo && (
          <div className="absolute left-1/2 -translate-x-1/2 rounded-md px-2 py-0.5 font-display"
            style={{ top: "5%", fontSize: 10, letterSpacing: 2, color: "#0a0a0f", background: AMBER, zIndex: 6 }}>
            DECIDING KICK
          </div>
        )}

        {/* net ripple + impact glow on goals */}
        {outcome === "goal" && !reduced.current && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ zIndex: 2 }}>
            <g style={{ animation: "pensNet 0.45s ease-out", transformOrigin: "50% 24%" }}>
              <polygon points={`${GOAL.left},${GOAL.bar} ${GOAL.right},${GOAL.bar} ${GOAL.right},${GOAL.line} ${GOAL.left},${GOAL.line}`} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.3" />
            </g>
            <ellipse cx={zoneX(anim!.kick.shot)} cy={zoneY(anim!.kick.shot)} rx="8" ry="7" fill={`${outcomeColor}29`} />
          </svg>
        )}

        {/* Keeper */}
        <Keeper color={keeperColor} dive={diveCol} reach={reach} glow={saved} reduced={reduced.current} />

        {/* Aim targets (shoot mode): pulsing rings, like a proper penalty game */}
        {canShoot &&
          ([3, 4, 5, 0, 1, 2] as PenZone[]).map((z, i) => (
            <button
              key={z}
              onClick={() => { setAim(z); sfx.kick(); buzz(15); onShoot(z); }}
              className="absolute active:scale-90"
              style={{
                left: `${zoneX(z) - 7.5}%`, top: `${zoneY(z) - 8.4}%`, width: "15%", aspectRatio: "1",
                borderRadius: "50%",
                border: "1.6px solid rgba(255,255,255,0.55)",
                boxShadow: "0 0 10px rgba(0,255,135,0.25), inset 0 0 10px rgba(0,255,135,0.12)",
                background: "radial-gradient(circle, rgba(0,255,135,0.12) 0%, rgba(0,255,135,0.03) 60%, transparent 70%)",
                animation: reduced.current ? undefined : `pensRing 1.6s ease-in-out ${i * 0.12}s infinite`,
                zIndex: 5,
              }}
              aria-label={`Aim ${z >= 3 ? "high" : "low"} ${z % 3 === 0 ? "left" : z % 3 === 1 ? "center" : "right"}`}
            >
              <span className="absolute rounded-full" style={{ left: "50%", top: "50%", width: 5, height: 5, transform: "translate(-50%,-50%)", background: "rgba(255,255,255,0.8)" }} />
            </button>
          ))}

        {/* Ball ground shadow (fades while airborne) */}
        <div className="absolute pointer-events-none" style={{
          left: `${SPOT.x}%`, top: `${SPOT.y + 4.2}%`, width: "8%", height: "2.4%",
          transform: "translateX(-50%)", borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(0,0,0,0.5) 0%, transparent 70%)",
          opacity: ballHome ? 1 : 0, transition: "opacity 0.3s", zIndex: 3,
        }} />

        {/* Ball + trail. The arc: the wrapper eases X linearly while the inner
            ball eases Y on a fast-rise curve — independent easings make a
            parabola. Ghosts lag via transition-delay for a motion trail. */}
        {[2, 1, 0].map((g) => {
          const ghost = g > 0;
          return (
            <div
              key={g}
              className="absolute inset-y-0 pointer-events-none"
              style={{
                left: `${ball.x}%`, width: "9%",
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
                  filter: ghost ? "blur(1.5px)" : "drop-shadow(0 5px 5px rgba(0,0,0,0.5))",
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
                  ["--dx" as never]: `${Math.cos(a) * (36 + (i % 3) * 15)}px` as never,
                  ["--dy" as never]: `${Math.sin(a) * (28 + (i % 3) * 13)}px` as never,
                  animation: "pensBurst 0.65s ease-out forwards",
                }} />
              );
            })}
          </div>
        )}

        {/* Outcome label */}
        {outcomeText && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 6 }}>
            <span className="font-display" style={{ fontSize: 42, letterSpacing: 3, color: outcomeColor, textShadow: "0 2px 18px rgba(0,0,0,0.85)", animation: reduced.current ? undefined : "pensPop 0.3s ease-out" }}>
              {outcomeText}
            </span>
          </div>
        )}

        {/* Final banner */}
        {view.result && !anim && allShown && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(4,5,10,0.86)", zIndex: 7 }}>
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
