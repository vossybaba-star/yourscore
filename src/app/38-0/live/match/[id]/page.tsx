"use client";

/**
 * /38-0/live/match/[id] — the live two-half H2H screen. One client component
 * driven by the authoritative phase machine (via useLiveMatch): lobby → reveal →
 * pregame swap → half 1 → halftime swap → half 2 → (draw decision → penalties) →
 * result. Swaps go through a spin-and-choose sheet; the server validates them.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Pitch } from "@/components/draft/Pitch";
import { useLiveMatch } from "@/lib/draft/useLiveMatch";
import { spin, allBuckets, type Spin } from "@/lib/draft/pool";
import { playerIdentity } from "@/lib/draft/score";
import { slotsFor } from "@/lib/draft/formations";
import type { Formation, PlacedPlayer, PlayerSeason } from "@/lib/draft/types";

const BG = "#0a0a0f";

export default function LiveMatchScreen() {
  const { id } = useParams<{ id: string }>();
  const live = useLiveMatch(id ?? null);
  const { match: m, side, secondsLeft, opponentOnline, loading, error, actionError } = live;

  const view = useMemo(() => {
    if (!m || !side) return null;
    const meP1 = side === "p1";
    const pick = <T,>(a: T, b: T): [T, T] => (meP1 ? [a, b] : [b, a]); // [mine, opp]
    const [myName, oppName] = pick(m.p1_name, m.p2_name);
    const [mySquad, oppSquad] = pick(m.p1_squad as PlacedPlayer[] | null, m.p2_squad as PlacedPlayer[] | null);
    const [myFormation, oppFormation] = pick(m.p1_formation, m.p2_formation);
    const [myStr, oppStr] = pick(m.p1_strength, m.p2_strength);
    const [myPre, oppPre] = pick(m.p1_pregame_left, m.p2_pregame_left);
    const [myHalf] = pick(m.p1_half_left, m.p2_half_left);
    const [myReady] = pick(m.p1_ready, m.p2_ready);
    const h1 = pick(m.h1_p1, m.h1_p2);
    const h2 = pick(m.h2_p1, m.h2_p2);
    const pens = pick(m.pens_p1, m.pens_p2);
    const myGoals = (m.h1_p1 != null ? h1[0]! : 0) + (m.h2_p1 != null ? h2[0]! : 0);
    const oppGoals = (m.h1_p1 != null ? h1[1]! : 0) + (m.h2_p1 != null ? h2[1]! : 0);
    return {
      meP1, myName: myName ?? "You", oppName: oppName ?? "Opponent",
      mySquad: mySquad ?? [], oppSquad: oppSquad ?? [],
      myFormation: (myFormation ?? "4-3-3") as Formation, oppFormation: (oppFormation ?? "4-3-3") as Formation,
      myStr: Number(myStr ?? 0), oppStr: Number(oppStr ?? 0),
      swapsLeft: m.phase === "pregame_swap" ? Number(myPre ?? 0) : m.phase === "halftime_swap" ? Number(myHalf ?? 0) : 0,
      oppPre: Number(oppPre ?? 0), myReady,
      h1, h2, pens, myGoals, oppGoals,
    };
  }, [m, side]);

  const [spinSlot, setSpinSlot] = useState<string | null>(null);
  // The swap window belongs to one phase — close the sheet whenever the phase moves.
  useEffect(() => { setSpinSlot(null); }, [m?.phase]);

  if (loading) return <Centered>Loading match…</Centered>;
  if (error) return <Centered tone="error">{error} <Link href="/38-0/live" className="underline block mt-3">← Back</Link></Centered>;
  if (!m || !view) return <Centered tone="error">Not part of this match. <Link href="/38-0/live" className="underline">← Back</Link></Centered>;

  const inSwap = m.phase === "pregame_swap" || m.phase === "halftime_swap";

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: BG, color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-4 pt-8">
        {/* Scoreline header */}
        <Header view={view} phase={m.phase} secondsLeft={secondsLeft} opponentOnline={opponentOnline} />

        {/* What to do now + the rule — fills the space under the scoreline */}
        <Guide phase={m.phase} view={view} />

        {/* Phase body */}
        {m.phase === "lobby" && (
          <Panel>
            <p className="text-center" style={{ color: "#9a9ab0" }}>
              {m.p2_id || m.is_bot ? `${view.oppName} is here.` : "Waiting for your opponent to join…"}
            </p>
            {(m.p2_id || m.is_bot) && (
              <Action onClick={live.ready} disabled={view.myReady}>
                {view.myReady ? (secondsLeft != null ? `Ready ✓ — waiting for ${view.oppName}…` : "Ready ✓ — waiting…") : "I'm ready"}
              </Action>
            )}
            <Link href="/38-0/live" className="block text-center mt-3 text-sm underline" style={{ color: "#8888aa" }}>Leave</Link>
          </Panel>
        )}

        {m.phase === "reveal" && (
          <TwoXI view={view} caption="Opponents revealed — kick-off in" />
        )}

        {inSwap && (
          <Panel>
            <p className="text-center text-sm" style={{ color: "#9a9ab0" }}>
              {m.phase === "pregame_swap" ? "Pre-match: change 1 player after seeing their XI." : "Halftime: make up to 2 changes."}
              {" "}<b style={{ color: "#ffb800" }}>{view.swapsLeft} left</b>
            </p>
            <div className="mt-3">
              <Pitch formation={view.myFormation} squad={view.mySquad}
                onSlotClick={view.swapsLeft > 0 ? (s) => setSpinSlot(s) : undefined} />
            </div>
            <Action onClick={live.ready} disabled={view.myReady}>{view.myReady ? "Done ✓ — waiting…" : "Done"}</Action>
          </Panel>
        )}

        {(m.phase === "half1" || m.phase === "half2") && (
          <Panel>
            <p className="text-center font-display tracking-wide" style={{ fontSize: 26, color: "#00ff87" }}>
              {m.phase === "half1" ? "First Half" : "Second Half"}
            </p>
            <p className="text-center mt-2 text-sm" style={{ color: "#9a9ab0" }}>
              {m.phase === "half1" ? `${view.h1[0]} – ${view.h1[1]} this half` : `${view.h2[0]} – ${view.h2[1]} this half`}
            </p>
          </Panel>
        )}

        {m.phase === "draw_decision" && (
          <Panel>
            <p className="text-center font-display" style={{ fontSize: 24, color: "#ffb800" }}>Level after 90!</p>
            <p className="text-center mt-1 text-sm" style={{ color: "#9a9ab0" }}>Settle it on penalties? Both must agree.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button onClick={() => live.drawChoice(true)} className="rounded-2xl py-4 font-semibold" style={{ background: "#00ff87", color: "#04130a" }}>Penalties</button>
              <button onClick={() => live.drawChoice(false)} className="rounded-2xl py-4 font-semibold" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e8f0" }}>Take the draw</button>
            </div>
          </Panel>
        )}

        {m.phase === "penalties" && (
          <Panel>
            <p className="text-center font-display" style={{ fontSize: 24, color: "#ffb800" }}>Penalties</p>
            <p className="text-center mt-2" style={{ fontSize: 40, fontWeight: 700 }}>{view.pens[0]} – {view.pens[1]}</p>
          </Panel>
        )}

        {m.phase === "result" && <ResultPanel view={view} />}
        {m.phase === "abandoned" && <Panel><p className="text-center" style={{ color: "#9a9ab0" }}>Match abandoned.</p><Link href="/38-0/live" className="underline block text-center mt-3" style={{ color: "#00ff87" }}>Play again →</Link></Panel>}
      </div>

      {spinSlot && (
        <SpinSheet
          formation={view.myFormation} squad={view.mySquad} slotId={spinSlot}
          onClose={() => setSpinSlot(null)}
          onPick={(playerId) => { live.swap(spinSlot, playerId); setSpinSlot(null); }}
        />
      )}

      {actionError && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] rounded-xl px-4 py-3 text-sm text-center max-w-xs"
          style={{ background: "rgba(255,71,87,0.15)", color: "#ff9aa6", border: "1px solid rgba(255,71,87,0.4)" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

type View = {
  meP1: boolean; myName: string; oppName: string;
  mySquad: PlacedPlayer[]; oppSquad: PlacedPlayer[];
  myFormation: Formation; oppFormation: Formation;
  myStr: number; oppStr: number;
  swapsLeft: number; oppPre: number; myReady: boolean;
  h1: [number | null, number | null]; h2: [number | null, number | null]; pens: [number | null, number | null];
  myGoals: number; oppGoals: number;
};

function Header({ view, phase, secondsLeft, opponentOnline }: { view: View; phase: string; secondsLeft: number | null; opponentOnline: boolean }) {
  const showScore = ["half1", "halftime_swap", "half2", "draw_decision", "penalties", "result"].includes(phase);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <Link href="/38-0/live" style={{ color: "#8888aa" }}>← Live</Link>
        {secondsLeft != null && <span className="font-mono" style={{ color: secondsLeft <= 5 ? "#ff7a88" : "#ffb800" }}>{secondsLeft}s</span>}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Team name={view.myName} str={view.myStr} you online />
        <div className="text-center px-3">
          {showScore
            ? <div className="font-display" style={{ fontSize: 38, fontWeight: 800 }}>{view.myGoals} <span style={{ color: "#555" }}>–</span> {view.oppGoals}</div>
            : <div style={{ color: "#555", fontSize: 22 }}>vs</div>}
        </div>
        <Team name={view.oppName} str={view.oppStr} online={opponentOnline} alignRight />
      </div>
    </div>
  );
}

function Team({ name, str, you, online, alignRight }: { name: string; str: number; you?: boolean; online?: boolean; alignRight?: boolean }) {
  return (
    <div className={alignRight ? "text-right" : ""} style={{ maxWidth: 130 }}>
      <div className="font-semibold truncate" style={{ color: you ? "#00ff87" : "#e8e8f0" }}>{name}</div>
      <div className="text-xs" style={{ color: "#9a9ab0" }}>STR {str.toFixed(1)}{online != null && <span style={{ color: online ? "#00ff87" : "#555" }}> ●</span>}</div>
    </div>
  );
}

function TwoXI({ view, caption }: { view: View; caption: string }) {
  return (
    <Panel>
      <p className="text-center text-sm" style={{ color: "#9a9ab0" }}>{caption}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Pitch formation={view.myFormation} squad={view.mySquad} compact />
        <Pitch formation={view.oppFormation} squad={view.oppSquad} compact />
      </div>
    </Panel>
  );
}

function ResultPanel({ view }: { view: View }) {
  const drew = view.myGoals === view.oppGoals && (view.pens[0] == null);
  const won = view.pens[0] != null ? view.pens[0]! > view.pens[1]! : view.myGoals > view.oppGoals;
  const label = drew ? "Draw" : won ? "You win!" : "You lost";
  const color = drew ? "#ffb800" : won ? "#00ff87" : "#ff7a88";
  return (
    <Panel>
      <p className="text-center font-display tracking-wide" style={{ fontSize: 34, color }}>{label}</p>
      <p className="text-center mt-1" style={{ fontSize: 40, fontWeight: 800 }}>
        {view.myGoals} – {view.oppGoals}{view.pens[0] != null && <span className="block text-sm" style={{ color: "#9a9ab0" }}>pens {view.pens[0]}–{view.pens[1]}</span>}
      </p>
      <Link href="/38-0/live" className="mt-6 block text-center rounded-2xl py-4 font-semibold" style={{ background: "#00ff87", color: "#04130a" }}>Play again</Link>
      <Link href="/38-0/leaderboard" className="mt-3 block text-center underline text-sm" style={{ color: "#8888aa" }}>View leaderboard</Link>
    </Panel>
  );
}

function SpinSheet({ formation, squad, slotId, onPick, onClose }: { formation: Formation; squad: PlacedPlayer[]; slotId: string; onPick: (playerId: string) => void; onClose: () => void }) {
  const slot = slotsFor(formation).find((s) => s.id === slotId)!;
  const [result, setResult] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);

  function doSpin() {
    setSpinning(true); setResult(null);
    const usedIds = new Set(squad.filter((p) => p.slot !== slotId).map((p) => p.player_season_id));
    const usedNames = new Set(squad.filter((p) => p.slot !== slotId).map((p) => playerIdentity(p.name)));
    const buckets = allBuckets();
    let ticks = 0;
    const t = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season });
      if (++ticks > 11) {
        clearInterval(t);
        const r = spin([slot.pos], usedIds, usedNames);
        setReel({ club: r.club, season: r.season });
        setResult(r); setSpinning(false);
      }
    }, 70);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10" style={{ background: "#13131c", border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Change {slot.pos}</h3>
          <button onClick={onClose} style={{ color: "#8888aa" }}>Cancel</button>
        </div>

        {!result && (
          <button onClick={doSpin} disabled={spinning} className="mt-5 w-full rounded-2xl py-4 font-semibold" style={{ background: "#ffb800", color: "#1a1300", opacity: spinning ? 0.7 : 1 }}>
            {spinning ? `${reel?.club ?? ""} ${reel?.season ?? ""}…` : "Spin"}
          </button>
        )}

        {result && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide" style={{ color: "#7a7a92" }}>{result.club} · {result.season}</p>
            <div className="mt-2 space-y-2 max-h-[40vh] overflow-y-auto">
              {result.players.map((p: PlayerSeason) => (
                <button key={p.id} onClick={() => onPick(p.id)} className="w-full flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <span><span className="font-semibold">{p.name}</span> <span className="text-xs" style={{ color: "#9a9ab0" }}>{p.position}</span></span>
                  <span className="font-bold" style={{ color: "#00ff87" }}>{p.overall}</span>
                </button>
              ))}
            </div>
            <button onClick={doSpin} className="mt-3 w-full rounded-xl py-3 text-sm" style={{ background: "rgba(255,255,255,0.06)", color: "#9a9ab0" }}>Re-spin (keeps your change)</button>
          </div>
        )}
      </div>
    </div>
  );
}

function scoreline(v: View): string {
  const d = v.myGoals - v.oppGoals;
  return d > 0 ? `You're ${v.myGoals}–${v.oppGoals} up` : d < 0 ? `You're ${v.myGoals}–${v.oppGoals} down` : `Level at ${v.myGoals}–${v.oppGoals}`;
}

// What the player should be doing right now + the rule behind it, per phase.
const PHASE_GUIDE: Record<string, { tag: string; text: (v: View) => string }> = {
  lobby:         { tag: "LOBBY",             text: () => "Tap I'm ready — kick-off the moment both managers are ready." },
  reveal:        { tag: "KICK-OFF",          text: () => "Your XI (left) vs your opponent's (right). Size them up — you'll get to react in a moment." },
  pregame_swap:  { tag: "PRE-MATCH",         text: (v) => `Tap any of your players to spin a replacement for that position — or keep your XI. Stronger team = more goals. ${v.swapsLeft} change${v.swapsLeft === 1 ? "" : "s"} left, then tap Done.` },
  half1:         { tag: "FIRST HALF",        text: () => "Goals are simulated live from each team's Strength — sit tight." },
  halftime_swap: { tag: "HALFTIME",          text: (v) => `${scoreline(v)}. Make up to 2 changes to swing the second half, then tap Done.` },
  half2:         { tag: "SECOND HALF",       text: () => "Last 45 — your halftime changes are now in play." },
  draw_decision: { tag: "FULL TIME · LEVEL", text: () => "It's level. Both managers must choose Penalties to settle it — or take the draw." },
  penalties:     { tag: "PENALTIES",         text: () => "Spot-kicks decide it — a near coin-flip." },
};

function Guide({ phase, view }: { phase: string; view: View }) {
  const g = PHASE_GUIDE[phase];
  if (!g) return null;
  return (
    <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.18)" }}>
      <div className="font-display tracking-wide" style={{ fontSize: 11, letterSpacing: 1, color: "#00ff87" }}>{g.tag}</div>
      <div className="mt-1" style={{ fontSize: 13.5, color: "#cfcfe6", lineHeight: 1.4 }}>{g.text(view)}</div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>{children}</div>;
}
function Action({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="mt-4 w-full rounded-2xl py-4 font-semibold" style={{ background: disabled ? "rgba(255,255,255,0.06)" : "#00ff87", color: disabled ? "#9a9ab0" : "#04130a" }}>{children}</button>;
}
function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: BG, color: tone === "error" ? "#ff7a88" : "#9a9ab0" }}><div>{children}</div></div>;
}
