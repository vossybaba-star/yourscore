"use client";

/**
 * Interactive penalty shootout — controller + UI chrome over the 3D scene.
 *
 * Owns all game state; renders the real-time 3D stadium (PenaltyScene3D, lazy /
 * client-only) and overlays the game UI: round counter + score pips, a 9-zone aim
 * grid, a timed POWER meter, CHANGE AIM / TAKE PENALTY, dive controls, and the
 * GOAL/SAVED/MISS badges. Every kick arrives already resolved (PenKick) — this
 * component animates the reveal, it never computes an outcome.
 *
 * Shared by the solo flow (alternating: you shoot AND dive) and live H2H
 * (simultaneous: you shoot, the opponent's kicks tick the scoreboard). Synthesized
 * sound + haptics live in sfx.ts behind a muted-by-default toggle.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  shootoutStatus, zoneColumn, zoneRow,
  type KickOutcome, type PenColumn, type PenKick, type PenPower, type PensMode, type PenZone,
} from "@/lib/draft/pens";
import { sfx, buzz, sfxEnabled, setSfxEnabled } from "@/lib/draft/sfx";

// 3D scene is WebGL/client-only — lazy + ssr:false so it never renders on the server.
const PenaltyScene3D = dynamic(() => import("./PenaltyScene3D"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center" style={{ background: "#05060d", color: "#5d6275", fontSize: 12 }}>
      Walking up to the spot…
    </div>
  ),
});


export type PensRole = "shoot" | "dive" | "waiting" | "done";

export type PensView = {
  myKicks: PenKick[];
  oppKicks: PenKick[];
  suddenDeath: boolean;
  role: PensRole;
  result: "win" | "loss" | null;
};

const ME = "#b4ff2e";
const OPP = "#a06bff";
const AMBER = "#ffb800";

// Power-meter bands, left→right: under / good / perfect (sweet spot) / over.
const BANDS: { p: PenPower; from: number; to: number; color: string; label: string }[] = [
  { p: "under", from: 0, to: 0.34, color: "#caa23a", label: "UNDER" },
  { p: "good", from: 0.34, to: 0.62, color: "#ff9d2e", label: "GOOD" },
  { p: "perfect", from: 0.62, to: 0.82, color: ME, label: "PERFECT" },
  { p: "over", from: 0.82, to: 1, color: "#ff4d4d", label: "OVER" },
];
const bandAt = (pos: number): PenPower => BANDS.find((b) => pos >= b.from && pos < b.to)?.p ?? "over";

function couldDecide(my: PenKick[], opp: PenKick[], kicker: "me" | "opp", mode: PensMode): boolean {
  const K = (o: KickOutcome): PenKick => ({ shot: 4, power: "good", dive: 0, outcome: o });
  const test = (o: KickOutcome) =>
    shootoutStatus(kicker === "me" ? [...my, K(o)] : my, kicker === "opp" ? [...opp, K(o)] : opp, mode).decided;
  return test("goal") || test("missed");
}

// ── Score pips ──────────────────────────────────────────────────────────────
function Pips({ kicks, total, color, align }: { kicks: PenKick[]; total: number; color: string; align: "left" | "right" }) {
  const n = Math.max(total, kicks.length);
  const items = Array.from({ length: n }, (_, i) => kicks[i] ?? null);
  if (align === "right") items.reverse();
  return (
    <div className="flex gap-1" style={{ justifyContent: align === "left" ? "flex-start" : "flex-end" }}>
      {items.map((k, i) => (
        <span key={i} className="rounded-full grid place-items-center" style={{
          width: 11, height: 11,
          background: k ? (k.outcome === "goal" ? color : "transparent") : "rgba(255,255,255,0.06)",
          border: k ? `1.5px solid ${k.outcome === "goal" ? color : "#5d5d72"}` : "1.5px solid rgba(255,255,255,0.14)",
          boxShadow: k?.outcome === "goal" ? `0 0 6px ${color}77` : undefined,
        }}>
          {k && k.outcome !== "goal" && <span style={{ fontSize: 7, lineHeight: 1, color: "#7a7a90" }}>✕</span>}
        </span>
      ))}
    </div>
  );
}

// ── Power meter (own rAF + state so the 3D Canvas never re-renders per frame) ──
function PowerMeter({ running, lockSignal, onLock, reduced }: {
  running: boolean; lockSignal: number; onLock: (p: PenPower, pos: number) => void; reduced: boolean;
}) {
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const lastSignal = useRef(lockSignal);

  useEffect(() => {
    if (!running) { startRef.current = null; return; }
    if (reduced) { setPos(0.72); posRef.current = 0.72; return; } // park on PERFECT
    let raf = 0;
    const PERIOD = 1100; // ms per full sweep (ping-pong)
    startRef.current = performance.now();
    const tick = (now: number) => {
      const e = ((now - (startRef.current ?? now)) % PERIOD) / PERIOD; // 0..1
      const p = e < 0.5 ? e * 2 : 2 - e * 2; // ping-pong 0→1→0
      posRef.current = p; setPos(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, reduced]);

  // External TAKE PENALTY press → lock at the current needle.
  useEffect(() => {
    if (lockSignal === lastSignal.current) return;
    lastSignal.current = lockSignal;
    if (running) onLock(bandAt(posRef.current), posRef.current);
  }, [lockSignal, running, onLock]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="font-display" style={{ fontSize: 10, letterSpacing: 2, color: "#8a8fa0" }}>POWER</span>
        <span className="font-display" style={{ fontSize: 10, letterSpacing: 1.5, color: bandAt(pos) === "perfect" ? ME : "#8a8fa0" }}>
          {bandAt(pos).toUpperCase()}
        </span>
      </div>
      <div className="relative w-full rounded-full overflow-hidden" style={{ height: 16, background: "#11131c", border: "1px solid rgba(255,255,255,0.1)" }}>
        {BANDS.map((b) => (
          <div key={b.p} className="absolute top-0 bottom-0" style={{ left: `${b.from * 100}%`, width: `${(b.to - b.from) * 100}%`, background: b.color, opacity: 0.85 }} />
        ))}
        {/* needle */}
        <div className="absolute top-[-3px] bottom-[-3px]" style={{
          left: `calc(${pos * 100}% - 1.5px)`, width: 3, background: "#fff",
          boxShadow: "0 0 8px rgba(255,255,255,0.9)", borderRadius: 2,
        }} />
      </div>
    </div>
  );
}

type Anim = { side: "me" | "opp"; kick: PenKick };

export function PenaltyShootout({
  view, myName, oppName, simultaneous, secondsLeft, onShoot, onDive,
}: {
  view: PensView;
  myName: string;
  oppName: string;
  simultaneous?: boolean;
  secondsLeft?: number | null;
  /** Now carries the timed power band alongside the aim zone. */
  onShoot: (zone: PenZone, power: PenPower) => void;
  onDive: (col: PenColumn) => void;
}) {
  const reduced = useRef(false);
  useEffect(() => { reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; }, []);
  const mode: PensMode = simultaneous ? "simultaneous" : "alternating";

  // Reveal queue.
  const [shownMe, setShownMe] = useState(view.myKicks.length);
  const [shownOpp, setShownOpp] = useState(view.oppKicks.length);
  const [anim, setAnim] = useState<Anim | null>(null);     // kick currently animating in 3D
  const [badge, setBadge] = useState<{ outcome: KickOutcome; side: "me" | "opp" } | null>(null);

  // Aiming.
  const [aim, setAim] = useState<PenZone>(8);              // default top-right corner
  const [phase, setPhase] = useState<"aim" | "power">("aim");
  const [lockSignal, setLockSignal] = useState(0);
  const [pending, setPending] = useState(false);           // locked, awaiting resolved kick
  const [sound, setSound] = useState(false);
  useEffect(() => { setSound(sfxEnabled()); }, []);

  // Start animating the next unrevealed kick (mine first, then opp).
  useEffect(() => {
    if (anim) return;
    if (shownMe < view.myKicks.length) {
      const k = view.myKicks[shownMe];
      if (couldDecide(view.myKicks.slice(0, shownMe), view.oppKicks.slice(0, shownOpp), "me", mode)) sfx.whistle();
      setPending(false);
      setAnim({ side: "me", kick: k });
      return;
    }
    if (shownOpp < view.oppKicks.length) {
      if (simultaneous) { setShownOpp((n) => n + 1); return; } // scoreboard only
      setAnim({ side: "opp", kick: view.oppKicks[shownOpp] });
    }
  }, [anim, shownMe, shownOpp, view.myKicks, view.oppKicks, simultaneous, mode]);

  // Scene finished animating a kick → fire sound/badge, then bank it.
  const onPlayed = useCallback(() => {
    setAnim((cur) => {
      if (!cur) return null;
      const { side, kick } = cur;
      if (kick.outcome === "goal") { if (side === "me") { sfx.goal(); buzz([25, 40, 80]); } else { sfx.miss(); buzz(15); } }
      else if (kick.outcome === "saved") { sfx.save(); buzz(side === "me" ? 60 : [40, 30, 40]); }
      else { sfx.miss(); buzz(side === "me" ? 30 : 15); }
      setBadge({ outcome: kick.outcome, side });
      setTimeout(() => setBadge(null), reduced.current ? 500 : 1100);
      if (side === "me") setShownMe((n) => n + 1); else setShownOpp((n) => n + 1);
      // Banked — clear any locked input (a dive sets `pending` but, unlike a shot,
      // had no "me" reveal to clear it; without this the next round's button never
      // re-enables → shootout stalls after the first dive).
      setPending(false);
      setPhase("aim");
      return null;
    });
  }, []);

  // Watchdog: the 3D ball normally calls onPlayed when its flight ends (~1.5s).
  // But if the WebGL context is ever lost (mobile backgrounding, low memory, the
  // rAF loop stalling), that callback never comes and the shootout soft-locks.
  // onPlayed is idempotent (no-ops if anim already cleared), so a fallback timer
  // guarantees the game always advances even when the canvas freezes.
  useEffect(() => {
    if (!anim) return;
    const t = setTimeout(onPlayed, reduced.current ? 700 : 2400);
    return () => clearTimeout(t);
  }, [anim, onPlayed]);

  // Final banner sound.
  const cheered = useRef(false);
  const allShown = shownMe >= view.myKicks.length && shownOpp >= view.oppKicks.length;
  useEffect(() => {
    if (!view.result || anim || !allShown || cheered.current) return;
    cheered.current = true;
    if (view.result === "win") { sfx.win(); buzz([40, 60, 40, 60, 120]); } else { sfx.loss(); buzz(80); }
  }, [view.result, anim, allShown]);

  // Stable play object for the 3D scene (identity changes only when `anim` does,
  // so the scene's animation clock resets once per kick, not per render).
  const play3d = useMemo(
    () => (anim ? { shot: anim.kick.shot, dive: anim.kick.dive, outcome: anim.kick.outcome, side: anim.side } : null),
    [anim]
  );

  const idle = !anim && allShown;
  const canShoot = view.role === "shoot" && idle && !pending;
  const canDive = view.role === "dive" && idle && !pending;

  const lockPower = useCallback((power: PenPower) => {
    setPending(true);
    sfx.kick(); buzz(18);
    onShoot(aim, power);
  }, [aim, onShoot]);

  const myGoals = view.myKicks.reduce((s, k) => s + (k.outcome === "goal" ? 1 : 0), 0);
  const oppGoals = view.oppKicks.reduce((s, k) => s + (k.outcome === "goal" ? 1 : 0), 0);
  const round = Math.min(Math.max(view.myKicks.length, view.oppKicks.length) + (idle && !view.result ? 1 : 0), 99);

  const badgeColor = !badge ? "#fff"
    : badge.outcome === "goal" ? (badge.side === "me" ? ME : OPP)
    : badge.outcome === "saved" ? AMBER : "#cfd2dc";
  const badgeText = !badge ? "" : badge.outcome === "goal" ? "GOAL!" : badge.outcome === "saved" ? "SAVED!" : "MISS!";

  // 9-zone grid order is visual: top row (6,7,8), mid (3,4,5), low (0,1,2).
  const GRID: PenZone[] = [6, 7, 8, 3, 4, 5, 0, 1, 2];

  return (
    <div className="w-full select-none">
      <style>{`
        @keyframes pensPop { 0% { transform: scale(0.5); opacity: 0; } 55% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes pensConfetti { 0% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translateY(60vh) rotate(540deg); opacity: 0; } }
        @keyframes pensRingPulse { 0%,100% { transform: scale(1); opacity: 0.85; } 50% { transform: scale(1.12); opacity: 1; } }
      `}</style>

      {/* ── Stage: 3D scene with overlaid HUD ── */}
      <div className="relative w-full overflow-hidden rounded-2xl" style={{ aspectRatio: "9/12", background: "#05060d", border: "1px solid rgba(255,255,255,0.08)" }}>
        <PenaltyScene3D aim={canShoot ? aim : null} play={play3d} onPlayed={onPlayed} reduced={reduced.current} />

        {/* "YOU" marker — fixed taker + keeper never swap; this hops to whichever
            player the human controls this turn (above the taker when shooting, above
            the keeper in goal when saving). */}
        {!view.result && (
          <div className="absolute pointer-events-none" aria-hidden
            style={{ left: "50%", top: view.role === "dive" ? "20%" : "63%", transform: "translate(-50%,-50%)", zIndex: 9, transition: "top 320ms ease" }}>
            <div className="font-display" style={{ background: ME, color: "#0c1400", fontSize: 10, letterSpacing: 1.5, padding: "2px 8px", borderRadius: 6, boxShadow: `0 0 12px ${ME}88`, fontWeight: 700 }}>YOU</div>
            <div style={{ width: 0, height: 0, margin: "0 auto", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `6px solid ${ME}` }} />
          </div>
        )}

        {/* top HUD: round counter + score + pips */}
        <div className="absolute top-0 inset-x-0 px-3 pt-3 pb-6"
          style={{ background: "linear-gradient(180deg, rgba(4,5,12,0.82) 0%, rgba(4,5,12,0.4) 70%, transparent 100%)", zIndex: 10 }}>
          <div className="mx-auto rounded-xl px-3 py-1.5" style={{ maxWidth: 340, background: "rgba(8,10,18,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-center font-display" style={{ fontSize: 9, letterSpacing: 2.5, color: view.suddenDeath ? AMBER : "#8a8fa0" }}>
              {view.result ? "FULL TIME" : view.suddenDeath ? "☠ SUDDEN DEATH" : `ROUND ${Math.max(round, 1)} OF 5`}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-body truncate" style={{ fontSize: 10, color: ME }}>{myName}</div>
                <Pips kicks={view.myKicks} total={5} color={ME} align="left" />
              </div>
              <div className="font-display tabular-nums px-1" style={{ fontSize: 30, color: "#fff", letterSpacing: 1, textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>
                {myGoals}<span style={{ color: "#55596a" }}> - </span>{oppGoals}
              </div>
              <div className="flex-1 min-w-0 text-right">
                <div className="font-body truncate" style={{ fontSize: 10, color: OPP }}>{oppName}</div>
                <Pips kicks={view.oppKicks} total={5} color={OPP} align="right" />
              </div>
            </div>
          </div>
        </div>

        {/* sound toggle + live timer */}
        <button onClick={() => { const n = !sound; setSound(n); setSfxEnabled(n); if (n) sfx.whistle(); }}
          className="absolute top-3 right-3 rounded-md px-1.5 py-1" aria-label={sound ? "Mute" : "Unmute"}
          style={{ fontSize: 12, background: "rgba(8,10,18,0.7)", border: "1px solid rgba(255,255,255,0.1)", zIndex: 12, lineHeight: 1 }}>
          {sound ? "🔊" : "🔇"}
        </button>
        {secondsLeft != null && !view.result && (
          <div className="absolute top-3 left-3 rounded-md px-2 py-1 font-display tabular-nums"
            style={{ fontSize: 12, color: secondsLeft <= 10 ? AMBER : "#fff", background: "rgba(8,10,18,0.7)", letterSpacing: 1, zIndex: 12 }}>
            {secondsLeft}s
          </div>
        )}

        {/* result badge */}
        {badge && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none" style={{ zIndex: 11 }}>
            <span className="font-display" style={{ fontSize: 46, letterSpacing: 2, color: badgeColor, textShadow: "0 3px 22px rgba(0,0,0,0.9)", animation: reduced.current ? undefined : "pensPop 0.32s ease-out" }}>
              {badgeText}
            </span>
          </div>
        )}

        {/* bottom controls: aim grid + power, or dive, or waiting */}
        <div className="absolute bottom-0 inset-x-0 px-3 pb-3 pt-8"
          style={{ background: "linear-gradient(0deg, rgba(4,5,12,0.9) 0%, rgba(4,5,12,0.5) 70%, transparent 100%)", zIndex: 10 }}>

          {canShoot && phase === "aim" && (
            <div className="flex items-end gap-3">
              <div>
                <div className="font-display mb-1" style={{ fontSize: 9, letterSpacing: 1.5, color: "#8a8fa0" }}>AIM</div>
                <div className="grid grid-cols-3 gap-1" style={{ width: 132 }}>
                  {GRID.map((z) => {
                    const active = aim === z;
                    return (
                      <button key={z} onClick={() => { setAim(z); buzz(8); sfx.kick(); }}
                        className="rounded-md active:scale-95 transition-all" aria-label={`Aim ${["low","mid","high"][zoneRow(z)]} ${["left","center","right"][zoneColumn(z)]}`}
                        style={{
                          aspectRatio: "1/1",
                          background: active ? "rgba(180,255,46,0.22)" : "rgba(255,255,255,0.05)",
                          border: `1.5px solid ${active ? ME : "rgba(255,255,255,0.18)"}`,
                          boxShadow: active ? `0 0 10px ${ME}77` : undefined,
                        }}>
                        <span className="block mx-auto rounded-full" style={{ width: 4, height: 4, background: active ? ME : "rgba(255,255,255,0.3)" }} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={() => { setPhase("power"); sfx.whistle(); }}
                className="flex-1 rounded-xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
                style={{ background: ME, color: "#0c1400", fontSize: 16, boxShadow: `0 0 20px ${ME}55` }}>
                CONTINUE →
              </button>
            </div>
          )}

          {canShoot && phase === "power" && (
            <div>
              <PowerMeter running lockSignal={lockSignal} onLock={lockPower} reduced={reduced.current} />
              <div className="mt-3 flex gap-2">
                <button onClick={() => setPhase("aim")}
                  className="rounded-xl px-4 font-display tracking-wide active:scale-[0.97] transition-transform"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", color: "#cfd2dc", fontSize: 13 }}>
                  CHANGE AIM
                </button>
                <button onClick={() => setLockSignal((n) => n + 1)}
                  className="flex-1 rounded-xl py-3.5 font-display tracking-wide active:scale-[0.98] transition-transform"
                  style={{ background: ME, color: "#0c1400", fontSize: 17, boxShadow: `0 0 22px ${ME}66` }}>
                  TAKE PENALTY
                </button>
              </div>
            </div>
          )}

          {canDive && (
            <div>
              <div className="text-center font-body mb-2" style={{ fontSize: 11, color: "#aab" }}>{oppName} steps up — dive!</div>
              <div className="grid grid-cols-3 gap-2">
                {([0, 1, 2] as PenColumn[]).map((c) => (
                  <button key={c} onClick={() => { setPending(true); sfx.kick(); buzz(18); onDive(c); }}
                    className="rounded-xl py-3.5 font-display active:scale-[0.97] transition-transform"
                    style={{ fontSize: 13, letterSpacing: 1, color: ME, background: "rgba(180,255,46,0.1)", border: `1px solid ${ME}66` }}>
                    {c === 0 ? "◀ LEFT" : c === 1 ? "STAY" : "RIGHT ▶"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!canShoot && !canDive && !view.result && (
            <div className="text-center font-body py-2" style={{ fontSize: 12, color: "#8a8fa0" }}>
              {pending ? "…" : anim ? "" : simultaneous ? `Waiting for ${oppName}…` : ""}
            </div>
          )}
        </div>

        {/* final banner */}
        {view.result && idle && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(4,5,12,0.84)", zIndex: 13 }}>
            {view.result === "win" && !reduced.current && (
              <div className="absolute inset-x-0 top-0 pointer-events-none">
                {Array.from({ length: 16 }, (_, i) => (
                  <span key={i} className="absolute" style={{
                    left: `${4 + i * 6}%`, top: "-5%", width: 6, height: 11,
                    background: [ME, AMBER, "#fff", OPP][i % 4],
                    animation: `pensConfetti ${1.7 + (i % 5) * 0.3}s ease-in ${(i % 7) * 0.11}s forwards`,
                  }} />
                ))}
              </div>
            )}
            <div className="font-display" style={{ fontSize: 38, letterSpacing: 2, color: view.result === "win" ? ME : OPP, textShadow: `0 0 28px ${view.result === "win" ? ME : OPP}66`, animation: reduced.current ? undefined : "pensPop 0.35s ease-out" }}>
              {view.result === "win" ? "YOU WIN ON PENS" : "LOST ON PENS"}
            </div>
            <div className="font-display tabular-nums mt-1" style={{ fontSize: 24, color: "#fff", letterSpacing: 1 }}>{myGoals}–{oppGoals}</div>
          </div>
        )}
      </div>
    </div>
  );
}
