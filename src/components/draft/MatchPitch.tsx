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
import { watchFrame, WATCH_CONFIG, type TickStats, type Beat } from "@/lib/draft/playback";
import type { HalfSim } from "@/lib/draft/live-score";
import { ScoreHeader, StatBars, ME, OPP } from "./MatchHud";

type View = "pitch" | "commentary";

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
  const lastTRef = useRef(0);
  const reducedRef = useRef(false);
  const [view, setView] = useState<View>("pitch");
  const viewRef = useRef<View>("pitch");
  viewRef.current = view;
  const feedRef = useRef<HTMLDivElement>(null);

  const [hud, setHud] = useState<{ minute: number; my: number; opp: number; stats: TickStats; feed: Beat[] }>(() => {
    const f = pitchFrame(props.sim, props.half, props.matchId, props.progress);
    return { minute: Math.round(f.matchMinute), my: 0, opp: 0, stats: watchFrame(props.sim, props.half, props.matchId, 0).stats, feed: [] };
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
      const newW = parent.clientWidth;
      // Skip when the container is hidden (display:none → clientWidth = 0) or
      // not yet laid out — keep the previous dimensions so the rAF loop
      // doesn't get zero-width geometry and throw IndexSizeError on ctx.arc().
      if (newW <= 0) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = newW;
      cssH = Math.round(cssW * 0.64);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    let lastHud = { minute: -1, my: -1, opp: -1 };

    const tick = () => {
      if (stopped) return;
      const { sim, half, matchId, progress, priorGoals, meSide } = argsRef.current;

      // Wall-clock clock: advance purely on elapsed real time for buttery 60fps motion.
      // The injected `progress` only ticks ~1Hz (live) / ~10Hz (quick match), so tracking
      // it frame-to-frame reintroduced a per-second pulse — instead we ignore the small
      // per-tick steps and only re-sync when it has drifted a lot (resume / seek / skew).
      const now = performance.now();
      const dt = lastTRef.current ? Math.min(0.05, (now - lastTRef.current) / 1000) : 1 / 60;
      lastTRef.current = now;
      let disp = dispRef.current;
      if (reducedRef.current) disp = progress;
      else {
        disp += dt / WATCH_CONFIG.halfSeconds;
        if (Math.abs(progress - disp) > 0.04) disp = progress; // resync only on real drift, not the 1Hz stairstep
        disp = disp < 0 ? 0 : disp > 1 ? 1 : disp;
      }
      dispRef.current = disp;

      const frame = pitchFrame(sim, half, matchId, disp);
      if (viewRef.current === "pitch" && cssW > 0 && cssH > 0) drawPitch(ctx, cssW, cssH, dpr, frame, meSide, reducedRef.current);

      // HUD (numbers + commentary feed) — recompute only when the clock minute or score
      // changes (a few Hz), not every frame.
      const base = half === 2 ? 45 : 0;
      const my = meSide === "a" ? priorGoals.a + frame.goalsA : priorGoals.b + frame.goalsB;
      const opp = meSide === "a" ? priorGoals.b + frame.goalsB : priorGoals.a + frame.goalsA;
      const minute = Math.round(frame.matchMinute);
      if (minute !== lastHud.minute || my !== lastHud.my || opp !== lastHud.opp) {
        lastHud = { minute, my, opp };
        const statP = Math.max(0, Math.min(1, (frame.matchMinute - base) / 45));
        const wf = watchFrame(sim, half, matchId, statP);
        setHud({ minute, my, opp, stats: wf.stats, feed: wf.feed });
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

  useEffect(() => {
    if (view === "commentary" && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [hud.feed.length, view]);

  return (
    <div>
      <ScoreHeader minute={hud.minute} myName={props.myName} oppName={props.oppName} myGoals={hud.my} oppGoals={hud.opp} />

      {/* Watch the pitch, or read the commentary — user's choice. */}
      <div className="mt-4 flex gap-1 p-1 rounded-xl" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)" }}>
        <TabBtn active={view === "pitch"} onClick={() => setView("pitch")} label="Pitch" />
        <TabBtn active={view === "commentary"} onClick={() => setView("commentary")} label="Commentary" />
      </div>

      {/* Canvas stays mounted (hidden under commentary) so the rAF loop + ref persist. */}
      <div className="mt-3 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", lineHeight: 0, display: view === "pitch" ? "block" : "none" }}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
      </div>

      {view === "commentary" && (
        <div ref={feedRef} className="mt-3 rounded-xl overflow-y-auto" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)", maxHeight: 260 }}>
          {hud.feed.length === 0
            ? <div className="px-3 py-6 text-center font-body" style={{ fontSize: 13, color: "#8a948f" }}>Kick-off…</div>
            : hud.feed.map((b, i) => <FeedLine key={`${b.minute}-${b.kind}-${i}`} beat={b} meSide={props.meSide} half={props.half} />)}
        </div>
      )}

      <div className="mt-4">
        <StatBars stats={hud.stats} meSide={props.meSide} />
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-lg py-2 font-display tracking-wide transition-colors active:scale-[0.99]"
      style={{ fontSize: 13, letterSpacing: 1, color: active ? "#062013" : "#9aa39d", background: active ? ME : "transparent" }}
    >
      {label.toUpperCase()}
    </button>
  );
}

function FeedLine({ beat, meSide, half }: { beat: Beat; meSide: "a" | "b"; half: 1 | 2 }) {
  const isGoal = beat.kind === "goal";
  const isBookend = beat.kind === "kickoff" || beat.kind === "halftime" || beat.kind === "fulltime";
  const mine = beat.side === meSide;
  const accent = isBookend ? "#8a948f" : mine ? ME : OPP;
  const shownMinute = beat.kind === "kickoff" ? (half === 2 ? 45 : 0) : beat.minute;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <span className="font-display tabular-nums" style={{ fontSize: 12, color: "#8a948f", width: 28 }}>{shownMinute}&apos;</span>
      <span className="font-body" style={{ fontSize: isGoal ? 14 : 12.5, color: isGoal ? accent : "#c4ccc6", fontWeight: isGoal ? 700 : 400 }}>
        {beat.text}
      </span>
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

  // Goal net flash (the ball itself does the shot now, so no scripted streak).
  if (frame.beat && frame.beat.kind === "goal" && frame.beat.phase === "outcome") {
    const att = frame.beat.side === "a" ? 1 : 0;
    ctx.save();
    ctx.fillStyle = "rgba(174,234,0,0.30)";
    const gx = att === 1 ? px(0.9) : px(0);
    ctx.fillRect(gx, py(0.36), px(0.1) - px(0), py(0.64) - py(0.36));
    if (!reduced) {
      ctx.strokeStyle = "rgba(174,234,0,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px(frame.ball.x), py(frame.ball.y), 14, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // Players — flat dots with a thin outline. No shadowBlur: blurred shadows on 23 sprites
  // every frame tank the framerate on mobile, which is what made it feel un-smooth.
  const r = Math.max(4, W * 0.017);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  for (const p of frame.players) {
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), p.role === "gk" ? r * 0.85 : r, 0, Math.PI * 2);
    ctx.fillStyle = p.side === meSide ? ME : OPP;
    ctx.fill();
    ctx.stroke();
  }

  // Ball — white dot with a thin dark ring (cheap, no blur).
  const br = Math.max(2.5, W * 0.0095);
  ctx.beginPath();
  ctx.arc(px(frame.ball.x), py(frame.ball.y), br, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.stroke();

  ctx.restore();
}
