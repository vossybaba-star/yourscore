"use client";

/**
 * Penalty scene — composites the hand-generated 2D art (public/sprites/pens):
 * a full-frame stadium backdrop (bg.png, empty goal) with isolated, alpha-trimmed
 * sprites placed over it — keeper (ready / dive_l / dive_r / catch) and taker
 * (idle / kick) — plus a CSS-animated ball. Every sprite was trimmed to its pixels,
 * so each is positioned + scaled explicitly here against the goal geometry of bg.png.
 *
 * Layer order (back→front): bg → keeper → aim reticle → taker → ball → YOU marker.
 * Frame-swaps + a GPU-composited ball flight drive the action. No WebGL.
 */

import { useEffect, useRef, useState } from "react";
import { zoneColumn, zoneRow, type KickOutcome, type PenZone } from "@/lib/draft/pens";

type Play = { shot: PenZone; dive: PenZone; outcome: KickOutcome; side: "me" | "opp" } | null;

const ME = "#b4ff2e";
const A = "/sprites/pens";

// Goal geometry measured against the 9:16 bg.png (posts ~23–77%, crossbar ~39%,
// line ~48%). The aim/dive 9-grid maps inside the goal mouth; tweak if the art reframes.
const GOAL = { left: 28, right: 72, top: 36, bottom: 48 };
const colX = (c: 0 | 1 | 2) => GOAL.left + (GOAL.right - GOAL.left) * (c === 0 ? 1 / 6 : c === 1 ? 0.5 : 5 / 6);
const rowY = (r: 0 | 1 | 2) => GOAL.top + (GOAL.bottom - GOAL.top) * (r === 2 ? 0.18 : r === 1 ? 0.55 : 0.92);
const zonePos = (z: PenZone) => ({ x: colX(zoneColumn(z)), y: rowY(zoneRow(z)) });
// Resting ball sits on the spot ahead of the taker; it flies from here to the chosen zone.
const SPOT = { x: 54, y: 57 };

// Sprite heights in % of the stage HEIGHT (9:16); width is auto so aspect is preserved.
// Keeper stands on the goal line (small, distant); taker is the foreground hero.
const KEEPER_BASE = { x: 50, y: 44 }; // centre of the ready keeper, feet ~goal line
const KEEPER = {
  ready: { src: "keeper_ready", h: 9.5 },
  dive_l: { src: "keeper_dive_l", h: 5.8 },
  dive_r: { src: "keeper_dive_r", h: 8.4 },
  catch: { src: "keeper_catch", h: 11.0 },
} as const;
const TAKER = {
  idle: { src: "taker_idle", h: 22.0 },
  kick: { src: "taker_kick", h: 21.3 },
} as const;
const TAKER_FOOT = { x: 46, y: 72 }; // bottom-centre anchor for the taker

function keeperFrame(diving: boolean, dive: PenZone): keyof typeof KEEPER {
  if (!diving) return "ready";
  const c = zoneColumn(dive);
  return c === 0 ? "dive_l" : c === 2 ? "dive_r" : "catch";
}
// Where the keeper's centre lands for a given dive — partway toward the chosen cell.
function keeperCenter(dive: PenZone) {
  const p = zonePos(dive);
  return { x: KEEPER_BASE.x + (p.x - KEEPER_BASE.x) * 0.55, y: KEEPER_BASE.y + (p.y - KEEPER_BASE.y) * 0.5 };
}

function ballTarget(z: PenZone, outcome: KickOutcome, dive: PenZone) {
  const p = zonePos(z);
  if (outcome === "goal") return { ...p, scale: 0.42 };
  if (outcome === "saved") {
    const k = keeperCenter(dive);
    return { x: (p.x + k.x) / 2, y: (p.y + k.y) / 2 + 1, scale: 0.5 };
  }
  // missed: wide of the post or over the bar
  const c = zoneColumn(z);
  if (zoneRow(z) === 2) return { x: p.x, y: GOAL.top - 7, scale: 0.4 };
  return { x: c === 0 ? GOAL.left - 7 : c === 2 ? GOAL.right + 7 : p.x, y: p.y, scale: 0.42 };
}

const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", userSelect: "none" };

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

  // Ball position/scale.
  const bt = play && ballFly ? ballTarget(play.shot, play.outcome, play.dive) : { ...SPOT, scale: 1 };

  // Keeper frame + placement.
  const kFrame = KEEPER[keeperFrame(diving && !!play, play ? play.dive : 4)];
  const kc = diving && play ? keeperCenter(play.dive) : KEEPER_BASE;

  // Taker frame.
  const tFrame = kicking && play ? TAKER.kick : TAKER.idle;

  const reticle = aim !== null ? zonePos(aim) : null;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#0b1a3a" }}>
      <img src={`${A}/bg.png`} alt="" aria-hidden style={fill} />

      {/* keeper — centred at kc, frame swaps for ready/dive/catch */}
      <img
        src={`${A}/${kFrame.src}.png`} alt="" aria-hidden
        style={{
          position: "absolute", left: `${kc.x}%`, top: `${kc.y}%`,
          height: `${kFrame.h}%`, width: "auto",
          transform: "translate(-50%,-50%)", transformOrigin: "center",
          transition: "left 360ms cubic-bezier(.3,.7,.4,1), top 360ms cubic-bezier(.3,.7,.4,1), opacity 90ms linear",
          zIndex: 2, pointerEvents: "none", userSelect: "none",
        }}
      />

      {/* aim reticle on the goal */}
      {reticle && (
        <div className="absolute" style={{ left: `${reticle.x}%`, top: `${reticle.y}%`, transform: "translate(-50%,-50%)", width: 30, height: 30, borderRadius: "50%", border: `3px solid ${ME}`, boxShadow: `0 0 14px ${ME}cc`, zIndex: 3, animation: "pens2dPulse 1s ease-in-out infinite" }} />
      )}

      {/* taker — bottom-centre foreground, idle ↔ kick */}
      <img
        src={`${A}/${tFrame.src}.png`} alt="" aria-hidden
        style={{
          position: "absolute", left: `${TAKER_FOOT.x}%`, top: `${TAKER_FOOT.y}%`,
          height: `${tFrame.h}%`, width: "auto",
          transform: "translate(-50%,-100%)", transformOrigin: "bottom center",
          transition: "opacity 70ms linear", zIndex: 4, pointerEvents: "none", userSelect: "none",
        }}
      />

      {/* ball */}
      <div className="absolute rounded-full" style={{
        left: `${bt.x}%`, top: `${bt.y}%`, width: "5%", aspectRatio: "1/1",
        transform: `translate(-50%,-50%) scale(${bt.scale})`,
        background: "radial-gradient(circle at 35% 30%, #fff 0%, #e9edf2 55%, #aeb6bf 100%)",
        boxShadow: "0 3px 7px rgba(0,0,0,0.4)", zIndex: 5,
        transition: reduced || !ballFly ? "none" : "left 620ms cubic-bezier(.3,.5,.5,1), top 620ms cubic-bezier(.3,.5,.5,1), transform 620ms ease-out",
      }} />

      {/* YOU marker hops to the player the human controls */}
      {!play && (
        <div className="absolute pointer-events-none" aria-hidden style={{ left: defending ? `${KEEPER_BASE.x}%` : `${TAKER_FOOT.x}%`, top: defending ? `${KEEPER_BASE.y - 12}%` : "60%", transform: "translate(-50%,-50%)", zIndex: 6, transition: "left 300ms ease, top 300ms ease" }}>
          <div className="font-display" style={{ background: ME, color: "#0c1400", fontSize: 10, letterSpacing: 1.5, padding: "2px 8px", borderRadius: 6, boxShadow: `0 0 12px ${ME}88`, fontWeight: 700 }}>YOU</div>
          <div style={{ width: 0, height: 0, margin: "0 auto", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `6px solid ${ME}` }} />
        </div>
      )}
      <style>{`@keyframes pens2dPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.85}50%{transform:translate(-50%,-50%) scale(1.18);opacity:1}}`}</style>
    </div>
  );
}
