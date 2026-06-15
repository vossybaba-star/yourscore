"use client";

/**
 * 2D penalty scene — the render layer for the shootout. Replaces the old WebGL/R3F
 * scene with pre-rendered sprites of the purchased StudioOchi players (baked to
 * /public/sprites via the dev spike), composited over a CSS goal with GPU-composited
 * CSS transforms for the ball flight + keeper dive. No three.js, no context loss.
 *
 * Fixed positions (the human never swaps seats): the TAKER (lime) always stands at
 * the spot facing the goal, the KEEPER (purple) always stands in the goal. A "YOU"
 * marker floats over whichever player the human controls this turn (`defending`).
 *
 * Drop-in prop surface matches PenaltyScene3D so PenaltyShootout is a one-line swap.
 */

import { useEffect, useRef, useState } from "react";
import { zoneColumn, zoneRow, type KickOutcome, type PenColumn, type PenZone } from "@/lib/draft/pens";

type Play = { shot: PenZone; dive: PenColumn; outcome: KickOutcome; side: "me" | "opp" } | null;

const ME = "#b4ff2e";   // lime — you
const OPP = "#a06bff";  // purple — opponent

// Goal mouth as % of the stage (the net opening the ball flies into).
const GOAL = { left: 15, right: 85, top: 27, bottom: 55 };
const colX = (c: PenColumn) => GOAL.left + (GOAL.right - GOAL.left) * (c === 0 ? 1 / 6 : c === 1 ? 0.5 : 5 / 6);
// row 0 = low, 1 = mid, 2 = high → screen y (high is nearer the crossbar = smaller y)
const rowY = (r: 0 | 1 | 2) => GOAL.top + (GOAL.bottom - GOAL.top) * (r === 2 ? 0.22 : r === 1 ? 0.5 : 0.8);

const SPOT = { x: 50, y: 74 }; // penalty spot (ball rest), % of stage

function zonePos(z: PenZone) {
  return { x: colX(zoneColumn(z)), y: rowY(zoneRow(z)) };
}

/** Where the ball actually ends up: into the zone on a goal; near the keeper on a
 *  save; wide/over the bar on a miss. */
function ballTarget(z: PenZone, outcome: KickOutcome) {
  const p = zonePos(z);
  if (outcome === "goal") return p;
  if (outcome === "saved") return { x: (p.x + 50) / 2, y: p.y + 2 }; // parried toward centre
  // missed: off-target — wide of the post or over the bar
  const col = zoneColumn(z);
  if (zoneRow(z) === 2) return { x: p.x, y: GOAL.top - 9 };          // skied over
  return { x: col === 0 ? GOAL.left - 7 : col === 2 ? GOAL.right + 7 : p.x, y: p.y }; // wide
}

export default function PenaltyScene2D({ aim, play, onPlayed, reduced, defending }: {
  aim: PenZone | null;
  play: Play;
  onPlayed: () => void;
  reduced: boolean;
  defending: boolean;
}) {
  // Animation state for the current play.
  const [kicking, setKicking] = useState(false);     // taker on strike frame
  const [ballFly, setBallFly] = useState(false);      // ball released to target
  const [diving, setDiving] = useState(false);        // keeper committed to dive
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const firedRef = useRef(false);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    firedRef.current = false;
    if (!play) { setKicking(false); setBallFly(false); setDiving(false); return; }

    const fire = () => { if (!firedRef.current) { firedRef.current = true; onPlayed(); } };
    if (reduced) {
      setKicking(true); setBallFly(true); setDiving(true);
      timers.current.push(setTimeout(fire, 260));
      return;
    }
    // run-up → strike → ball flight + keeper dive → settle
    const t = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    t(140, () => setKicking(true));            // plant + swing
    t(300, () => { setBallFly(true); setDiving(true); }); // contact: release ball, keeper commits
    t(300 + 620 + 220, fire);                  // flight + settle
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [play, reduced, onPlayed]);

  // Ball position.
  const ball = play && ballFly ? ballTarget(play.shot, play.outcome) : SPOT;
  const ballScale = play && ballFly ? 0.6 : 1; // shrinks with distance into the goal

  // Keeper dive transform (front-facing; reach sprite tipped toward the dive side).
  const dcol = play?.dive ?? 1;
  const high = play ? zoneRow(play.shot) === 2 : false;
  const keeperImg = !diving ? "ready" : dcol === 1 ? "catch" : "dive";
  let keeperTf = "translate(-50%, -50%)";
  if (diving && dcol !== 1) {
    const dir = dcol === 0 ? -1 : 1; // 0 = shooter's left = screen left
    keeperTf = `translate(-50%, -50%) translateX(${dir * 24}%) translateY(${high ? -16 : 6}%) rotate(${dir * 72}deg)`;
  } else if (diving && dcol === 1 && high) {
    keeperTf = "translate(-50%, -50%) translateY(-16%)";
  }

  const reticle = aim !== null ? zonePos(aim) : null;
  const youAtTaker = !defending;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(#0a1430 0%, #0c1a14 58%, #0e2a17 100%)" }}>
      {/* crowd / floodlight haze */}
      <div className="absolute inset-x-0 top-0" style={{ height: "30%", background: "radial-gradient(120% 100% at 50% 0%, rgba(180,255,46,0.07), transparent 70%)" }} />

      {/* pitch */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: "58%", background: "linear-gradient(#1d7a32 0%, #19682b 60%, #145222 100%)" }} />
      {/* penalty arc + spot */}
      <div className="absolute" style={{ left: `${SPOT.x}%`, top: `${SPOT.y + 3}%`, width: "40%", height: "16%", transform: "translate(-50%,-50%)", border: "2px solid rgba(255,255,255,0.18)", borderRadius: "50%", borderBottomColor: "transparent" }} />
      <div className="absolute rounded-full" style={{ left: `${SPOT.x}%`, top: `${SPOT.y + 8}%`, width: 7, height: 4, transform: "translate(-50%,-50%)", background: "rgba(255,255,255,0.5)" }} />

      {/* goal frame + net */}
      <Goal />

      {/* keeper (in goal) */}
      <img
        src="/sprites/keeper_ready.png" alt="" aria-hidden
        style={spriteStyle("keeper", keeperImg === "ready", keeperTf)}
      />
      <img src="/sprites/keeper_dive.png" alt="" aria-hidden style={spriteStyle("keeper", keeperImg === "dive", keeperTf)} />
      <img src="/sprites/keeper_catch.png" alt="" aria-hidden style={spriteStyle("keeper", keeperImg === "catch", keeperTf)} />

      {/* aim reticle on the goal */}
      {reticle && (
        <div className="absolute" style={{ left: `${reticle.x}%`, top: `${reticle.y}%`, transform: "translate(-50%,-50%)", width: 34, height: 34, borderRadius: "50%", border: `3px solid ${ME}`, boxShadow: `0 0 14px ${ME}aa`, animation: "pens2dPulse 1s ease-in-out infinite" }} />
      )}

      {/* ball */}
      <div
        className="absolute rounded-full"
        style={{
          left: `${ball.x}%`, top: `${ball.y}%`, width: "6.5%", aspectRatio: "1 / 1",
          transform: `translate(-50%,-50%) scale(${ballScale})`,
          background: "radial-gradient(circle at 35% 30%, #fff 0%, #e9edf2 55%, #b9c0c8 100%)",
          boxShadow: "0 3px 8px rgba(0,0,0,0.45)",
          transition: reduced || !ballFly ? "none" : "left 620ms cubic-bezier(.3,.5,.5,1), top 620ms cubic-bezier(.3,.5,.5,1), transform 620ms ease-out",
          zIndex: 6,
        }}
      />

      {/* taker (foreground) */}
      <img src="/sprites/taker_idle.png" alt="" aria-hidden style={spriteStyle("taker", !kicking)} />
      <img src="/sprites/taker_kick.png" alt="" aria-hidden style={spriteStyle("taker", kicking)} />

      {/* YOU marker */}
      <YouMarker atTaker={youAtTaker} />

      <style>{`@keyframes pens2dPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.85}50%{transform:translate(-50%,-50%) scale(1.15);opacity:1}}`}</style>
    </div>
  );
}

/** Shared positioning for a sprite layer. Sprites are 1:1 with the player baked at a
 *  consistent spot, so each role's frames share one box and cross-fade. */
function spriteStyle(role: "taker" | "keeper", visible: boolean, transform?: string): React.CSSProperties {
  if (role === "keeper") {
    return {
      position: "absolute", left: "50%", top: `${(GOAL.top + GOAL.bottom) / 2 + 4}%`,
      height: "42%", width: "auto", transform: transform ?? "translate(-50%,-50%)",
      transformOrigin: "50% 60%",
      transition: "transform 360ms cubic-bezier(.4,.7,.4,1), opacity 120ms linear",
      opacity: visible ? 1 : 0, zIndex: 4, pointerEvents: "none",
      filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))",
    };
  }
  return {
    position: "absolute", left: "50%", bottom: "-12%",
    height: "78%", width: "auto", transform: "translate(-50%,0)",
    transition: "opacity 80ms linear",
    opacity: visible ? 1 : 0, zIndex: 7, pointerEvents: "none",
    filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.5))",
  };
}

function Goal() {
  return (
    <svg className="absolute" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ left: 0, top: 0, width: "100%", height: "100%", zIndex: 3 }} aria-hidden>
      {/* net */}
      <g stroke="rgba(255,255,255,0.16)" strokeWidth="0.18">
        {Array.from({ length: 15 }).map((_, i) => {
          const x = GOAL.left + ((GOAL.right - GOAL.left) * i) / 14;
          return <line key={`v${i}`} x1={x} y1={GOAL.top} x2={x} y2={GOAL.bottom} />;
        })}
        {Array.from({ length: 7 }).map((_, i) => {
          const y = GOAL.top + ((GOAL.bottom - GOAL.top) * i) / 6;
          return <line key={`h${i}`} x1={GOAL.left} y1={y} x2={GOAL.right} y2={y} />;
        })}
      </g>
      {/* posts + crossbar */}
      <g fill="none" stroke="#f3f6f8" strokeWidth="0.9" strokeLinecap="round">
        <line x1={GOAL.left} y1={GOAL.bottom} x2={GOAL.left} y2={GOAL.top} />
        <line x1={GOAL.right} y1={GOAL.bottom} x2={GOAL.right} y2={GOAL.top} />
        <line x1={GOAL.left} y1={GOAL.top} x2={GOAL.right} y2={GOAL.top} />
      </g>
    </svg>
  );
}

function YouMarker({ atTaker }: { atTaker: boolean }) {
  // chip + downward arrow; sits above the taker (bottom) or the keeper (in goal)
  const top = atTaker ? "62%" : `${GOAL.top - 6}%`;
  return (
    <div className="absolute" style={{ left: "50%", top, transform: "translate(-50%,-50%)", zIndex: 8, transition: "top 300ms ease, left 300ms ease", pointerEvents: "none" }}>
      <div className="font-display" style={{ background: ME, color: "#0c1400", fontSize: 11, letterSpacing: 1.5, padding: "2px 8px", borderRadius: 6, boxShadow: `0 0 12px ${ME}88`, fontWeight: 700 }}>
        YOU
      </div>
      <div style={{ width: 0, height: 0, margin: "0 auto", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `6px solid ${ME}` }} />
    </div>
  );
}
