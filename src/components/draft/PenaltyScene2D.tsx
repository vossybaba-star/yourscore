"use client";

/**
 * Penalty scene — composites pre-rendered Blender layers (see scripts/draft/blender/
 * build_assets.py → /public/sprites/blender). Every layer is a full-frame render from
 * ONE fixed hero camera, so stacking them aligns perfectly: backdrop → keeper → ball
 * (CSS-animated) → taker. Frame-swaps + a GPU-composited ball flight drive the action.
 *
 * Gives the Blender-grade stylized look in-app with no WebGL (robust, performant).
 * Drop-in prop surface matching the old 3D scene.
 */

import { useEffect, useRef, useState } from "react";
import { zoneColumn, zoneRow, type KickOutcome, type PenColumn, type PenZone } from "@/lib/draft/pens";

type Play = { shot: PenZone; dive: PenColumn; outcome: KickOutcome; side: "me" | "opp" } | null;

const ME = "#b4ff2e";
const A = "/sprites/blender";

// Goal mouth + spot in % of the stage, measured against bg.png.
const GOAL = { left: 31, right: 69, top: 34, bottom: 47 };
const colX = (c: PenColumn) => GOAL.left + (GOAL.right - GOAL.left) * (c === 0 ? 1 / 6 : c === 1 ? 0.5 : 5 / 6);
const rowY = (r: 0 | 1 | 2) => GOAL.top + (GOAL.bottom - GOAL.top) * (r === 2 ? 0.25 : r === 1 ? 0.55 : 0.85);
const SPOT = { x: 50, y: 80 };
const zonePos = (z: PenZone) => ({ x: colX(zoneColumn(z)), y: rowY(zoneRow(z)) });

function ballTarget(z: PenZone, outcome: KickOutcome) {
  const p = zonePos(z);
  if (outcome === "goal") return p;
  if (outcome === "saved") return { x: (p.x + 50) / 2, y: p.y + 1 };
  const c = zoneColumn(z);
  if (zoneRow(z) === 2) return { x: p.x, y: GOAL.top - 8 };
  return { x: c === 0 ? GOAL.left - 6 : c === 2 ? GOAL.right + 6 : p.x, y: p.y };
}

const layer: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", userSelect: "none" };

export default function PenaltyScene2D({ aim, play, onPlayed, reduced, defending }: {
  aim: PenZone | null; play: Play; onPlayed: () => void; reduced: boolean; defending: boolean;
}) {
  const [kicking, setKicking] = useState(false);
  const [diving, setDiving] = useState(false);
  const [ballFly, setBallFly] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fired = useRef(false);

  useEffect(() => {
    timers.current.forEach(clearTimeout); timers.current = []; fired.current = false;
    if (!play) { setKicking(false); setDiving(false); setBallFly(false); return; }
    const fire = () => { if (!fired.current) { fired.current = true; onPlayed(); } };
    if (reduced) { setKicking(true); setDiving(true); setBallFly(true); timers.current.push(setTimeout(fire, 260)); return; }
    const t = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    t(120, () => setKicking(true));
    t(300, () => { setBallFly(true); setDiving(true); });
    t(300 + 620 + 240, fire);
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [play, reduced, onPlayed]);

  const ball = play && ballFly ? ballTarget(play.shot, play.outcome) : SPOT;
  const ballScale = play && ballFly ? 0.5 : 1;
  const keeperFrame = diving && play ? (play.dive === 0 ? "keeper_dive_l" : play.dive === 2 ? "keeper_dive_r" : "keeper_catch") : "keeper_ready";
  const reticle = aim !== null ? zonePos(aim) : null;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#7fa0c8" }}>
      <img src={`${A}/bg.png`} alt="" aria-hidden style={layer} />
      {/* keeper (in goal) — frame swaps for ready/dive/catch */}
      <img src={`${A}/${keeperFrame}.png`} alt="" aria-hidden style={{ ...layer, zIndex: 2, transition: "opacity 90ms linear" }} />
      {/* aim reticle on the goal */}
      {reticle && (
        <div className="absolute" style={{ left: `${reticle.x}%`, top: `${reticle.y}%`, transform: "translate(-50%,-50%)", width: 30, height: 30, borderRadius: "50%", border: `3px solid ${ME}`, boxShadow: `0 0 14px ${ME}cc`, zIndex: 3, animation: "pens2dPulse 1s ease-in-out infinite" }} />
      )}
      {/* ball */}
      <div className="absolute rounded-full" style={{
        left: `${ball.x}%`, top: `${ball.y}%`, width: "5.5%", aspectRatio: "1/1",
        transform: `translate(-50%,-50%) scale(${ballScale})`,
        background: "radial-gradient(circle at 35% 30%, #fff 0%, #e9edf2 55%, #aeb6bf 100%)",
        boxShadow: "0 3px 7px rgba(0,0,0,0.4)", zIndex: 4,
        transition: reduced || !ballFly ? "none" : "left 620ms cubic-bezier(.3,.5,.5,1), top 620ms cubic-bezier(.3,.5,.5,1), transform 620ms ease-out",
      }} />
      {/* taker (foreground) — idle ↔ kick */}
      <img src={`${A}/${kicking && play ? "taker_kick" : "taker_idle"}.png`} alt="" aria-hidden style={{ ...layer, zIndex: 5, transition: "opacity 70ms linear" }} />
      {/* YOU marker hops to the player the human controls */}
      {!play && (
        <div className="absolute pointer-events-none" aria-hidden style={{ left: "50%", top: defending ? `${GOAL.top - 5}%` : "66%", transform: "translate(-50%,-50%)", zIndex: 6, transition: "top 300ms ease" }}>
          <div className="font-display" style={{ background: ME, color: "#0c1400", fontSize: 10, letterSpacing: 1.5, padding: "2px 8px", borderRadius: 6, boxShadow: `0 0 12px ${ME}88`, fontWeight: 700 }}>YOU</div>
          <div style={{ width: 0, height: 0, margin: "0 auto", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `6px solid ${ME}` }} />
        </div>
      )}
      <style>{`@keyframes pens2dPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.85}50%{transform:translate(-50%,-50%) scale(1.18);opacity:1}}`}</style>
    </div>
  );
}
