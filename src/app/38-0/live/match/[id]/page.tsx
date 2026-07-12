"use client";

/**
 * /38-0/live/match/[id] — the live two-half H2H screen. One client component
 * driven by the authoritative phase machine (via useLiveMatch): lobby → reveal →
 * pregame swap → half 1 → halftime swap → half 2 → (draw decision → penalties) →
 * result. Swaps go through a spin-and-choose sheet; the server validates them.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Pitch } from "@/components/draft/Pitch";
import { BackPill } from "@/components/ui/BackPill";
import { useLiveMatch } from "@/lib/draft/useLiveMatch";
import { spin, spinWorld, allBuckets, ensurePool, isPoolReady } from "@/lib/draft/pool";
import { playerIdentity, seededRng } from "@/lib/draft/score";
import { slotsFor } from "@/lib/draft/formations";
import { buildReport, flipReport, type MatchSim, type HalfSim, type PlayerRating, type GoalEvent } from "@/lib/draft/live-score";
import { kickAllowed, shootoutStatus, type PenKick } from "@/lib/draft/pens";
import { PenaltyShootout, type PensView } from "@/components/draft/PenaltyShootout";
import { ScorecardView, statsFromReport, goalsFromReport, potmFromReport, type ScorecardData } from "@/components/draft/Scorecard";
import { MatchPitch } from "@/components/draft/MatchPitch";
import { WATCH_CONFIG } from "@/lib/draft/playback";
import { loadTeam, saveTeam, clearTeam } from "@/lib/draft/local";
import { AddFriendCard } from "@/components/social/AddFriendCard";
import { RankRewardCard } from "@/components/rank/RankRewardCard";
import { positionColor } from "@/lib/rank";
import { trackGamePlay, trackGameComplete, trackShare } from "@/lib/analytics/trackGame";
import { asCompetition, type Competition, type Formation, type PlacedPlayer, type PlayerSeason } from "@/lib/draft/types";
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

  // The deciding kick flips the phase to result immediately — hold the shootout
  // on screen a beat so the last ball and the WIN/LOSS banner aren't cut off.
  const [pensHold, setPensHold] = useState(false);
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = m?.phase ?? null;
    if (prev === "penalties" && m?.phase === "result") {
      setPensHold(true);
      const t = setTimeout(() => setPensHold(false), 3200);
      return () => clearTimeout(t);
    }
  }, [m?.phase]);

  // Per-game audience signals: "play" once on entering a live H2H match, "complete"
  // once it reaches the result phase. Refs guard against re-firing on re-render.
  const playedRef = useRef(false);
  const completedRef = useRef(false);
  useEffect(() => {
    if (!m) return;
    if (!playedRef.current) { playedRef.current = true; trackGamePlay("38-0", { mode: "live_h2h" }); }
    if (m.phase === "result" && !completedRef.current) { completedRef.current = true; trackGameComplete("38-0", { mode: "live_h2h" }); }
  }, [m]);

  // Bot match: 2 s after the human taps Done in a swap window, mirror it for the bot
  // so the phase advances without waiting the full timer. Uses a ref for the callback
  // so the timeout always calls the latest live.botDone without listing live in deps.
  const botDoneCb = useRef(live.botDone);
  useEffect(() => { botDoneCb.current = live.botDone; });
  const botDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Only for bot matches, only in swap windows, only once the human is ready.
    if (!m?.is_bot || !m.p1_ready) return;
    if (m.phase !== "pregame_swap" && m.phase !== "halftime_swap") return;
    if (m.p2_ready || botDoneTimer.current) return; // already done / already queued
    botDoneTimer.current = setTimeout(() => {
      botDoneTimer.current = null;
      botDoneCb.current();
    }, 2000);
    return () => {
      if (botDoneTimer.current) { clearTimeout(botDoneTimer.current); botDoneTimer.current = null; }
    };
  }, [m?.is_bot, m?.p1_ready, m?.phase, m?.p2_ready]);

  // Opponent's YourScore leaderboard position (real opponents only; read-only, never blocks the match).
  const oppId = m && side && !m.is_bot ? (side === "p1" ? m.p2_id : m.p1_id) : null;
  const [oppPos, setOppPos] = useState<number | null>(null);
  useEffect(() => {
    setOppPos(null);
    if (!oppId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    let cancelled = false;
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any;
      const { data } = await sb.rpc("get_yourscore_rank", { p_user_id: oppId });
      if (!cancelled) setOppPos(data?.[0]?.overall_rank ?? null);
    });
    return () => { cancelled = true; };
  }, [oppId]);

  if (loading) return <Centered>Loading match…</Centered>;
  if (error) return <Centered tone="error">{error} <Link href="/38-0/live" className="underline block mt-3">← Back</Link></Centered>;
  if (!m || !view) return <Centered tone="error">Not part of this match. <Link href="/38-0/live" className="underline">← Back</Link></Centered>;

  const sim = (m.sim ?? null) as MatchSim | null;

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: BG, color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-4 pt-8">
        {/* Scoreline header */}
        <Header view={view} phase={m.phase} secondsLeft={secondsLeft} opponentOnline={opponentOnline} oppPos={oppPos} />

        {/* What to do now + the rule — fills the space under the scoreline */}
        <Guide phase={m.phase} view={view} />

        {/* Phase body */}
        {m.phase === "lobby" && (
          <Panel>
            <p className="text-center" style={{ color: "#9aa39d" }}>
              {m.p2_id || m.is_bot ? `${view.oppName} is here.` : "Waiting for your opponent to join…"}
            </p>
            {(m.p2_id || m.is_bot) && (
              <Action onClick={live.ready} disabled={view.myReady}>
                {view.myReady ? (secondsLeft != null ? `Ready ✓ — waiting for ${view.oppName}…` : "Ready ✓ — waiting…") : "I'm ready"}
              </Action>
            )}
            <Link href="/38-0/live" className="block text-center mt-3 text-sm underline" style={{ color: "#8a948f" }}>Leave</Link>
          </Panel>
        )}

        {m.phase === "reveal" && (
          <TwoXI view={view} caption="Opponents revealed — size up both XIs" countdown={secondsLeft} />
        )}

        {m.phase === "pregame_swap" && (
          <Panel>
            <p className="text-center text-sm" style={{ color: "#9aa39d" }}>
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
                <p className="font-body text-sm mt-2" style={{ color: "#9aa39d" }}>
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
                  <div className="text-xs mb-1" style={{ color: "#8a948f", letterSpacing: 1 }}>BOTH SQUADS</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Pitch formation={view.myFormation} squad={view.mySquad} compact />
                    <Pitch formation={view.oppFormation} squad={view.oppSquad} compact />
                  </div>
                </div>
              </Panel>
            )}
            <Panel>
              <p className="text-center text-sm" style={{ color: "#9aa39d" }}>
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
                <p className="text-center font-display tracking-wide" style={{ fontSize: 26, color: "#aeea00" }}>
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
          // Retired phase (legacy in-flight rows pass straight through on the next tick).
          <Panel>
            <p className="text-center font-display" style={{ fontSize: 24, color: "#ffb800" }}>Level after 90!</p>
            <p className="text-center mt-1 text-sm" style={{ color: "#9aa39d" }}>Straight to penalties…</p>
          </Panel>
        )}

        {(m.phase === "penalties" || (m.phase === "result" && pensHold)) && (() => {
          const r = m as DraftLiveMatchRow & { p1_kicks?: PenKick[] | null; p2_kicks?: PenKick[] | null };
          const a = r.p1_kicks ?? [];
          const b = r.p2_kicks ?? [];
          // Legacy rows auto-resolved before the rework carry a score but no kicks.
          if (m.pens_p1 !== null && a.length === 0) {
            return (
              <Panel>
                <p className="text-center font-display" style={{ fontSize: 24, color: "#ffb800" }}>Penalties</p>
                <p className="text-center mt-2" style={{ fontSize: 40, fontWeight: 700 }}>{view.pens[0]} – {view.pens[1]}</p>
              </Panel>
            );
          }
          const mySide = view.meP1 ? "a" : "b";
          const st = shootoutStatus(a, b, "simultaneous");
          const decided = m.phase === "result" || m.pens_p1 !== null || st.decided;
          const myKicks = view.meP1 ? a : b;
          const winnerSide =
            m.pens_p1 !== null && m.pens_p2 !== null ? (m.pens_p1 > m.pens_p2 ? "a" : "b") : st.winner;
          const pview: PensView = {
            myKicks,
            oppKicks: view.meP1 ? b : a,
            suddenDeath: st.suddenDeath,
            role: decided ? "done" : kickAllowed(a, b, mySide, "simultaneous") ? "shoot" : "waiting",
            result: decided && winnerSide ? (winnerSide === mySide ? "win" : "loss") : null,
          };
          return (
            <Panel>
              <PenaltyShootout
                view={pview}
                myName={view.myName}
                oppName={view.oppName}
                simultaneous
                secondsLeft={m.phase === "penalties" ? secondsLeft : null}
                onShoot={(z, p) => live.kick(myKicks.length + 1, z, p)}
                onDive={() => {}}
              />
            </Panel>
          );
        })()}

        {m.phase === "result" && !pensHold && <ResultPanel view={view} sim={sim} m={m} />}
        {m.phase === "abandoned" && (
          <Panel>
            <p className="text-center text-2xl mb-3">⏰</p>
            <p className="font-display text-center text-white text-lg mb-2">Match Abandoned</p>
            <p className="font-body text-center text-sm mb-4" style={{ color: "#9aa39d" }}>
              {view.myReady
                ? `${view.oppName} didn't show up in time.`
                : "The match timed out before it could start."}
            </p>
            <Link href="/38-0/live" className="block text-center font-body text-sm" style={{ color: "#aeea00" }}>
              Play again →
            </Link>
          </Panel>
        )}
      </div>

      {spinSlot && (
        <SpinSheet
          formation={view.myFormation} squad={view.mySquad} slotId={spinSlot}
          seedKey={`${m.id}:${side}:${m.phase}:${spinSlot}`}
          competition={asCompetition(side === "p1" ? m.p1_competition : m.p2_competition)}
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

function Header({ view, phase, secondsLeft, opponentOnline, oppPos }: { view: View; phase: string; secondsLeft: number | null; opponentOnline: boolean; oppPos?: number | null }) {
  // While a half is playing the server already holds the final half score, so the
  // header must NOT show it — that would spoil the live playback. The running score
  // lives in <MatchPitch>; half-time/result legitimately show the score.
  const showScore = ["halftime_swap", "draw_decision", "penalties", "result"].includes(phase);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <BackPill href="/38-0/live" label="Live" tone="draft" />
        {secondsLeft != null
          ? <span className="font-mono rounded-full px-2.5 py-1" style={{ fontSize: 14, fontWeight: 700, color: secondsLeft <= 5 ? "#ff7a88" : "#ffb800", background: secondsLeft <= 5 ? "rgba(255,71,87,0.14)" : "rgba(255,184,0,0.12)" }}>⏱ {secondsLeft}s</span>
          : phase === "lobby" && <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "#9aa39d" }}><span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#ffb800" }} />waiting</span>}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Team name={view.myName} str={view.myStr} you online />
        <div className="text-center px-3">
          {showScore
            ? <div className="font-display" style={{ fontSize: 38, fontWeight: 800 }}>{view.myGoals} <span style={{ color: "#555" }}>–</span> {view.oppGoals}</div>
            : <div style={{ color: "#555", fontSize: 22 }}>vs</div>}
        </div>
        <Team name={view.oppName} str={view.oppStr} online={opponentOnline} alignRight pos={oppPos} />
      </div>
    </div>
  );
}

function Team({ name, str, you, online, alignRight, pos }: { name: string; str: number; you?: boolean; online?: boolean; alignRight?: boolean; pos?: number | null }) {
  return (
    <div className={alignRight ? "text-right" : ""} style={{ maxWidth: 130 }}>
      <div className="font-semibold truncate" style={{ color: you ? "#aeea00" : "#e8e8f0" }}>{name}</div>
      <div className="text-xs" style={{ color: "#9aa39d" }}>STR {str.toFixed(1)}{online != null && <span style={{ color: online ? "#aeea00" : "#555" }}> ●</span>}</div>
      {pos != null && <div className="text-[10px] font-semibold mt-0.5" style={{ color: positionColor(pos) }}>🏅 #{pos.toLocaleString()}</div>}
    </div>
  );
}

function TwoXI({ view, caption, countdown }: { view: View; caption: string; countdown?: number | null }) {
  return (
    <Panel>
      <p className="text-center text-sm" style={{ color: "#9aa39d" }}>{caption}</p>
      {countdown != null && (
        <p className="text-center font-display tracking-wide mt-1" style={{ fontSize: 30, lineHeight: 1.1, color: countdown <= 5 ? "#ff7a88" : "#aeea00" }}>
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
  const color = drew ? "#ffb800" : won ? "#aeea00" : "#ff7a88";
  // Share state
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [giveawayOpen, setGiveawayOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const giveawayShown = useRef(false);

  // Auto-assigned team prompt
  const [isAutoTeam, setIsAutoTeam] = useState(false);
  useEffect(() => { setIsAutoTeam(loadTeam()?.autoAssigned === true); }, []);

  function keepTeam() {
    const t = loadTeam(); if (t) saveTeam({ ...t, autoAssigned: undefined }); setIsAutoTeam(false);
  }
  function buildOwn() {
    const t = loadTeam(); if (t) saveTeam({ ...t, autoAssigned: undefined }); clearTeam(); router.push("/38-0");
  }

  const oppId = view.meP1 ? m.p2_id : m.p1_id;

  // ── Short URL ────────────────────────────────────────────────────────────────

  const fallbackUrl = typeof window !== "undefined" ? `${location.origin}/38-0/match/${m.id}` : `https://yourscore.app/38-0/match/${m.id}`;

  async function ensureShortUrl(): Promise<string> {
    if (shortUrl) return shortUrl;
    try {
      const res = await fetch("/api/draft/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { matchId: m.id } }),
      });
      if (res.ok) {
        const { id } = await res.json();
        if (id) { const u = `${window.location.origin}/s/${id}`; setShortUrl(u); return u; }
      }
    } catch { /* keep fallback */ }
    return fallbackUrl;
  }

  // Auto-mint the share URL when the result first renders. The giveaway sheet no
  // longer auto-opens over the scorecard — the WIN £25 card opens it on tap.
  useEffect(() => {
    if (giveawayShown.current) return;
    giveawayShown.current = true;
    void ensureShortUrl();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Share copy ───────────────────────────────────────────────────────────────

  // Include the shootout in the score so a pens-decided game doesn't read as a draw
  // (e.g. "I beat X 0–0" → "I beat X 0–0 (7-6 pens)").
  const score = view.pens[0] != null
    ? `${view.myGoals}–${view.oppGoals} (${view.pens[0]}-${view.pens[1]} pens)`
    : `${view.myGoals}–${view.oppGoals}`;

  function blurb(): string {
    if (drew) return `${view.myName} vs ${view.oppName} ${score} on @yourscore_app_ 38-0 Live ⚽`;
    if (won)  return `I beat ${view.oppName} ${score} on @yourscore_app_ 38-0 Live ⚽`;
    return `${view.oppName} beat me ${score} on @yourscore_app_ 38-0 Live ⚽`;
  }

  function giveawayTweetText(): string {
    if (drew) return `${view.myName} vs ${view.oppName} ${score} on @yourscore_app_ 38-0 Live ⚽ Entering the daily £25 giveaway`;
    if (won)  return `I beat ${view.oppName} ${score} on @yourscore_app_ 38-0 Live ⚽ Entering the daily £25 giveaway`;
    return `${view.oppName} beat me ${score} on @yourscore_app_ 38-0 Live ⚽ Entering the daily £25 giveaway`;
  }

  function giveawayTweetUrl(): string {
    const u = shortUrl ?? fallbackUrl;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(giveawayTweetText())}&url=${encodeURIComponent(u)}`;
  }

  function openShare() { setShareOpen(true); void ensureShortUrl(); }

  async function nativeShare() {
    trackShare("live-match");
    const url = await ensureShortUrl();
    try {
      if (navigator.share) await navigator.share({ title: "38-0 Live result", text: blurb(), url });
      else { await navigator.clipboard.writeText(`${blurb()} ${url}`); }
    } catch { /* user cancelled */ }
  }

  function shareX() {
    const u = shortUrl ?? fallbackUrl;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(blurb())}&url=${encodeURIComponent(u)}`, "_blank", "noopener");
  }

  async function copyLink() {
    trackShare("live-match-copy");
    const url = await ensureShortUrl();
    try { await navigator.clipboard.writeText(`${blurb()} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ }
  }

  const report = sim ? buildReport(sim) : null;
  const meReport = report ? (view.meP1 ? report : flipReport(report)) : null;
  const meData: ScorecardData | null = meReport ? {
    context: "38-0 Live",
    you: { name: view.myName, strength: Math.round(view.myStr), formation: view.myFormation, squad: view.mySquad },
    opp: { name: view.oppName, strength: Math.round(view.oppStr), formation: view.oppFormation, squad: view.oppSquad },
    goals: { you: view.myGoals, opp: view.oppGoals },
    pens: view.pens[0] != null ? { you: view.pens[0]!, opp: view.pens[1]! } : null,
    outcome: drew ? "draw" : won ? "you" : "opp",
    stats: statsFromReport(meReport),
    goalEvents: goalsFromReport(meReport),
    potm: potmFromReport(meReport, view.myName, view.oppName),
  } : null;

  return (
    <>
      {meData ? (
        <div className="mt-6"><ScorecardView data={meData} /></div>
      ) : (
        <Panel>
          <p className="text-center font-display tracking-wide" style={{ fontSize: 34, color }}>{label}</p>
          <p className="text-center mt-1" style={{ fontSize: 40, fontWeight: 800 }}>
            {view.myGoals} – {view.oppGoals}{view.pens[0] != null && <span className="block text-sm" style={{ color: "#9aa39d" }}>pens {view.pens[0]}–{view.pens[1]}</span>}
          </p>
        </Panel>
      )}
      <Panel>
        {/* Auto-assigned team — keep or rebuild */}
        {isAutoTeam && (
          <div className="mt-4 rounded-2xl p-4" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.2)" }}>
            <p className="font-body text-center mb-3" style={{ fontSize: 13, color: "#8a948f" }}>
              We picked a random XI for you. Want to keep it?
            </p>
            <div className="flex gap-2">
              <Button variant="primary" tone="lime" size="sm" fullWidth className="flex-1" onClick={keepTeam}>Keep this XI ✓</Button>
              <Button variant="ghost" size="sm" fullWidth className="flex-1" onClick={buildOwn}>Build my own</Button>
            </div>
          </div>
        )}

        {/* Post-game reward moment — points earned + position on the leaderboard */}
        <div className="mt-4">
          <RankRewardCard />
        </div>

        {/* Friend suggestion — real opponent only */}
        {!m.is_bot && oppId && (
          <div className="mt-4">
            <AddFriendCard userId={oppId} displayName={view.oppName} />
          </div>
        )}

        {/* Giveaway CTA */}
        <button
          onClick={() => setGiveawayOpen(true)}
          className="w-full mt-5 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
          style={{ background: "linear-gradient(135deg, #1c1400, #221900)", border: "2px solid rgba(255,184,0,0.55)" }}
        >
          <div className="flex items-center gap-4 px-5 py-4">
            <div style={{ fontSize: 36, lineHeight: 1 }}>🏆</div>
            <div className="text-left flex-1 min-w-0">
              <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#ffb800" }}>WIN £25 TODAY</div>
              <div className="font-body" style={{ fontSize: 13, color: "#a89060" }}>Share on 𝕏 to enter the daily giveaway →</div>
            </div>
          </div>
        </button>

        <Button variant="primary" tone="lime" size="md" fullWidth className="mt-2" onClick={openShare}>
          📸 SHARE YOUR RESULT
        </Button>

        <Button variant="ghost" size="md" fullWidth className="mt-3" href="/38-0/live">Play again</Button>
        <Link href="/38-0/leaderboard" className="mt-3 block text-center underline text-sm" style={{ color: "#8a948f" }}>View leaderboard</Link>
      </Panel>

      {/* ── Share sheet ── */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShareOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl px-4 pt-3" style={{ background: "#080d0a", borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 16px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.2)" }} />

            <button onClick={nativeShare} className="w-full mt-2 rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#aeea00", color: "#062013", fontSize: 20 }}>
              🔗 Share link
            </button>

            <div className="grid grid-cols-3 gap-2 mt-2">
              <button onClick={shareX} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#15211a", color: "#fff", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>𝕏</button>
              <button onClick={() => { setShareOpen(false); void nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "rgba(225,48,108,0.12)", color: "#e1306c", fontSize: 15, border: "1px solid rgba(225,48,108,0.3)" }}>Instagram</button>
              <button onClick={() => { setShareOpen(false); void nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#15211a", color: "#c4ccc6", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>TikTok</button>
            </div>

            <button onClick={copyLink} className="w-full mt-2 flex items-center gap-3 px-4 py-3 rounded-2xl transition-all" style={{ background: copied ? "rgba(174,234,0,0.1)" : "rgba(255,255,255,0.06)", border: `1px solid ${copied ? "rgba(174,234,0,0.3)" : "rgba(255,255,255,0.1)"}` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={copied ? "#aeea00" : "#9aa39d"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={copied ? "#aeea00" : "#9aa39d"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="font-body text-sm font-semibold" style={{ color: copied ? "#aeea00" : "#9aa39d" }}>{copied ? "Copied!" : "Copy link"}</span>
            </button>

            <button onClick={() => setShareOpen(false)} className="w-full mt-2 rounded-2xl py-3 font-body active:scale-[0.98] transition-transform" style={{ background: "transparent", color: "#8a948f", fontSize: 15 }}>Close</button>
          </div>
        </div>
      )}

      {/* ── Giveaway overlay ── */}
      {giveawayOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.9)" }} onClick={() => setGiveawayOpen(false)}>
          <div className="w-full max-w-lg px-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="rounded-3xl overflow-hidden" style={{ background: "#080d0a", border: "2px solid rgba(255,184,0,0.4)" }}>
              <div className="flex justify-center pt-3 pb-1">
                <div className="rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.18)" }} />
              </div>
              <div className="px-6 pt-4 pb-7 text-center">
                <div style={{ fontSize: 52, lineHeight: 1.1 }}>🏆</div>
                <div className="font-body mt-3" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 3 }}>DAILY GIVEAWAY</div>
                <div className="font-display tracking-wide leading-none mt-1" style={{ fontSize: 80, color: "#fff" }}>£25</div>
                <p className="font-body mt-3" style={{ fontSize: 15, color: "#c4ccc6", lineHeight: 1.6 }}>
                  Share your result on 𝕏 to enter.<br />
                  <span style={{ color: "#8a948f", fontSize: 13 }}>One winner drawn every 24 hours.</span>
                </p>
                <a href={giveawayTweetUrl()} target="_blank" rel="noopener noreferrer" onClick={() => setGiveawayOpen(false)}
                  className="flex items-center justify-center gap-3 w-full rounded-2xl py-4 mt-6 font-display tracking-wide active:scale-[0.98] transition-transform"
                  style={{ background: "#fff", color: "#000", fontSize: 20, textDecoration: "none", display: "flex" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="black">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  POST ON 𝕏 TO ENTER
                </a>
                <button onClick={() => setGiveawayOpen(false)} className="w-full mt-3 font-body" style={{ fontSize: 14, color: "#586058", background: "transparent", border: "none", cursor: "pointer" }}>
                  Not now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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
const ratingColor = (r: number): string => (r >= 8 ? "#aeea00" : r >= 7 ? "#c4ccc6" : r >= 6 ? "#ffb800" : "#ff7a88");

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
        <div className="flex items-center px-3 py-1.5 text-xs" style={{ color: "#9aa39d", background: "rgba(255,255,255,0.03)" }}>
          <span className="flex-1 text-left truncate" style={{ color: "#aeea00" }}>{myName}</span>
          <span style={{ width: 90, textAlign: "center" }} />
          <span className="flex-1 text-right truncate">{oppName}</span>
        </div>
        {rows.map(([label, a, b, pct]) => (
          <div key={label} className="flex items-center px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="flex-1 text-left tabular-nums font-bold" style={{ fontSize: 16, color: a >= b ? "#fff" : "#9aa39d" }}>{a}{pct ? "%" : ""}</span>
            <span style={{ width: 90, textAlign: "center", fontSize: 10, letterSpacing: 1, color: "#8a948f" }}>{label.toUpperCase()}</span>
            <span className="flex-1 text-right tabular-nums font-bold" style={{ fontSize: 16, color: b >= a ? "#fff" : "#9aa39d" }}>{b}{pct ? "%" : ""}</span>
          </div>
        ))}
      </div>

      {/* Goal feed */}
      {rv.events.length > 0 && (
        <div className="mt-3">
          <div className="text-xs mb-1" style={{ color: "#8a948f", letterSpacing: 1 }}>GOALS</div>
          <div className="space-y-1">
            {rv.events.map((e, i) => {
              const mine = (e.side === "a") === meP1;
              return (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-mono" style={{ width: 30, color: "#8a948f" }}>{e.minute}&apos;</span>
                  <span style={{ color: mine ? "#aeea00" : "#e8e8f0" }}>⚽ {e.scorerName}</span>
                  {e.assistName && <span className="text-xs truncate" style={{ color: "#9aa39d" }}>↳ {e.assistName}</span>}
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
        <PerfPill label={`${myName} — best`} p={rv.myBest} color="#aeea00" />
        <PerfPill label={`${myName} — worst`} p={rv.myWorst} color="#ff7a88" />
        <PerfPill label={`${oppName} — best`} p={rv.oppBest} color="#c4ccc6" />
        <PerfPill label={`${oppName} — worst`} p={rv.oppWorst} color="#9aa39d" />
      </div>

      {/* Your XI ratings */}
      {rv.myRatings.length > 0 && (
        <div className="mt-3">
          <div className="text-xs mb-1" style={{ color: "#8a948f", letterSpacing: 1 }}>YOUR XI RATINGS</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {[...rv.myRatings].sort((a, b) => b.rating - a.rating).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate" style={{ color: "#c4ccc6" }}><span style={{ color: "#8a948f" }}>{p.pos}</span> {p.name}{p.goals > 0 ? " ⚽".repeat(Math.min(p.goals, 3)) : ""}</span>
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
      <div className="text-xs truncate" style={{ color: "#8a948f" }}>{label}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate" style={{ fontSize: 13 }}>{p.name}</span>
        <span className="tabular-nums font-bold" style={{ color }}>{p.rating.toFixed(1)}</span>
      </div>
    </div>
  );
}

function SpinSheet({ formation, squad, slotId, seedKey, competition, onPick, onClose }: { formation: Formation; squad: PlacedPlayer[]; slotId: string; seedKey: string; competition: Competition; onPick: (playerId: string) => void; onClose: () => void }) {
  const slot = slotsFor(formation).find((s) => s.id === slotId)!;
  const [result, setResult] = useState<{ label: string; players: PlayerSeason[] } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<string | null>(null);
  // Preload the on-demand player pool as soon as the spin sheet opens.
  useEffect(() => { void ensurePool(); }, []);

  // ONE spin per position: seeded by (match, side, phase, slot), so closing and
  // reopening shows the SAME options — no re-rolling until you like it. A league match
  // deals a club-season; a World Cup match lands on one WC 2026 nation and offers it.
  function doSpin() {
    if (!isPoolReady()) { void ensurePool().then(() => doSpin()); return; }
    setSpinning(true); setResult(null);
    const usedIds = new Set(squad.filter((p) => p.slot !== slotId).map((p) => p.player_season_id));
    const usedNames = new Set(squad.filter((p) => p.slot !== slotId).map((p) => playerIdentity(p.name)));
    const buckets = competition === "WC" ? null : allBuckets(competition); // null → World Cup flicker
    let ticks = 0;
    const t = setInterval(() => {
      if (buckets) { const b = buckets[Math.floor(Math.random() * buckets.length)]; setReel(`${b.club} ${b.season}`); }
      else setReel("scouting the world…"); // cosmetic flicker only
      if (++ticks > 11) {
        clearInterval(t);
        if (competition === "WC") {
          const r = spinWorld([slot.pos], usedIds, usedNames, {}, seededRng(seedKey)); // seeded → fixed
          setReel(r.nation); setResult({ label: r.nation, players: r.players });
        } else {
          const r = spin([slot.pos], usedIds, usedNames, seededRng(seedKey), new Set(), competition); // seeded → fixed
          setReel(`${r.club} ${r.season}`); setResult({ label: `${r.club} · ${r.season}`, players: r.players });
        }
        setSpinning(false);
      }
    }, 70);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Change {slot.pos}</h3>
          <button onClick={onClose} style={{ color: "#8a948f" }}>Cancel</button>
        </div>

        {!result && (
          <>
            <button onClick={doSpin} disabled={spinning} className="mt-5 w-full rounded-2xl py-4 font-semibold" style={{ background: "#ffb800", color: "#1a1300", opacity: spinning ? 0.7 : 1 }}>
              {spinning ? `${reel ?? ""}…` : "Spin"}
            </button>
            <p className="mt-2 text-center text-xs" style={{ color: "#8a948f" }}>One spin per position — pick from what you&apos;re dealt, or keep your player.</p>
          </>
        )}

        {result && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide" style={{ color: "#8a948f" }}>{result.label} — pick one or cancel to keep your player</p>
            <div className="mt-2 space-y-2 max-h-[40vh] overflow-y-auto">
              {result.players.map((p: PlayerSeason) => (
                <button key={p.id} onClick={() => onPick(p.id)} className="w-full flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <span><span className="font-semibold">{p.name}</span> <span className="text-xs" style={{ color: "#9aa39d" }}>{p.position}</span></span>
                  <span className="font-bold" style={{ color: "#aeea00" }}>{p.overall}</span>
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
  draw_decision: { tag: "FULL TIME · LEVEL", text: () => "Level after 90 — straight to penalties." },
  penalties:     { tag: "PENALTIES",         text: (v) => `Level after 90 — you take your own kicks. You and ${v.oppName} shoot at the same time: pick your corners, best of 5, sudden death if it stays level.` },
};

function Guide({ phase, view }: { phase: string; view: View }) {
  const g = PHASE_GUIDE[phase];
  if (!g) return null;
  return (
    <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.18)" }}>
      <div className="font-display tracking-wide" style={{ fontSize: 11, letterSpacing: 1, color: "#aeea00" }}>{g.tag}</div>
      <div className="mt-1" style={{ fontSize: 13.5, color: "#c4ccc6", lineHeight: 1.4 }}>{g.text(view)}</div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>{children}</div>;
}
function Action({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="mt-4 w-full rounded-2xl py-4 font-semibold" style={{ background: disabled ? "rgba(255,255,255,0.06)" : "#aeea00", color: disabled ? "#9aa39d" : "#04130a" }}>{children}</button>;
}
function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: BG, color: tone === "error" ? "#ff7a88" : "#9aa39d" }}><div>{children}</div></div>;
}
