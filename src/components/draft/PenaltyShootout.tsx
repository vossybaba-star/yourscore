"use client";

/**
 * Interactive penalty shootout — front-on goal, tap a zone to shoot, tap a side
 * to dive. Pure presentation: every kick arrives already resolved (PenKick), so
 * this component never computes an outcome — it animates what it's given. Shared
 * by the solo flow (alternating: you shoot AND dive) and live H2H (simultaneous:
 * you shoot, the opponent's kicks stream into a side strip).
 *
 * Deliberately cheap: DOM + CSS transforms only (GPU-composited), no canvas, no
 * rAF loop, no deps. Reduced motion skips the flights and reveals outcomes as text.
 */

import { useEffect, useRef, useState } from "react";
import type { PenColumn, PenKick, PenZone } from "@/lib/draft/pens";

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

// Stage geometry (percent of the stage box).
const COL_X = [25, 50, 75];                       // zone column centers
const ROW_Y = { high: 30, low: 53 } as const;     // zone row centers
const SPOT = { x: 50, y: 88 };                    // penalty spot (ball start)
const GOAL = { left: 12, right: 88, bar: 16, line: 66 }; // frame box

const zoneX = (z: PenZone) => COL_X[z % 3];
const zoneY = (z: PenZone) => (z >= 3 ? ROW_Y.high : ROW_Y.low);
/** Where a missed ball ends up: over the bar for high zones, wide for corners. */
const missTarget = (z: PenZone) => {
  const col = z % 3;
  if (col === 1) return { x: 50 + (z >= 3 ? 9 : -9), y: 2 };
  return { x: col === 0 ? 2 : 98, y: z >= 3 ? 8 : 40 };
};

const GREEN = "#00ff87";
const PINK = "#ff5c7a";
const AMBER = "#ffb800";

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
            border: k ? `1.5px solid ${k.outcome === "goal" ? color : "#666677"}` : "1.5px solid rgba(255,255,255,0.15)",
          }}
        />
      ))}
    </div>
  );
}

type Anim =
  | { kind: "flight"; side: "me" | "opp"; kick: PenKick }   // ball on its way
  | { kind: "outcome"; side: "me" | "opp"; kick: PenKick }; // result shown

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
  /** Live H2H: opponent kicks stream into a strip instead of the main stage. */
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

  // Reveal queue: how many kicks of each side have finished animating.
  const [shownMe, setShownMe] = useState(view.myKicks.length);
  const [shownOpp, setShownOpp] = useState(view.oppKicks.length);
  const [anim, setAnim] = useState<Anim | null>(null);
  // My pending aim/dive (tapped, kick not resolved yet) — lets the ball/keeper
  // start moving immediately so server RTT hides under the flight.
  const [aim, setAim] = useState<PenZone | null>(null);
  const [myDive, setMyDive] = useState<PenColumn | null>(null);

  const FLIGHT_MS = reduced.current ? 0 : 550;
  const OUTCOME_MS = reduced.current ? 650 : 900;

  // Start animating the next unrevealed kick (mine first, then opp).
  useEffect(() => {
    if (anim) return;
    if (shownMe < view.myKicks.length) {
      setAnim({ kind: "flight", side: "me", kick: view.myKicks[shownMe] });
      return;
    }
    if (shownOpp < view.oppKicks.length) {
      if (simultaneous) { setShownOpp((n) => n + 1); return; } // strip only — no stage time
      setAnim({ kind: "flight", side: "opp", kick: view.oppKicks[shownOpp] });
    }
  }, [anim, shownMe, shownOpp, view.myKicks, view.oppKicks, simultaneous]);

  // Flight lands → show the outcome. (Separate effect so re-renders can't cancel it.)
  useEffect(() => {
    if (anim?.kind !== "flight") return;
    const t = setTimeout(() => setAnim({ kind: "outcome", side: anim.side, kick: anim.kick }), FLIGHT_MS);
    return () => clearTimeout(t);
  }, [anim, FLIGHT_MS]);

  // Outcome shown → bank the kick and clear the stage.
  useEffect(() => {
    if (anim?.kind !== "outcome") return;
    const t = setTimeout(() => {
      if (anim.side === "me") setShownMe((n) => n + 1);
      else setShownOpp((n) => n + 1);
      setAnim(null);
      setAim(null);
      setMyDive(null);
    }, OUTCOME_MS);
    return () => clearTimeout(t);
  }, [anim, OUTCOME_MS]);

  const busy = anim !== null || aim !== null || myDive !== null;
  const canShoot = view.role === "shoot" && !busy;
  const canDive = view.role === "dive" && !busy;

  // ── Stage state (ball, keeper, label) ────────────────────────────────────────
  // Whose kick is on the stage: mine (opp keeper, pink) or theirs (my keeper, green).
  const stageSide: "me" | "opp" =
    anim ? anim.side : myDive !== null || view.role === "dive" ? "opp" : "me";
  const stageKick = anim?.kick ?? null;
  const inFlight = anim?.kind === "flight" || (!anim && (aim !== null || myDive !== null));

  let ball = { x: SPOT.x, y: SPOT.y, scale: 1 };
  if (stageKick) {
    const to = stageKick.outcome === "missed" ? missTarget(stageKick.shot) : { x: zoneX(stageKick.shot), y: zoneY(stageKick.shot) };
    ball = { x: to.x, y: to.y, scale: 0.55 };
  } else if (aim !== null) {
    ball = { x: zoneX(aim), y: zoneY(aim), scale: 0.55 }; // optimistic flight to my aim
  }

  // Keeper dive: resolved kick's dive, or my optimistic pick while waiting.
  const diveCol: PenColumn | null = stageKick ? stageKick.dive : myDive;
  const keeperColor = stageSide === "me" ? PINK : GREEN;
  const keeperTx = diveCol === null || diveCol === 1 ? 0 : diveCol === 0 ? -24 : 24;
  const keeperRot = diveCol === null || diveCol === 1 ? 0 : diveCol === 0 ? -58 : 58;

  const outcome = anim?.kind === "outcome" ? anim.kick.outcome : null;
  const outcomeText = outcome === "goal" ? "GOAL!" : outcome === "saved" ? "SAVED!" : outcome ? (anim!.kick.shot >= 3 ? "OVER!" : "WIDE!") : null;
  const outcomeColor =
    outcome === "goal" ? (stageSide === "me" ? GREEN : PINK) : outcome === "saved" ? AMBER : "#9a9ab0";

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
        @keyframes pensNet { 0% { transform: scaleY(1); } 40% { transform: scaleY(1.08); } 100% { transform: scaleY(1); } }
        @keyframes pensShake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
        @keyframes pensPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
      `}</style>

      {/* Scoreboard */}
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex-1 min-w-0">
          <div className="font-body truncate" style={{ fontSize: 11, color: "#9a9ab0" }}>{myName}</div>
          <Pips kicks={view.myKicks} total={5} color={GREEN} align="left" />
        </div>
        <div className="px-3 text-center">
          <div className="font-display tabular-nums" style={{ fontSize: 26, color: "#fff", letterSpacing: 2 }}>
            {myGoals}–{oppGoals}
          </div>
          <div className="font-display" style={{ fontSize: 10, letterSpacing: 2, color: view.suddenDeath ? AMBER : "#8888aa" }}>
            {view.result ? "PENALTIES" : view.suddenDeath ? "SUDDEN DEATH" : `KICK ${Math.max(kickNo, 1)} OF 5`}
          </div>
        </div>
        <div className="flex-1 min-w-0 text-right">
          <div className="font-body truncate" style={{ fontSize: 11, color: "#9a9ab0" }}>{oppName}</div>
          <Pips kicks={view.oppKicks} total={5} color={PINK} align="right" />
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative w-full overflow-hidden rounded-2xl"
        style={{
          aspectRatio: "10/7",
          background: "linear-gradient(180deg, #0a0a14 0%, #0d1422 55%, #0c2a17 78%, #0f3a1f 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          animation: outcome === "missed" && !reduced.current ? "pensShake 0.15s linear 2" : undefined,
        }}
      >
        {/* Goal frame + net */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 70" preserveAspectRatio="none">
          <g style={{ transformOrigin: "50% 16%", animation: outcome === "goal" && !reduced.current ? "pensNet 0.4s ease-out" : undefined }}>
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`v${i}`} x1={GOAL.left + ((GOAL.right - GOAL.left) / 8) * i} y1={GOAL.bar * 0.7} x2={GOAL.left + ((GOAL.right - GOAL.left) / 8) * i} y2={GOAL.line * 0.7} stroke="rgba(255,255,255,0.13)" strokeWidth="0.3" />
            ))}
            {Array.from({ length: 6 }, (_, i) => (
              <line key={`h${i}`} x1={GOAL.left} y1={(GOAL.bar + ((GOAL.line - GOAL.bar) / 5) * i) * 0.7} x2={GOAL.right} y2={(GOAL.bar + ((GOAL.line - GOAL.bar) / 5) * i) * 0.7} stroke="rgba(255,255,255,0.13)" strokeWidth="0.3" />
            ))}
          </g>
          <line x1={GOAL.left} y1={GOAL.bar * 0.7} x2={GOAL.left} y2={GOAL.line * 0.7} stroke="rgba(255,255,255,0.85)" strokeWidth="1.1" />
          <line x1={GOAL.right} y1={GOAL.bar * 0.7} x2={GOAL.right} y2={GOAL.line * 0.7} stroke="rgba(255,255,255,0.85)" strokeWidth="1.1" />
          <line x1={GOAL.left - 0.5} y1={GOAL.bar * 0.7} x2={GOAL.right + 0.5} y2={GOAL.bar * 0.7} stroke="rgba(255,255,255,0.85)" strokeWidth="1.1" />
          {/* goal line + six-yard hint */}
          <line x1={0} y1={GOAL.line * 0.7} x2={100} y2={GOAL.line * 0.7} stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" />
        </svg>

        {/* Goal flash */}
        {outcome === "goal" && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 30%, ${outcomeColor}33 0%, transparent 60%)` }} />
        )}

        {/* Keeper */}
        <div
          className="absolute"
          style={{
            left: "50%", top: "46.5%", width: "7%", height: "19%",
            transform: `translate(-50%,-50%) translateX(${keeperTx * 4.2}%) rotate(${keeperRot}deg)`,
            transformOrigin: "50% 85%",
            transition: reduced.current ? undefined : "transform 0.45s cubic-bezier(0.3, 0.8, 0.4, 1)",
            filter: outcome === "saved" ? `drop-shadow(0 0 10px ${AMBER})` : undefined,
          }}
        >
          <div className="absolute rounded-full" style={{ left: "32%", top: 0, width: "36%", aspectRatio: "1", background: keeperColor }} />
          <div className="absolute rounded-md" style={{ left: "22%", top: "30%", width: "56%", height: "52%", background: keeperColor }} />
          <div className="absolute rounded-md" style={{ left: "36%", top: "80%", width: "28%", height: "20%", background: keeperColor, opacity: 0.85 }} />
        </div>

        {/* Aim zones (shoot mode) */}
        {canShoot &&
          ([3, 4, 5, 0, 1, 2] as PenZone[]).map((z) => (
            <button
              key={z}
              onClick={() => { setAim(z); onShoot(z); }}
              className="absolute rounded-xl active:scale-95"
              style={{
                left: `${zoneX(z) - 11.5}%`, top: `${zoneY(z) - 10.5}%`, width: "23%", height: "22%",
                border: "1.5px dashed rgba(0,255,135,0.35)",
                background: "rgba(0,255,135,0.05)",
              }}
              aria-label={`Aim ${z >= 3 ? "high" : "low"} ${z % 3 === 0 ? "left" : z % 3 === 1 ? "center" : "right"}`}
            />
          ))}

        {/* Ball */}
        <div
          className="absolute rounded-full"
          style={{
            left: `${ball.x}%`, top: `${ball.y}%`, width: "5.5%", aspectRatio: "1",
            transform: `translate(-50%,-50%) scale(${inFlight || stageKick ? ball.scale : 1})`,
            transition: reduced.current ? undefined : "left 0.55s cubic-bezier(0.2,0.7,0.3,1), top 0.55s cubic-bezier(0.2,0.7,0.3,1), transform 0.55s",
            background: "radial-gradient(circle at 35% 30%, #ffffff 0%, #d8d8e0 55%, #9a9aa8 100%)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
            opacity: outcome === "missed" ? 0.4 : 1,
          }}
        />

        {/* Outcome label */}
        {outcomeText && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="font-display" style={{ fontSize: 38, letterSpacing: 3, color: outcomeColor, textShadow: "0 2px 14px rgba(0,0,0,0.7)", animation: reduced.current ? undefined : "pensPop 0.3s ease-out" }}>
              {outcomeText}
            </span>
          </div>
        )}

        {/* Final banner */}
        {view.result && !anim && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(8,8,14,0.82)" }}>
            <div className="font-display" style={{ fontSize: 36, letterSpacing: 3, color: view.result === "win" ? GREEN : PINK, animation: reduced.current ? undefined : "pensPop 0.35s ease-out" }}>
              {view.result === "win" ? "YOU WIN ON PENS" : "LOST ON PENS"}
            </div>
            <div className="font-display tabular-nums" style={{ fontSize: 22, color: "#fff", letterSpacing: 2 }}>
              {myGoals}–{oppGoals}
            </div>
          </div>
        )}

        {/* Timer chip (live) */}
        {secondsLeft != null && !view.result && (
          <div className="absolute top-2 right-2 rounded-lg px-2 py-0.5 font-display tabular-nums" style={{ fontSize: 13, color: secondsLeft <= 10 ? AMBER : "#fff", background: "rgba(10,10,15,0.7)", letterSpacing: 1 }}>
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
              onClick={() => { setMyDive(c); onDive(c); }}
              className="rounded-xl py-3 font-display active:scale-[0.97] transition-transform"
              style={{ fontSize: 14, letterSpacing: 1.5, color: GREEN, background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.35)" }}
            >
              {c === 0 ? "DIVE LEFT" : c === 1 ? "STAY" : "DIVE RIGHT"}
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
