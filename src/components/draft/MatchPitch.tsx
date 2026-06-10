"use client";

/**
 * 38-0 — <MatchPitch>: plays a half out on a 2D pitch (Championship-Manager style).
 * Drop-in replacement for the old text <MatchWatch> — same props. The half is a
 * fast-forward HIGHLIGHT REEL: the clock spins between moments and slows on each
 * chance/goal where 22 dots + the ball play it out. All geometry comes from the pure
 * playback core (pitchFrame); this component only owns the canvas + the rAF loop with
 * an eased clock so motion stays smooth between the caller's coarse `progress` updates.
 */

import { useEffect, useRef, useState } from "react";
import { pitchFrame, type PitchFrame } from "@/lib/draft/pitch";
import { watchFrame, type TickStats } from "@/lib/draft/playback";
import type { HalfSim } from "@/lib/draft/live-score";
import { ScoreHeader, StatBars, ME, OPP } from "./MatchHud";

type Props = {
  sim: HalfSim;
  half: 1 | 2;
  matchId: string;
  progress: number;
  priorGoals: { a: number; b: number };
  meSide: "a" | "b";
  myName: string;
  oppName: string;
};

const TURF = "#0e2a1a";
const TURF_DK = "#0b2114";
const LINE = "rgba(255,255,255,0.22)";

export function MatchPitch(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const argsRef = useRef<Props>(props);
  argsRef.current = props;
  const dispRef = useRef(props.progress);
  const reducedRef = useRef(false);

  const [hud, setHud] = useState<{ minute: number; my: number; opp: number; stats: TickStats }>(() => {
    const f = pitchFrame(props.sim, props.half, props.matchId, props.progress);
    return { minute: Math.round(f.matchMinute), my: 0, opp: 0, stats: watchFrame(props.sim, props.half, props.matchId, 0).stats };
  });

  useEffect(() => {
    reducedRef.current = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let stopped = false;
    let dpr = 1;
    let cssW = 0, cssH = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = parent.clientWidth;
      cssH = Math.round(cssW * 0.64);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    let lastHud = { minute: -1, my: -1, opp: -1, key: "" };

    const tick = () => {
      if (stopped) return;
      const { sim, half, matchId, progress, priorGoals, meSide } = argsRef.current;

      // Eased clock: chase the injected progress so motion is smooth between updates.
      let disp = dispRef.current;
      if (reducedRef.current) disp = progress;
      else {
        disp += (progress - disp) * 0.16;
        if (Math.abs(progress - disp) < 0.0015) disp = progress;
      }
      dispRef.current = disp;

      const frame = pitchFrame(sim, half, matchId, disp);
      drawPitch(ctx, cssW, cssH, dpr, frame, meSide, reducedRef.current);

      // HUD (numbers) — update only when an integer actually changes.
      const base = half === 2 ? 45 : 0;
      const statP = Math.max(0, Math.min(1, (frame.matchMinute - base) / 45));
      const my = meSide === "a" ? priorGoals.a + frame.goalsA : priorGoals.b + frame.goalsB;
      const opp = meSide === "a" ? priorGoals.b + frame.goalsB : priorGoals.a + frame.goalsA;
      const minute = Math.round(frame.matchMinute);
      const key = `${minute}`;
      if (minute !== lastHud.minute || my !== lastHud.my || opp !== lastHud.opp || key !== lastHud.key) {
        lastHud = { minute, my, opp, key };
        setHud({ minute, my, opp, stats: watchFrame(sim, half, matchId, statP).stats });
      }

      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); }
      else if (!stopped) { raf = requestAnimationFrame(tick); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div>
      <ScoreHeader minute={hud.minute} myName={props.myName} oppName={props.oppName} myGoals={hud.my} oppGoals={hud.opp} />
      <div className="mt-4 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", lineHeight: 0 }}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
      </div>
      <div className="mt-4">
        <StatBars stats={hud.stats} meSide={props.meSide} />
      </div>
    </div>
  );
}

// ── Canvas drawing ──────────────────────────────────────────────────────────

function drawPitch(
  ctx: CanvasRenderingContext2D,
  W: number, H: number, dpr: number,
  frame: PitchFrame, meSide: "a" | "b", reduced: boolean,
) {
  ctx.save();
  ctx.scale(dpr, dpr);
  const M = 8;
  const px = (nx: number) => M + nx * (W - 2 * M);
  const py = (ny: number) => M + ny * (H - 2 * M);

  // Turf with mowing stripes.
  ctx.fillStyle = TURF;
  ctx.fillRect(0, 0, W, H);
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    if (i % 2 === 0) continue;
    ctx.fillStyle = TURF_DK;
    ctx.fillRect(px(i / stripes), py(0), (W - 2 * M) / stripes, H - 2 * M);
  }

  // Markings.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(px(0), py(0), W - 2 * M, H - 2 * M);
  ctx.beginPath(); ctx.moveTo(px(0.5), py(0)); ctx.lineTo(px(0.5), py(1)); ctx.stroke();
  ctx.beginPath(); ctx.arc(px(0.5), py(0.5), (W - 2 * M) * 0.09, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(px(0.5), py(0.5), 2, 0, Math.PI * 2); ctx.fillStyle = LINE; ctx.fill();
  // Penalty + six-yard boxes and goals, both ends.
  const box = (x0: number, x1: number) => {
    ctx.strokeRect(px(Math.min(x0, x1)), py(0.24), Math.abs(px(x1) - px(x0)), py(0.76) - py(0.24));
  };
  box(0, 0.16); box(1, 0.84);
  ctx.strokeRect(px(0), py(0.36), px(0.06) - px(0), py(0.64) - py(0.36));
  ctx.strokeRect(px(0.94), py(0.36), px(1) - px(0.94), py(0.64) - py(0.36));
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.moveTo(px(0), py(0.44)); ctx.lineTo(px(0), py(0.56)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px(1), py(0.44)); ctx.lineTo(px(1), py(0.56)); ctx.stroke();

  // Beat flourishes (under the dots): strike streak + goal net flash.
  if (frame.beat) {
    const att = frame.beat.side === "a" ? 1 : 0;
    if (frame.beat.phase === "strike" || (frame.beat.kind === "goal" && frame.beat.phase === "outcome")) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2.2;
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = reduced ? 0 : 10;
      ctx.beginPath(); ctx.moveTo(px(frame.ball.x), py(frame.ball.y)); ctx.lineTo(px(att), py(0.5)); ctx.stroke();
      ctx.restore();
    }
    if (frame.beat.kind === "goal" && frame.beat.phase === "outcome") {
      ctx.save();
      ctx.fillStyle = "rgba(0,255,135,0.30)";
      const gx = att === 1 ? px(0.9) : px(0);
      ctx.fillRect(gx, py(0.36), px(0.1) - px(0), py(0.64) - py(0.36));
      if (!reduced) {
        ctx.strokeStyle = "rgba(0,255,135,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px(frame.ball.x), py(frame.ball.y), 14, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Players.
  const r = Math.max(4, W * 0.017);
  for (const p of frame.players) {
    const isMe = p.side === meSide;
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), p.role === "gk" ? r * 0.85 : r, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? ME : OPP;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 3;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.stroke();
  }

  // Ball.
  const br = Math.max(2.5, W * 0.0095);
  ctx.beginPath();
  ctx.arc(px(frame.ball.x), py(frame.ball.y), br, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}
