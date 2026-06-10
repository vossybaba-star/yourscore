"use client";

/**
 * /38-0/live/match/[id] — the live two-half H2H screen. One client component
 * driven by the authoritative phase machine (via useLiveMatch): lobby → reveal →
 * pregame swap → half 1 → halftime swap → half 2 → (draw decision → penalties) →
 * result. Swaps go through a spin-and-choose sheet; the server validates them.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Pitch } from "@/components/draft/Pitch";
import { useLiveMatch } from "@/lib/draft/useLiveMatch";
import { spin, allBuckets, type Spin } from "@/lib/draft/pool";
import { playerIdentity, seededRng } from "@/lib/draft/score";
import { slotsFor } from "@/lib/draft/formations";
import { buildReport, type MatchSim, type HalfSim, type PlayerRating, type GoalEvent } from "@/lib/draft/live-score";
import { MatchPitch } from "@/components/draft/MatchPitch";
import { WATCH_CONFIG } from "@/lib/draft/playback";
import { liveOgQuery } from "@/lib/draft/share";
import { loadTeam, saveTeam, clearTeam } from "@/lib/draft/local";
import { createClient } from "@/lib/supabase/client";
import type { Formation, PlacedPlayer, PlayerSeason } from "@/lib/draft/types";
import type { DraftLiveMatchRow } from "@/types/draft-db";

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

  const sim = (m.sim ?? null) as MatchSim | null;

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
          <TwoXI view={view} caption="Opponents revealed — size up both XIs" countdown={secondsLeft} />
        )}

        {m.phase === "pregame_swap" && (
          <Panel>
            <p className="text-center text-sm" style={{ color: "#9a9ab0" }}>
              Pre-match: change 1 player after seeing their XI. <b style={{ color: "#ffb800" }}>{view.swapsLeft} left</b>
            </p>
            <div className="mt-3">
              <Pitch formation={view.myFormation} squad={view.mySquad}
                onSlotClick={view.swapsLeft > 0 ? (s) => setSpinSlot(s) : undefined} />
            </div>
            <Action onClick={live.ready} disabled={view.myReady}>{view.myReady ? "Done ✓ — waiting…" : "Done"}</Action>
          </Panel>
        )}

        {m.phase === "halftime_swap" && (
          <>
            {/* Half-time banner */}
            <Panel>
              <div className="text-center py-2">
                <p className="font-display tracking-[0.25em] text-white mb-1" style={{ fontSize: 13, color: "#ffb800" }}>⚽ HALF-TIME ⚽</p>
                <p className="font-display" style={{ fontSize: 52, fontWeight: 900, lineHeight: 1 }}>
                  {view.myGoals} – {view.oppGoals}
                </p>
                <p className="font-body text-sm mt-2" style={{ color: "#9a9ab0" }}>
                  {view.myName} vs {view.oppName}
                </p>
              </div>
            </Panel>

            {/* Half-time report + both squads, then your changes (one combined screen). */}
            {sim?.h1 && (
              <Panel>
                <div className="mt-3">
                  <MatchReportCard rv={halftimeView(sim.h1, view.meP1)} meP1={view.meP1} myName={view.myName} oppName={view.oppName} showPotm={false} />
                </div>
                <div className="mt-4">
                  <div className="text-xs mb-1" style={{ color: "#7a7a92", letterSpacing: 1 }}>BOTH SQUADS</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Pitch formation={view.myFormation} squad={view.mySquad} compact />
                    <Pitch formation={view.oppFormation} squad={view.oppSquad} compact />
                  </div>
                </div>
              </Panel>
            )}
            <Panel>
              <p className="text-center text-sm" style={{ color: "#9a9ab0" }}>
                Make up to 2 changes for the second half. <b style={{ color: "#ffb800" }}>{view.swapsLeft} left</b>
              </p>
              <div className="mt-3">
                <Pitch formation={view.myFormation} squad={view.mySquad}
                  onSlotClick={view.swapsLeft > 0 ? (s) => setSpinSlot(s) : undefined} />
              </div>
              <Action onClick={live.ready} disabled={view.myReady}>{view.myReady ? "Done ✓ — waiting…" : "Done"}</Action>
            </Panel>
          </>
        )}

        {(m.phase === "half1" || m.phase === "half2") && (() => {
          const isH1 = m.phase === "half1";
          const hs = isH1 ? sim?.h1 : sim?.h2;
          const H = WATCH_CONFIG.halfSeconds;
          const progress = Math.max(0, Math.min(1, 1 - (secondsLeft ?? H) / H));
          if (!hs) {
            return (
              <Panel>
                <p className="text-center font-display tracking-wide" style={{ fontSize: 26, color: "#00ff87" }}>
                  {isH1 ? "Kick-off!" : "Second half underway"}
                </p>
              </Panel>
            );
          }
          return (
            <Panel>
              <MatchPitch
                sim={hs} half={isH1 ? 1 : 2} matchId={m.id} progress={progress}
                priorGoals={isH1 ? { a: 0, b: 0 } : { a: m.h1_p1 ?? 0, b: m.h1_p2 ?? 0 }}
                meSide={view.meP1 ? "a" : "b"} myName={view.myName} oppName={view.oppName}
              />
            </Panel>
          );
        })()}

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

        {m.phase === "result" && <ResultPanel view={view} sim={sim} m={m} />}
        {m.phase === "abandoned" && (
          <Panel>
            <p className="text-center text-2xl mb-3">⏰</p>
            <p className="font-display text-center text-white text-lg mb-2">Match Abandoned</p>
            <p className="font-body text-center text-sm mb-4" style={{ color: "#9a9ab0" }}>
              {view.myReady
                ? `${view.oppName} didn't show up in time.`
                : "The match timed out before it could start."}
            </p>
            <Link href="/38-0/live" className="block text-center font-body text-sm" style={{ color: "#00ff87" }}>
              Play again →
            </Link>
          </Panel>
        )}
      </div>

      {spinSlot && (
        <SpinSheet
          formation={view.myFormation} squad={view.mySquad} slotId={spinSlot}
          seedKey={`${m.id}:${side}:${m.phase}:${spinSlot}`}
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
  // While a half is playing the server already holds the final half score, so the
  // header must NOT show it — that would spoil the live playback. The running score
  // lives in <MatchPitch>; half-time/result legitimately show the score.
  const showScore = ["halftime_swap", "draw_decision", "penalties", "result"].includes(phase);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <Link href="/38-0/live" style={{ color: "#8888aa" }}>← Live</Link>
        {secondsLeft != null
          ? <span className="font-mono rounded-full px-2.5 py-1" style={{ fontSize: 14, fontWeight: 700, color: secondsLeft <= 5 ? "#ff7a88" : "#ffb800", background: secondsLeft <= 5 ? "rgba(255,71,87,0.14)" : "rgba(255,184,0,0.12)" }}>⏱ {secondsLeft}s</span>
          : phase === "lobby" && <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "#9a9ab0" }}><span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#ffb800" }} />waiting</span>}
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

function TwoXI({ view, caption, countdown }: { view: View; caption: string; countdown?: number | null }) {
  return (
    <Panel>
      <p className="text-center text-sm" style={{ color: "#9a9ab0" }}>{caption}</p>
      {countdown != null && (
        <p className="text-center font-display tracking-wide mt-1" style={{ fontSize: 30, lineHeight: 1.1, color: countdown <= 5 ? "#ff7a88" : "#00ff87" }}>
          Kick-off in {countdown}s
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Pitch formation={view.myFormation} squad={view.mySquad} compact />
        <Pitch formation={view.oppFormation} squad={view.oppSquad} compact />
      </div>
    </Panel>
  );
}

function ResultPanel({ view, sim, m }: { view: View; sim: MatchSim | null; m: DraftLiveMatchRow }) {
  const router = useRouter();
  const drew = view.myGoals === view.oppGoals && (view.pens[0] == null);
  const won = view.pens[0] != null ? view.pens[0]! > view.pens[1]! : view.myGoals > view.oppGoals;
  const label = drew ? "Draw" : won ? "You win!" : "You lost";
  const color = drew ? "#ffb800" : won ? "#00ff87" : "#ff7a88";
  const rv = sim ? fulltimeView(sim, view.meP1) : null;
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // Auto-assigned team prompt
  const [isAutoTeam, setIsAutoTeam] = useState(false);
  useEffect(() => {
    setIsAutoTeam(loadTeam()?.autoAssigned === true);
  }, []);

  function keepTeam() {
    const t = loadTeam();
    if (t) saveTeam({ ...t, autoAssigned: undefined });
    setIsAutoTeam(false);
  }
  function buildOwn() {
    const t = loadTeam();
    if (t) saveTeam({ ...t, autoAssigned: undefined });
    clearTeam();
    router.push("/38-0");
  }

  // Friend suggestion
  const oppId = view.meP1 ? m.p2_id : m.p1_id;
  const [friendState, setFriendState] = useState<"idle" | "sent" | "dismissed">("idle");
  async function addFriend() {
    if (!oppId) return;
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb.from("friendships").insert({ user_id: user.id, friend_id: oppId, status: "pending" });
    setFriendState("sent");
  }

  // Canonical (p1/p2) report → the share card matches the public unfurl page, so
  // both managers share the same image regardless of which side they're on.
  const report = sim ? buildReport(sim) : null;
  const pens = m.pens_p1 != null && m.pens_p2 != null ? { a: m.pens_p1, b: m.pens_p2 } : null;
  const link = typeof window !== "undefined" ? `${location.origin}/38-0/match/${m.id}` : "";
  const ogUrl = report && typeof window !== "undefined"
    ? `${location.origin}/api/draft/live-og?${liveOgQuery({ p1: m.p1_name ?? "Home", p2: m.p2_name ?? "Away", s1: report.a.goals, s2: report.b.goals, str1: m.p1_strength, str2: m.p2_strength, pens, report })}`
    : null;

  async function share() {
    if (sharing) return;
    setSharing(true); setShareNote(null);
    const text = `${m.p1_name} ${report?.a.goals ?? view.myGoals}–${report?.b.goals ?? view.oppGoals} ${m.p2_name} on 38-0 Live${report?.potm ? ` · ⭐ ${report.potm.name} (${report.potm.rating.toFixed(1)})` : ""}`;
    // Best for X / socials: share the actual image as a media file.
    try {
      if (ogUrl && typeof navigator.canShare === "function") {
        const blob = await (await fetch(ogUrl)).blob();
        const file = new File([blob], "38-0-result.png", { type: "image/png" });
        if (blob.size > 0 && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text, title: "38-0 Live result" });
          setSharing(false); return;
        }
      }
    } catch { /* fall through to link */ }
    // Fallback: share / copy the unfurling link.
    try {
      if (navigator.share) await navigator.share({ title: "38-0 Live result", text, url: link });
      else { await navigator.clipboard.writeText(`${text} ${link}`); setShareNote("Link copied"); }
    } catch { /* user cancelled */ }
    setSharing(false);
  }

  return (
    <Panel>
      <p className="text-center font-display tracking-wide" style={{ fontSize: 34, color }}>{label}</p>
      <p className="text-center mt-1" style={{ fontSize: 40, fontWeight: 800 }}>
        {view.myGoals} – {view.oppGoals}{view.pens[0] != null && <span className="block text-sm" style={{ color: "#9a9ab0" }}>pens {view.pens[0]}–{view.pens[1]}</span>}
      </p>
      {rv && (
        <div className="mt-4">
          <div className="text-xs mb-2" style={{ color: "#ffb800", letterSpacing: 1 }}>FULL-TIME REPORT</div>
          <MatchReportCard rv={rv} meP1={view.meP1} myName={view.myName} oppName={view.oppName} showPotm />
        </div>
      )}
      {/* Auto-assigned team — keep or rebuild */}
      {isAutoTeam && (
        <div className="mt-4 rounded-2xl p-4" style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.2)" }}>
          <p className="font-body text-center mb-3" style={{ fontSize: 13, color: "#8888aa" }}>
            We picked a random XI for you. Want to keep it?
          </p>
          <div className="flex gap-2">
            <button onClick={keepTeam}
              className="flex-1 rounded-xl py-2.5 font-body font-semibold text-sm"
              style={{ background: "#00ff87", color: "#062013" }}>
              Keep this XI ✓
            </button>
            <button onClick={buildOwn}
              className="flex-1 rounded-xl py-2.5 font-body text-sm"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#cfcfe6" }}>
              Build my own
            </button>
          </div>
        </div>
      )}

      {/* Friend suggestion — real opponent only, one-shot per session */}
      {!m.is_bot && oppId && friendState === "idle" && (
        <div className="mt-4 rounded-2xl p-4" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.2)" }}>
          <p className="font-body text-center mb-3" style={{ fontSize: 13, color: "#a78bfa" }}>
            Add {view.oppName} as a friend?
          </p>
          <div className="flex gap-2">
            <button onClick={addFriend}
              className="flex-1 rounded-xl py-2.5 font-body font-semibold text-sm"
              style={{ background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.35)", color: "#a78bfa" }}>
              Add friend
            </button>
            <button onClick={() => setFriendState("dismissed")}
              className="flex-1 rounded-xl py-2.5 font-body text-sm"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#8888aa" }}>
              Not now
            </button>
          </div>
        </div>
      )}
      {!m.is_bot && oppId && friendState === "sent" && (
        <p className="mt-4 text-center font-body text-sm" style={{ color: "#00ff87" }}>Friend request sent ✓</p>
      )}

      <button onClick={share} disabled={sharing} className="mt-5 w-full rounded-2xl py-4 font-semibold disabled:opacity-60" style={{ background: "#00ff87", color: "#04130a" }}>
        {sharing ? "Preparing image…" : "📤 Share result"}
      </button>
      {ogUrl && (
        <a href={ogUrl} target="_blank" rel="noopener noreferrer" download="38-0-result.png" className="mt-3 block text-center rounded-2xl py-3 font-semibold" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e8f0" }}>
          Save image
        </a>
      )}
      {shareNote && <p className="text-center mt-2 text-xs" style={{ color: "#00ff87" }}>{shareNote}</p>}
      <Link href="/38-0/live" className="mt-3 block text-center rounded-2xl py-3 font-semibold" style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.3)" }}>Play again</Link>
      <Link href="/38-0/leaderboard" className="mt-3 block text-center underline text-sm" style={{ color: "#8888aa" }}>View leaderboard</Link>
    </Panel>
  );
}

// ── Match report (half-time + full-time) ──────────────────────────────────────

type StatLine = { goals: number; possession: number; shots: number; shotsOnTarget: number; corners: number; fouls: number; offsides: number; throwins: number };
type ReportView = {
  mine: StatLine; opp: StatLine;
  events: GoalEvent[];
  myRatings: PlayerRating[]; oppRatings: PlayerRating[];
  myBest: PlayerRating | null; myWorst: PlayerRating | null;
  oppBest: PlayerRating | null; oppWorst: PlayerRating | null;
  potm: { name: string; rating: number; mine: boolean } | null;
};

const bestOf = (rs: PlayerRating[]): PlayerRating | null => rs.length ? rs.reduce((m, p) => (p.rating > m.rating ? p : m)) : null;
const worstOf = (rs: PlayerRating[]): PlayerRating | null => rs.length ? rs.reduce((m, p) => (p.rating < m.rating ? p : m)) : null;
const ratingColor = (r: number): string => (r >= 8 ? "#00ff87" : r >= 7 ? "#cfcfe6" : r >= 6 ? "#ffb800" : "#ff7a88");

/** Map one half's sim onto me/opp (no PotM at the break). */
function halftimeView(h: HalfSim, meP1: boolean): ReportView {
  const side = (k: "a" | "b"): StatLine => ({
    goals: h.goals[k], possession: h.possession[k], shots: h.shots[k], shotsOnTarget: h.shotsOnTarget[k],
    corners: h.corners[k], fouls: h.fouls[k], offsides: h.offsides[k], throwins: h.throwins[k],
  });
  const sa = side("a"), sb = side("b");
  const myR = meP1 ? h.ratingsA : h.ratingsB;
  const oppR = meP1 ? h.ratingsB : h.ratingsA;
  return {
    mine: meP1 ? sa : sb, opp: meP1 ? sb : sa, events: h.events,
    myRatings: myR, oppRatings: oppR,
    myBest: bestOf(myR), myWorst: worstOf(myR), oppBest: bestOf(oppR), oppWorst: worstOf(oppR), potm: null,
  };
}

/** Map the full-time report (both halves) onto me/opp, with Player of the Match. */
function fulltimeView(sim: MatchSim, meP1: boolean): ReportView {
  const r = buildReport(sim);
  return {
    mine: meP1 ? r.a : r.b, opp: meP1 ? r.b : r.a, events: r.events,
    myRatings: meP1 ? r.ratingsA : r.ratingsB, oppRatings: meP1 ? r.ratingsB : r.ratingsA,
    myBest: meP1 ? r.bestA : r.bestB, myWorst: meP1 ? r.worstA : r.worstB,
    oppBest: meP1 ? r.bestB : r.bestA, oppWorst: meP1 ? r.worstB : r.worstA,
    potm: r.potm ? { name: r.potm.name, rating: r.potm.rating, mine: (r.potm.side === "a") === meP1 } : null,
  };
}

function MatchReportCard({ rv, meP1, myName, oppName, showPotm }: { rv: ReportView; meP1: boolean; myName: string; oppName: string; showPotm?: boolean }) {
  const rows: [string, number, number, boolean?][] = [
    ["Goals", rv.mine.goals, rv.opp.goals],
    ["Possession", rv.mine.possession, rv.opp.possession, true],
    ["Shots", rv.mine.shots, rv.opp.shots],
    ["On target", rv.mine.shotsOnTarget, rv.opp.shotsOnTarget],
    ["Corners", rv.mine.corners, rv.opp.corners],
    ["Fouls", rv.mine.fouls, rv.opp.fouls],
    ["Offsides", rv.mine.offsides, rv.opp.offsides],
    ["Throw-ins", rv.mine.throwins, rv.opp.throwins],
  ];
  return (
    <>
      {/* Stat table — You / stat / Opp */}
      <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center px-3 py-1.5 text-xs" style={{ color: "#9a9ab0", background: "rgba(255,255,255,0.03)" }}>
          <span className="flex-1 text-left truncate" style={{ color: "#00ff87" }}>{myName}</span>
          <span style={{ width: 90, textAlign: "center" }} />
          <span className="flex-1 text-right truncate">{oppName}</span>
        </div>
        {rows.map(([label, a, b, pct]) => (
          <div key={label} className="flex items-center px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="flex-1 text-left tabular-nums font-bold" style={{ fontSize: 16, color: a >= b ? "#fff" : "#9a9ab0" }}>{a}{pct ? "%" : ""}</span>
            <span style={{ width: 90, textAlign: "center", fontSize: 10, letterSpacing: 1, color: "#7a7a92" }}>{label.toUpperCase()}</span>
            <span className="flex-1 text-right tabular-nums font-bold" style={{ fontSize: 16, color: b >= a ? "#fff" : "#9a9ab0" }}>{b}{pct ? "%" : ""}</span>
          </div>
        ))}
      </div>

      {/* Goal feed */}
      {rv.events.length > 0 && (
        <div className="mt-3">
          <div className="text-xs mb-1" style={{ color: "#7a7a92", letterSpacing: 1 }}>GOALS</div>
          <div className="space-y-1">
            {rv.events.map((e, i) => {
              const mine = (e.side === "a") === meP1;
              return (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-mono" style={{ width: 30, color: "#7a7a92" }}>{e.minute}&apos;</span>
                  <span style={{ color: mine ? "#00ff87" : "#e8e8f0" }}>⚽ {e.scorerName}</span>
                  {e.assistName && <span className="text-xs truncate" style={{ color: "#9a9ab0" }}>↳ {e.assistName}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PotM + best/worst per side */}
      {showPotm && rv.potm && (
        <div className="mt-3 rounded-xl px-4 py-3 text-center" style={{ background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.35)" }}>
          <div className="text-xs" style={{ color: "#ffb800", letterSpacing: 1 }}>⭐ PLAYER OF THE MATCH</div>
          <div className="font-display tracking-wide mt-0.5" style={{ fontSize: 20 }}>{rv.potm.name} <span style={{ color: "#ffb800" }}>{rv.potm.rating.toFixed(1)}</span></div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <PerfPill label={`${myName} — best`} p={rv.myBest} color="#00ff87" />
        <PerfPill label={`${myName} — worst`} p={rv.myWorst} color="#ff7a88" />
        <PerfPill label={`${oppName} — best`} p={rv.oppBest} color="#cfcfe6" />
        <PerfPill label={`${oppName} — worst`} p={rv.oppWorst} color="#9a9ab0" />
      </div>

      {/* Your XI ratings */}
      {rv.myRatings.length > 0 && (
        <div className="mt-3">
          <div className="text-xs mb-1" style={{ color: "#7a7a92", letterSpacing: 1 }}>YOUR XI RATINGS</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {[...rv.myRatings].sort((a, b) => b.rating - a.rating).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate" style={{ color: "#cfcfe6" }}><span style={{ color: "#7a7a92" }}>{p.pos}</span> {p.name}{p.goals > 0 ? " ⚽".repeat(Math.min(p.goals, 3)) : ""}</span>
                <span className="tabular-nums font-bold" style={{ color: ratingColor(p.rating) }}>{p.rating.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PerfPill({ label, p, color }: { label: string; p: PlayerRating | null; color: string }) {
  if (!p) return null;
  return (
    <div className="rounded-xl px-3 py-2 min-w-0" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="text-xs truncate" style={{ color: "#7a7a92" }}>{label}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate" style={{ fontSize: 13 }}>{p.name}</span>
        <span className="tabular-nums font-bold" style={{ color }}>{p.rating.toFixed(1)}</span>
      </div>
    </div>
  );
}

function SpinSheet({ formation, squad, slotId, seedKey, onPick, onClose }: { formation: Formation; squad: PlacedPlayer[]; slotId: string; seedKey: string; onPick: (playerId: string) => void; onClose: () => void }) {
  const slot = slotsFor(formation).find((s) => s.id === slotId)!;
  const [result, setResult] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);

  // ONE spin per position: the bucket is seeded by (match, side, phase, slot), so
  // closing and re-opening shows the SAME options — no re-rolling until you like it.
  function doSpin() {
    setSpinning(true); setResult(null);
    const usedIds = new Set(squad.filter((p) => p.slot !== slotId).map((p) => p.player_season_id));
    const usedNames = new Set(squad.filter((p) => p.slot !== slotId).map((p) => playerIdentity(p.name)));
    const buckets = allBuckets();
    let ticks = 0;
    const t = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season }); // cosmetic flicker only
      if (++ticks > 11) {
        clearInterval(t);
        const r = spin([slot.pos], usedIds, usedNames, seededRng(seedKey)); // seeded → fixed
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
          <>
            <button onClick={doSpin} disabled={spinning} className="mt-5 w-full rounded-2xl py-4 font-semibold" style={{ background: "#ffb800", color: "#1a1300", opacity: spinning ? 0.7 : 1 }}>
              {spinning ? `${reel?.club ?? ""} ${reel?.season ?? ""}…` : "Spin"}
            </button>
            <p className="mt-2 text-center text-xs" style={{ color: "#7a7a92" }}>One spin per position — pick from what you&apos;re dealt, or keep your player.</p>
          </>
        )}

        {result && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide" style={{ color: "#7a7a92" }}>{result.club} · {result.season} — pick one or cancel to keep your player</p>
            <div className="mt-2 space-y-2 max-h-[40vh] overflow-y-auto">
              {result.players.map((p: PlayerSeason) => (
                <button key={p.id} onClick={() => onPick(p.id)} className="w-full flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <span><span className="font-semibold">{p.name}</span> <span className="text-xs" style={{ color: "#9a9ab0" }}>{p.position}</span></span>
                  <span className="font-bold" style={{ color: "#00ff87" }}>{p.overall}</span>
                </button>
              ))}
            </div>
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
