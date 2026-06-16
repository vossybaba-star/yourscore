"use client";

/**
 * /38-0/wc/run/[id] — World Cup Run: Road to the Final.
 *
 * Group and R32+R16 are resolved as one fast simulation each. QF / SF / Final are
 * duels: the opponent's XI is revealed so you can make changes, then play. Upgrades
 * are spent by tapping a player on your pitch.
 *
 * Drawn knockout ties (and the qualification play-off) are the PLAYER'S CHOICE: take
 * an interactive penalty shootout, or answer one more World Cup question (25s) to go
 * through. Both are server-graded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spinForNation, spinWorld } from "@/lib/draft/pool";
import { drawQuestion, type ServedQuestion } from "@/lib/draft/wc-quiz";
import { upgradeBand, type DraftBand } from "@/lib/draft/draft-quiz";
import { slotsFor } from "@/lib/draft/formations";
import { CATEGORY_COLOR, posCategory } from "@/lib/draft/score";
import { RUN_STAGE_LABEL, isDuel, type RunStage, type RunMode } from "@/lib/draft/wc";
import { wcNation } from "@/data/draft/wc2026";
import type { Formation, PlacedPlayer, PlayerSeason } from "@/lib/draft/types";
import { trackGameComplete } from "@/lib/analytics/trackGame";
import { useUser } from "@/hooks/useUser";
import { PenaltyShootout, type PensView } from "@/components/draft/PenaltyShootout";
import type { PenKick } from "@/lib/draft/pens";

type Fixture = { stage: string; label: string; opponent: { nation: string; crest?: string } };
type Run = {
  id: string; mode: RunMode; nation: string; status: "active" | "eliminated" | "champion";
  stage: RunStage; stage_index: number; formation: Formation; squad: PlacedPlayer[];
  strength: number; plan: { group: Fixture[]; knockouts: Fixture[] };
  group_points: number; upgrades_left: number; ranked?: boolean;
};
// The signed-in player's season standing (from the WC daily board) — shown on a ranked finish.
type Standing = { rank: number; points: number; wins: number; draws: number; losses: number };
type MatchRow = { stage: string; idx: number; you_goals: number; opp_goals: number; pens_you: number | null; pens_opp: number | null; won: boolean | null };
type Opponent = { nation: string; crest?: string; label: string; formation: Formation; squad: PlacedPlayer[]; strength: number };
type GameReveal = { label: string; opponent: { nation: string; crest?: string }; goals: { you: number; opp: number }; pens: { you: number; opp: number } | null; outcome: "win" | "loss" | "draw"; decidedByQuestion?: boolean };
type PlayResp = { stage: RunStage; games: GameReveal[]; result: "through" | "eliminated" | "champion"; run: Run };

// A drawn knockout / the play-off the player must settle — penalties or one question.
// The question carries no correct index; the server grades the answer.
type PendingTie = { idx: number; stage: string; label: string; opponent: { nation: string; crest?: string }; oppStrength: number; goals: { you: number; opp: number }; question: { id: string; prompt: string; options: string[]; category: string }; isPlayoff: boolean };
type PlayOrTie = PlayResp | { awaitingTie: true; stage: RunStage; tie: PendingTie; run: Run };

type WcPensViewT = {
  myKicks: PenKick[]; oppKicks: PenKick[];
  role: "shoot" | "dive" | "done"; suddenDeath: boolean;
  final: { outcome: "you" | "opp"; pens: { you: number; opp: number } } | null;
};
type PensPending = { label: string; opponent: { nation: string; crest?: string }; goals: { you: number; opp: number }; view: WcPensViewT };

const DECIDER_SECONDS = 25;

export default function WorldCupRun() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [h2hBusy, setH2hBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [reveal, setReveal] = useState<PlayResp | null>(null);
  const [pens, setPens] = useState<PensPending | null>(null);
  // Set when the deciding kick lands: either the finished stage payload, or the NEXT
  // tie's choice (the 2-game knockout round can pend twice in one stage).
  const [pensDone, setPensDone] = useState<{ stage?: PlayResp; nextTie?: PendingTie } | null>(null);
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  const [slate, setSlate] = useState<PlayerSeason[] | null>(null);
  const [spunNation, setSpunNation] = useState<{ nation: string; crest?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Quiz-gated upgrades: tap a slot, answer a WC question. CORRECT → re-spin that slot with
  // a modest improvement on the current player; WRONG → no re-spin and the pick is forfeited.
  const [quiz, setQuiz] = useState<ServedQuestion | null>(null);
  const [answered, setAnswered] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);
  const askedIds = useRef<Set<string>>(new Set());

  // Tie decider: a drawn knockout / the play-off. `tieMode` is "choose" (pens vs question)
  // then "quiz" if the player picks the question; picking pens opens the shootout instead.
  const [tie, setTie] = useState<PendingTie | null>(null);
  const [tieMode, setTieMode] = useState<"choose" | "quiz" | null>(null);
  const [decPicked, setDecPicked] = useState<number | null>(null);
  const [decTimeLeft, setDecTimeLeft] = useState(DECIDER_SECONDS);
  const [decBusy, setDecBusy] = useState(false);

  const { user } = useUser();
  // On a finished RANKED run, the player's season standing for the positive scorecard.
  const [standing, setStanding] = useState<Standing | null>(null);

  const openTie = useCallback((t: PendingTie) => {
    setTie(t); setTieMode("choose"); setDecPicked(null); setDecTimeLeft(DECIDER_SECONDS); setDecBusy(false);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/draft/wc/${id}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Run not found"); setLoading(false); return; }
    setRun({ ...data.run, ranked: data.ranked === true }); setMatches(data.matches); setOpponent(data.opponent); setLoading(false);
    // A tie in progress resumes exactly where it was left: mid-shootout, or at the choice.
    if (data.pensPending) { setPens(data.pensPending); setPensDone(null); }
    else if (data.pendingTie) openTie(data.pendingTie);
  }, [id, openTie]);

  useEffect(() => { load(); }, [load]);

  // When a ranked run finishes, pull the player's season standing from the WC daily board
  // for the (positive) scorecard. Fails soft — the banner just omits the rank line.
  useEffect(() => {
    if (!run || run.status === "active" || !run.ranked || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/draft/wc/leaderboard");
        const data = await res.json();
        const me = (data.rows ?? []).find((r: { user_id: string }) => r.user_id === user.id);
        if (!cancelled && me) setStanding({ rank: me.rank, points: me.points, wins: me.wins, draws: me.draws, losses: me.losses });
      } catch { /* banner omits the rank line */ }
    })();
    return () => { cancelled = true; };
  }, [run, user]);

  // 25s clock on the decider QUESTION (not the choice); running out locks a timeout (out).
  useEffect(() => {
    if (!tie || tieMode !== "quiz" || decPicked !== null || decBusy) return;
    if (decTimeLeft <= 0) { answerDecider(-1); return; }
    const t = setTimeout(() => setDecTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tie, tieMode, decPicked, decTimeLeft, decBusy]);

  function applyPlayResp(r: PlayResp) {
    setReveal(r);
    if (r.result === "champion" || r.result === "eliminated") {
      trackGameComplete("38-0", { mode: "world_cup_run", result: r.result });
    }
  }

  async function play() {
    if (playing) return;
    setPlaying(true); setError(null); setPickSlot(null); setSlate(null);
    try {
      const res = await fetch("/api/draft/wc/play", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id }) });
      const data = await res.json() as PlayOrTie & { error?: string; pensPending?: PensPending };
      if (!res.ok) { setError(data.error ?? "Could not play"); setPlaying(false); return; }
      // A shootout was already in progress (resumed) — open it.
      if ("pensPending" in data && data.pensPending) { setPens(data.pensPending); setPensDone(null); setPlaying(false); return; }
      // A level knockout game / the play-off — let the player choose how to settle it.
      if ("awaitingTie" in data && data.awaitingTie) { openTie(data.tie); setPlaying(false); return; }
      applyPlayResp(data as PlayResp);
    } catch { setError("Network error — try again."); }
    setPlaying(false);
  }

  // The player chose PENALTIES — arm the shootout, then drop into the kick UI.
  async function choosePens() {
    if (!tie || decBusy) return;
    setDecBusy(true);
    try {
      const res = await fetch("/api/draft/wc/pens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not start the shootout"); setDecBusy(false); return; }
      setTie(null); setTieMode(null); setDecBusy(false);
      if (data.pensPending) { setPens(data.pensPending); setPensDone(null); }
    } catch { setError("Network error — try again."); setDecBusy(false); }
  }

  // The player chose the QUESTION — submit the answer; the server grades it and either
  // resolves the stage or pends the next tie's choice. The client never sees the answer.
  function answerDecider(choice: number) {
    if (!tie || tieMode !== "quiz" || decPicked !== null || decBusy) return;
    setDecPicked(choice);
    setTimeout(() => void submitDecider(choice), 800);
  }

  async function submitDecider(choice: number) {
    setDecBusy(true);
    try {
      const res = await fetch("/api/draft/wc/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id, answer: choice }) });
      const data = await res.json() as PlayOrTie & { error?: string };
      if (!res.ok) { setError(data.error ?? "Could not settle the tie"); setTie(null); setTieMode(null); setDecBusy(false); return; }
      if ("awaitingTie" in data && data.awaitingTie) { openTie(data.tie); return; } // next tie (rare)
      setTie(null); setTieMode(null); setDecBusy(false);
      applyPlayResp(data as PlayResp);
    } catch { setError("Network error — try again."); setDecBusy(false); }
  }

  async function pensAct(action: "shot" | "dive", zone: number, power?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/draft/wc/kick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id, action, zone, power }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Kick failed"); setBusy(false); return; }
      if (data.pensPending) setPens(data.pensPending);
      if (data.stage || data.nextTie) setPensDone({ stage: data.stage, nextTie: data.nextTie });
      if (data.stage && (data.stage.result === "champion" || data.stage.result === "eliminated")) {
        trackGameComplete("38-0", { mode: "world_cup_run", result: data.stage.result });
      }
    } catch { setError("Network error — try again."); }
    setBusy(false);
  }

  function pensContinue() {
    if (pensDone?.stage) {
      setPens(null); setPensDone(null);
      setReveal(pensDone.stage);
    } else if (pensDone?.nextTie) {
      // The next knockout game is also level — choose again.
      setPens(null);
      openTie(pensDone.nextTie);
      setPensDone(null);
    } else {
      setPens(null); setPensDone(null);
      load();
    }
  }

  // Save this exact XI as the active World Cup team and drop into the WC H2H lane.
  async function playH2H() {
    if (!run || h2hBusy) return;
    setH2hBusy(true); setError(null);
    try {
      const res = await fetch("/api/draft/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competition: "WC",
          formation: run.formation,
          squad: run.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Couldn't ready your squad for H2H"); setH2hBusy(false); return; }
      router.push("/38-0/wc/h2h");
    } catch { setError("Network error — try again."); setH2hBusy(false); }
  }

  // Tap a slot → answer a quiz question, then re-spin it at the quality that grade earns.
  function scoutSlot(slotId: string) {
    if (!run || run.upgrades_left <= 0 || quiz) return;
    setPickSlot(slotId); setSpunNation(null); setSlate(null); setFeedback(null);
    const q = drawQuestion(Math.random, askedIds.current);
    if (!q) { spinSlot(slotId, { minOverall: 0, maxOverall: 99 }); return; }
    setQuiz(q); setAnswered(null);
  }

  function answerQuiz(idx: number) {
    if (!quiz || answered !== null || !pickSlot || !run) return;
    setAnswered(idx);
    const correct = idx === quiz.correctIndex;
    askedIds.current.add(quiz.id);
    setFeedback({ correct });
    const slotId = pickSlot;
    if (correct) {
      // Re-spin with a modest improvement on the player currently in this slot.
      const cur = run.squad.find((p) => p.slot === slotId)?.overall ?? 0;
      setTimeout(() => { setQuiz(null); setAnswered(null); spinSlot(slotId, upgradeBand(cur)); }, 900);
    } else {
      // No re-spin — the upgrade pick is forfeited (server burns it so it can't be retried).
      setTimeout(() => { setQuiz(null); setAnswered(null); setPickSlot(null); void forfeitUpgrade(); }, 1100);
    }
  }

  async function forfeitUpgrade() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/draft/wc/upgrade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id, forfeit: true }) });
      await load();
    } catch { /* non-fatal — upgrades_left refreshes on the next load */ }
    setBusy(false);
  }

  function spinSlot(slotId: string, band: DraftBand) {
    if (!run) return;
    const slot = slotsFor(run.formation).find((s) => s.id === slotId)!;
    const usedIds = new Set(run.squad.map((p) => p.player_season_id));
    const usedNames = new Set(run.squad.map((p) => p.name));
    if (run.mode === "world") {
      const sp = spinWorld([slot.pos], usedIds, usedNames, { count: 6, minOverall: band.minOverall, maxOverall: band.maxOverall });
      setSpunNation({ nation: sp.nation, crest: sp.crest });
      setSlate(sp.players);
    } else {
      setSlate(spinForNation(run.nation, [slot.pos], usedIds, usedNames, { count: 6, minOverall: band.minOverall, maxOverall: band.maxOverall }));
    }
  }

  async function applyUpgrade(newPlayerId: string) {
    if (!run || !pickSlot || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/draft/wc/upgrade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id, slotId: pickSlot, newPlayerId }) });
      const data = await res.json();
      if (res.ok) { setPickSlot(null); setSlate(null); setSpunNation(null); await load(); }
      else setError(data.error ?? "Upgrade failed");
    } catch { setError("Network error."); }
    setBusy(false);
  }

  const world = run?.mode === "world";
  const crest = useMemo(() => (run && !world ? wcNation(run.nation)?.crest : null), [run, world]);

  // Compact run path for the scorecard: "Label~Detail~R" rows (R = W|L|Q).
  const scorecardUrl = useMemo(() => {
    if (!run) return "";
    const rows: string[] = [];
    const grp = matches.filter((m) => m.stage === "group");
    if (grp.length) {
      const pts = grp.reduce((s, m) => s + (m.won === true ? 3 : m.won === null ? 1 : 0), 0);
      rows.push(`Group~${pts} pts~${pts >= 4 ? "Q" : "L"}`);
    }
    matches.filter((m) => m.stage === "ko").sort((a, b) => a.idx - b.idx)
      .forEach((m, i) => rows.push(`${i === 0 ? "R32" : "R16"}~${m.you_goals}-${m.opp_goals}~${m.won ? "W" : "L"}`));
    ([["qf", "QF"], ["sf", "SF"], ["final", "Final"]] as const).forEach(([s, lbl]) => {
      const m = matches.find((x) => x.stage === s);
      if (m) rows.push(`${lbl}~${m.you_goals}-${m.opp_goals}${m.pens_you != null ? ` p${m.pens_you}-${m.pens_opp}` : ""}~${m.won ? "W" : "L"}`);
    });
    const p = new URLSearchParams({ nation: run.nation, status: run.status, stage: run.stage, path: rows.join("|") });
    if (crest) p.set("crest", crest);
    if (world) p.set("world", "1");
    return `/api/draft/wc-og?${p}`;
  }, [run, matches, crest, world]);

  function shareRun() {
    if (!run) return;
    const who = world ? "a World XI" : run.nation;
    const text = run.status === "champion"
      ? `I won the World Cup with ${who} on YourScore! 🏆`
      : `My ${world ? "World XI" : run.nation} World Cup run ended at the ${RUN_STAGE_LABEL[run.stage]}. Beat that 👇`;
    const url = `${window.location.origin}/38-0/wc`;
    if (navigator.share) navigator.share({ title: "YourScore — World Cup Run", text, url }).catch(() => {});
    else { navigator.clipboard?.writeText(`${text} ${url}`); window.open(`${window.location.origin}${scorecardUrl}`, "_blank"); }
  }

  if (loading) return <Screen><div style={{ color: "#8a948f" }}>Loading…</div></Screen>;
  if (error && !run) return <Screen><div style={{ color: "#ff8a3d" }}>{error}</div></Screen>;
  if (!run) return null;

  const terminal = run.status !== "active";
  const ko = run.plan.knockouts;
  // Result lookup: match rows are keyed by RUN stage + game index.
  const res = (stage: string, idx = 0) => matches.find((m) => m.stage === stage && m.idx === idx);
  const duel = isDuel(run.stage);
  const canUpgrade = !terminal && run.upgrades_left > 0;
  const playLabel = run.stage === "group" ? "PLAY YOUR DRAFT"
    : run.stage === "ko" ? "PLAY R32 & R16"
    : run.stage === "playoff" ? "PLAY THE QUALIFICATION PLAY-OFF"
    : `PLAY THE ${RUN_STAGE_LABEL[run.stage].toUpperCase()}`;

  return (
    <div className="min-h-[100dvh] pb-40" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4"><Link href="/38-0" className="font-body text-sm" style={{ color: "#8a948f" }}>← Exit</Link></div>

        {/* Header */}
        <div className="flex items-center gap-3 pt-2">
          {crest ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={crest} alt={run.nation} width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain" }} />
          ) : world ? (
            <span style={{ fontSize: 42, lineHeight: 1 }}>🌍</span>
          ) : null}
          <div className="flex-1">
            <div className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>{run.nation}</div>
            <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>
              {run.status === "champion" ? "🏆 World Champions" : run.status === "eliminated" ? "Eliminated" : RUN_STAGE_LABEL[run.stage]}
            </div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 10, color: "#8a948f", letterSpacing: 1 }}>OVERALL</div>
            <div className="font-display" style={{ fontSize: 32, lineHeight: 1, color: "#aeea00" }}>{run.strength}</div>
          </div>
        </div>

        {/* Terminal banners */}
        {/* RANKED: always a positive finish — your result + where you stand + come back tomorrow. */}
        {run.ranked && terminal && (() => {
          const champ = run.status === "champion";
          return (
            <div className="mt-4 rounded-2xl p-5 text-center" style={{ background: champ ? "linear-gradient(135deg,#1a1407,#2a2007)" : "linear-gradient(135deg,#07140d,#0c1a12)", border: `1px solid ${champ ? "rgba(255,184,0,0.55)" : "rgba(174,234,0,0.45)"}` }}>
              <div style={{ fontSize: 44 }}>{champ ? "🏆" : "⚽"}</div>
              <div className="font-display tracking-wide" style={{ fontSize: 26, color: champ ? "#ffb800" : "#aeea00" }}>{champ ? "WORLD CHAMPIONS!" : "GREAT RUN!"}</div>
              <div className="font-body mt-1" style={{ fontSize: 14, color: "#cdd6cf" }}>
                {champ ? `You went all the way with ${run.nation}.` : `You reached the ${RUN_STAGE_LABEL[run.stage]} with ${run.nation}${run.stage === "group" ? ` (${run.group_points} pts)` : ""}.`}
              </div>
              {standing && (
                <div className="mt-3 rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>YOUR WORLD CUP TABLE</div>
                  <div className="font-display tracking-wide mt-0.5" style={{ fontSize: 22, color: "#fff" }}>#{standing.rank} · {standing.points} pts</div>
                  <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>{standing.wins}W · {standing.draws}D · {standing.losses}L this season</div>
                </div>
              )}
              <p className="font-body mt-3" style={{ fontSize: 13, color: "#9fb0a4", lineHeight: 1.45 }}>
                Come back tomorrow for a fresh draft and more points — or keep playing now with Just Play.
              </p>
              <div className="mt-3"><Scorecard url={scorecardUrl} /></div>
              <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                <button onClick={shareRun} className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: champ ? "#ffb800" : "rgba(255,255,255,0.1)", color: champ ? "#0a0a0f" : "#fff", fontSize: 15 }}>SHARE{champ ? " 🏆" : ""}</button>
                <Link href="/38-0/wc/board" className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: "rgba(174,234,0,0.14)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.4)", fontSize: 15 }}>VIEW TABLE</Link>
                <Link href="/38-0/wc?practice=1" className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: "#aeea00", color: "#062013", fontSize: 15 }}>JUST PLAY</Link>
              </div>
            </div>
          );
        })()}
        {!run.ranked && run.status === "champion" && (
          <div className="mt-4 rounded-2xl p-5 text-center" style={{ background: "linear-gradient(135deg,#1a1407,#2a2007)", border: "1px solid rgba(255,184,0,0.5)" }}>
            <div style={{ fontSize: 46 }}>🏆</div>
            <div className="font-display tracking-wide" style={{ fontSize: 28, color: "#ffb800" }}>WORLD CUP WINNERS</div>
            <div className="font-body mt-1 mb-3" style={{ fontSize: 14, color: "#cdb98a" }}>{run.nation} are champions of the world.</div>
            <Scorecard url={scorecardUrl} />
            <div className="flex items-center justify-center gap-2 mt-3">
              <button onClick={shareRun} className="rounded-xl px-5 py-2.5 font-display tracking-wide" style={{ background: "#ffb800", color: "#0a0a0f", fontSize: 16 }}>SHARE 🏆</button>
              <Link href="/38-0/wc" className="rounded-xl px-5 py-2.5 font-display tracking-wide" style={{ background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 16 }}>NEW RUN</Link>
            </div>
          </div>
        )}
        {!run.ranked && run.status === "eliminated" && (
          <div className="mt-4 rounded-2xl p-4 text-center" style={{ background: "#1a0f12", border: "1px solid rgba(255,71,87,0.4)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#ff4757" }}>KNOCKED OUT</div>
            <div className="font-body mt-1" style={{ fontSize: 13, color: "#c98a92" }}>
              Your run ended at the {RUN_STAGE_LABEL[run.stage]}{run.stage === "group" ? ` (${run.group_points} pts)` : ""}.
            </div>
            <div className="mt-3"><Scorecard url={scorecardUrl} /></div>
            <div className="flex items-center justify-center gap-2 mt-3">
              <button onClick={shareRun} className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 15 }}>SHARE</button>
              <Link href="/38-0/wc" className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: "#aeea00", color: "#062013", fontSize: 15 }}>NEW RUN</Link>
            </div>
          </div>
        )}

        {/* Road to the Final */}
        <div className="mt-4 rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="px-3 py-2 font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>ROAD TO THE FINAL</div>
          {run.plan.group.map((f, i) => (
            <Row key={`g${i}`} label={`Group · ${i + 1}/3`} opp={f.opponent.nation} crest={wcNation(f.opponent.nation)?.crest}
              result={res("group", i)} current={run.status === "active" && run.stage === "group"} />
          ))}
          <Divider text={run.stage === "group" ? (run.status === "eliminated" ? "Out at the group stage" : `Need 4 pts to qualify · you have ${run.group_points}`) : "Qualified ✓"} />
          {[ko[0], ko[1]].map((f, j) => f && (
            <Row key={`ko${j}`} label={f.label} opp={f.opponent.nation} crest={wcNation(f.opponent.nation)?.crest}
              result={res("ko", j)} current={run.status === "active" && run.stage === "ko"} locked={!res("ko", j) && run.stage_index < 1} />
          ))}
          {(["qf", "sf", "final"] as const).map((stage, k) => {
            const f = ko[k + 2];
            if (!f) return null;
            const r = res(stage);
            const isCurrent = run.status === "active" && run.stage === stage;
            return <Row key={stage} label={RUN_STAGE_LABEL[stage]} opp={f.opponent.nation} crest={wcNation(f.opponent.nation)?.crest}
              result={r} current={isCurrent} locked={!r && !isCurrent} />;
          })}
        </div>

        {/* Duel: opponent reveal */}
        {!terminal && duel && opponent && (
          <div className="mt-4 rounded-2xl p-3" style={{ background: "#161018", border: "1px solid rgba(255,71,87,0.3)" }}>
            <div className="flex items-center gap-2 mb-2">
              {opponent.crest && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={opponent.crest} alt="" width={26} height={26} style={{ width: 26, height: 26, objectFit: "contain" }} />
              )}
              <span className="font-body" style={{ fontSize: 13, color: "#fff" }}>{opponent.label} opponent — <b style={{ color: "#ff8a3d" }}>{opponent.nation}</b> ({opponent.strength})</span>
            </div>
            <Pitch formation={opponent.formation} squad={opponent.squad} compact />
          </div>
        )}

        {/* Qualification play-off: the authentic "best third-placed" explanation. */}
        {!terminal && run.stage === "playoff" && (
          <div className="mt-4 rounded-2xl p-4" style={{ background: "#1a1300", border: "1px solid rgba(255,184,0,0.45)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 15, color: "#ffb800" }}>IT&apos;S DOWN TO THE WIRE</div>
            <p className="font-body mt-1.5" style={{ fontSize: 13, color: "#e8d6a8", lineHeight: 1.45 }}>
              You finished 3rd in your group on <b style={{ color: "#fff" }}>{run.group_points} points</b> — level with the other nations on the qualification cut-line. In the World Cup the <b style={{ color: "#fff" }}>best third-placed teams</b> go through, so it comes down to one moment: <b style={{ color: "#fff" }}>take a shootout or answer one question</b> to grab the final Round-of-32 spot.
            </p>
          </div>
        )}

        {/* Your XI (tap a player to upgrade when picks are available) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>YOUR XI</span>
            {canUpgrade && <span className="font-body" style={{ fontSize: 12, color: "#aeea00" }}>⚽ Tap a player → answer right to upgrade · {run.upgrades_left} left</span>}
          </div>
          <Pitch formation={run.formation} squad={run.squad} compact onSlotClick={canUpgrade ? scoutSlot : undefined} highlightSlot={pickSlot} />
          {/* Ranked is a committed run — no detour into the H2H lane. Practice can flip across. */}
          {!run.ranked && (
            <>
              <button onClick={playH2H} disabled={h2hBusy}
                className="mt-3 w-full rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform"
                style={{ background: "#ffb800", color: "#1a1300", fontSize: 16, opacity: h2hBusy ? 0.7 : 1 }}>
                {h2hBusy ? "Readying squad…" : "⚔️ Play this XI head-to-head"}
              </button>
              <p className="mt-1.5 text-center font-body" style={{ fontSize: 11, color: "#7a7a92" }}>Take your World Cup squad live vs another manager — own board.</p>
            </>
          )}
        </div>

        {/* Upgrade slate */}
        {pickSlot && slate && (
          <div className="mt-3 rounded-2xl p-3" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.3)" }}>
            <div className="flex items-center justify-between mb-2">
              {world && spunNation ? (
                <span className="flex items-center gap-2">
                  {spunNation.crest && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={spunNation.crest} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />
                  )}
                  <span className="font-display tracking-wide" style={{ fontSize: 15, color: "#ffb800" }}>{spunNation.nation}</span>
                  <span className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>· re-spin</span>
                </span>
              ) : (
                <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>Re-spin — take one of these, or cancel</span>
              )}
              <button onClick={() => { setPickSlot(null); setSlate(null); setSpunNation(null); }} className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>Cancel</button>
            </div>
            <div className="flex flex-col gap-1">
              {slate.map((p) => (
                <button key={p.id} onClick={() => applyUpgrade(p.id)} disabled={busy}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left active:scale-[0.99]" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <span className="flex items-center justify-center rounded font-display" style={{ width: 30, height: 30, fontSize: 15, color: "#0a0a0f", background: CATEGORY_COLOR[posCategory(p.position)] }}>{p.overall}</span>
                  <span className="font-body flex-1 truncate" style={{ fontSize: 13, color: "#fff" }}>{p.name} <span style={{ color: "#8a948f", fontSize: 11 }}>{p.club}</span></span>
                </button>
              ))}
              {slate.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No options for this slot.</span>}
            </div>
          </div>
        )}

        {error && <div className="mt-3 font-body text-center" style={{ fontSize: 13, color: "#ff8a3d" }}>{error}</div>}
      </div>

      {/* Action bar */}
      {!terminal && (
        <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
          <div className="max-w-lg mx-auto px-4 pt-3">
            <button onClick={play} disabled={playing}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: "#aeea00", color: "#062013", fontSize: 22 }}>
              {playing ? "PLAYING…" : `▶ ${playLabel}`}
            </button>
          </div>
        </div>
      )}

      {/* Tie chooser — a level game: penalties or one more question */}
      {tie && tieMode === "choose" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-5" style={{ background: "rgba(0,0,0,0.82)" }}>
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 pb-8" style={{ background: "#13131c", border: "1px solid rgba(255,184,0,0.4)" }}>
            <div className="text-center">
              <div className="font-body" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>
                {tie.isPlayoff ? "QUALIFICATION PLAY-OFF" : `${tie.label.toUpperCase()} · LEVEL AT ${tie.goals.you}–${tie.goals.opp}`}
              </div>
              <div className="font-display tracking-wide mt-1" style={{ fontSize: 22, color: "#fff" }}>HOW DO YOU SETTLE IT?</div>
              <div className="font-body mt-1" style={{ fontSize: 12, color: "#8a948f" }}>{run.nation} v {tie.opponent.nation}{tie.isPlayoff ? "" : " — no winner after 90"}</div>
            </div>
            <div className="flex flex-col gap-2.5 mt-4">
              <button onClick={choosePens} disabled={decBusy}
                className="w-full rounded-2xl px-4 py-3.5 text-left active:scale-[0.99] transition-transform disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#1a1407,#241a05)", border: "1px solid rgba(255,184,0,0.55)" }}>
                <div className="font-display tracking-wide" style={{ fontSize: 17, color: "#ffb800" }}>⚽ PENALTY SHOOTOUT</div>
                <div className="font-body" style={{ fontSize: 12, color: "#cdb98a" }}>Take the kicks yourself — nerve and aim decide it.</div>
              </button>
              <button onClick={() => { setTieMode("quiz"); setDecPicked(null); setDecTimeLeft(DECIDER_SECONDS); }} disabled={decBusy}
                className="w-full rounded-2xl px-4 py-3.5 text-left active:scale-[0.99] transition-transform disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#07121a,#051a1a)", border: "1px solid rgba(0,224,224,0.5)" }}>
                <div className="font-display tracking-wide" style={{ fontSize: 17, color: "#3fe0e0" }}>🧠 SUDDEN-DEATH QUESTION</div>
                <div className="font-body" style={{ fontSize: 12, color: "#9fd8d8" }}>One World Cup question, 25 seconds. Know it and go through.</div>
              </button>
            </div>
            {decBusy && <p className="mt-3 text-center font-body" style={{ fontSize: 12, color: "#8a948f" }}>Setting it up…</p>}
          </div>
        </div>
      )}

      {/* Knockout shootout — a level game is settled by YOUR kicks */}
      {pens && (() => {
        const v = pens.view;
        const pview: PensView = {
          myKicks: v.myKicks,
          oppKicks: v.oppKicks,
          suddenDeath: v.suddenDeath,
          role: v.role === "done" ? "done" : v.role,
          result: v.final ? (v.final.outcome === "you" ? "win" : "loss") : null,
        };
        return (
          <div className="fixed inset-0 z-50 grid place-items-center px-5 overflow-y-auto" style={{ background: "rgba(0,0,0,0.85)" }}>
            <div className="w-full max-w-sm rounded-3xl p-4" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.4)" }}>
              <div className="font-body text-center" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>
                {pens.label.toUpperCase()} · LEVEL AT {pens.goals.you}–{pens.goals.opp} — PENALTIES
              </div>
              <div className="font-body text-center mb-3" style={{ fontSize: 12, color: "#8888aa" }}>
                {run.nation} v {pens.opponent.nation}
              </div>
              <PenaltyShootout
                view={pview}
                myName={run.nation}
                oppName={pens.opponent.nation}
                onShoot={(z, p) => pensAct("shot", z, p)}
                onDive={(c) => pensAct("dive", c)}
              />
              {pensDone && v.role === "done" && (
                <button onClick={pensContinue} className="w-full rounded-2xl py-3 mt-3 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 18 }}>
                  {pensDone.nextTie ? "NEXT TIE →" : "CONTINUE →"}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Stage reveal */}
      {reveal && (
        <div className="fixed inset-0 z-50 grid place-items-center px-5" style={{ background: "rgba(0,0,0,0.8)" }} onClick={() => { setReveal(null); load(); }}>
          <div className="w-full max-w-sm rounded-3xl p-5" style={{ background: "#0e1611", border: `1px solid ${reveal.result === "champion" ? "rgba(255,184,0,0.6)" : reveal.result === "eliminated" ? "rgba(255,71,87,0.5)" : "rgba(174,234,0,0.5)"}` }} onClick={(e) => e.stopPropagation()}>
            <div className="font-body text-center" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>{RUN_STAGE_LABEL[reveal.stage]}</div>
            <div className="flex flex-col gap-2 my-3">
              {reveal.games.map((g, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                  {g.opponent.crest && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.opponent.crest} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />
                  )}
                  <span className="font-body flex-1 truncate" style={{ fontSize: 13, color: "#c4ccc6" }}>{run.nation} v {g.opponent.nation}</span>
                  <span className="font-display" style={{ fontSize: 16, color: "#fff" }}>
                    {g.label === "Qualification Play-off"
                      ? "Play-off"
                      : <>{g.goals.you}–{g.goals.opp}{g.pens ? ` (${g.pens.you}-${g.pens.opp})` : ""}</>}
                    {g.decidedByQuestion && <span style={{ fontSize: 11, color: "#3fe0e0" }}> · Q</span>}
                  </span>
                  <span className="font-display rounded px-1.5" style={{ fontSize: 12, color: "#0a0a0f", background: g.outcome === "win" ? "#aeea00" : g.outcome === "loss" ? "#ff4757" : "#ffb800" }}>{g.outcome === "win" ? "W" : g.outcome === "loss" ? "L" : "D"}</span>
                </div>
              ))}
            </div>
            <div className="font-display tracking-wide text-center" style={{ fontSize: 24, color: reveal.result === "champion" ? "#ffb800" : reveal.result === "eliminated" ? "#ff4757" : "#aeea00" }}>
              {reveal.result === "champion" ? "🏆 CHAMPIONS!" : reveal.result === "eliminated" ? "KNOCKED OUT" : "THROUGH ✓"}
            </div>
            <button onClick={() => { setReveal(null); load(); }} className="w-full rounded-2xl py-3 mt-4 font-display tracking-wide" style={{ background: "#aeea00", color: "#062013", fontSize: 18 }}>CONTINUE →</button>
          </div>
        </div>
      )}

      {quiz && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-5"
          style={{ background: "rgba(0,0,0,0.72)" }}
          onClick={() => { if (answered === null) { setQuiz(null); setPickSlot(null); } }}>
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 pb-8" style={{ background: "#13131c", border: "1px solid rgba(255,184,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display tracking-wide" style={{ fontSize: 13, color: "#ffb800" }}>⚽ ANSWER TO UPGRADE</span>
              <span className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>
                Right → re-spin · wrong → pick lost
              </span>
            </div>
            <p className="font-body mb-4" style={{ fontSize: 16, color: "#fff", lineHeight: 1.35 }}>{quiz.prompt}</p>
            <div className="flex flex-col gap-2">
              {quiz.options.map((opt, i) => {
                const locked = answered !== null;
                const isCorrect = i === quiz.correctIndex;
                const isPicked = i === answered;
                const bg = locked ? (isCorrect ? "rgba(0,255,135,0.16)" : isPicked ? "rgba(255,71,87,0.16)" : "rgba(255,255,255,0.04)") : "rgba(255,255,255,0.05)";
                const border = locked ? (isCorrect ? "rgba(0,255,135,0.6)" : isPicked ? "rgba(255,71,87,0.6)" : "rgba(255,255,255,0.08)") : "rgba(255,255,255,0.12)";
                return (
                  <button key={i} onClick={() => answerQuiz(i)} disabled={locked}
                    className="w-full text-left rounded-xl px-4 py-3 font-body active:scale-[0.99] transition-transform"
                    style={{ background: bg, border: `1px solid ${border}`, color: "#fff", fontSize: 15 }}>
                    {opt}
                    {locked && isCorrect && <span style={{ color: "#00ff87" }}> ✓</span>}
                    {locked && isPicked && !isCorrect && <span style={{ color: "#ff7a88" }}> ✗</span>}
                  </button>
                );
              })}
            </div>
            {feedback ? (
              <p className="mt-3 text-center font-body" style={{ fontSize: 13, color: feedback.correct ? "#00ff87" : "#ff8a3d" }}>
                {feedback.correct
                  ? "✅ Correct — re-spinning with stronger players."
                  : "❌ Wrong — no re-spin. That upgrade pick is gone."}
              </p>
            ) : (
              <p className="mt-3 text-center font-body" style={{ fontSize: 11, color: "#5a5a72" }}>Tap outside to cancel before answering — answer wrong and the pick is forfeited.</p>
            )}
          </div>
        </div>
      )}

      {/* Sudden-death decider question (the player chose the quiz over penalties) */}
      {tie && tieMode === "quiz" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-5" style={{ background: "rgba(0,0,0,0.78)" }}>
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 pb-8" style={{ background: "#13131c", border: "1px solid rgba(0,224,224,0.45)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display tracking-wide" style={{ fontSize: 13, color: "#3fe0e0" }}>
                🧠 {tie.isPlayoff ? "ANSWER TO QUALIFY" : "DRAW — ANSWER TO GO THROUGH"}
              </span>
              <span className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>
                {tie.isPlayoff ? "Qualification play-off" : `${tie.label} · ${tie.goals.you}-${tie.goals.opp}`}
              </span>
            </div>
            {decPicked === null && !decBusy && (
              <div className="mb-3">
                <div className="flex items-center justify-end mb-1">
                  <span className="font-display tabular-nums" style={{ fontSize: 12, color: decTimeLeft <= 5 ? "#ff4757" : "#3fe0e0" }}>⏱ {decTimeLeft}s</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(decTimeLeft / DECIDER_SECONDS) * 100}%`, background: decTimeLeft <= 5 ? "#ff4757" : "#3fe0e0", transition: "width 1s linear" }} />
                </div>
              </div>
            )}
            <p className="font-body mb-4" style={{ fontSize: 16, color: "#fff", lineHeight: 1.35 }}>{tie.question.prompt}</p>
            <div className="flex flex-col gap-2">
              {tie.question.options.map((opt, i) => {
                const picked = i === decPicked;
                return (
                  <button key={i} onClick={() => answerDecider(i)} disabled={decPicked !== null || decBusy}
                    className="w-full text-left rounded-xl px-4 py-3 font-body active:scale-[0.99] transition-transform"
                    style={{ background: picked ? "rgba(0,224,224,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${picked ? "rgba(0,224,224,0.6)" : "rgba(255,255,255,0.12)"}`, color: "#fff", fontSize: 15 }}>
                    {opt}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-center font-body" style={{ fontSize: 12, color: "#8a948f" }}>
              {decBusy ? "Settling it…" : decPicked !== null ? "Locked in…" : "Correct → through. Wrong (or time out) → out."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Scorecard({ url }: { url: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Your World Cup Run scorecard" style={{ width: "100%", aspectRatio: "1200 / 630", display: "block" }} />
    </a>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] grid place-items-center font-body" style={{ background: "#0a0a0f" }}>{children}</div>;
}

function Divider({ text }: { text: string }) {
  return <div className="px-3 py-1.5 font-body" style={{ fontSize: 10, color: "#586058", background: "rgba(255,255,255,0.02)" }}>{text}</div>;
}

function Row({ label, opp, crest, result, current, locked }: {
  label: string; opp: string; crest?: string; result?: MatchRow; current?: boolean; locked?: boolean;
}) {
  const tag = result ? (result.won === true ? "W" : result.won === false ? "L" : "D") : null;
  const tagColor = tag === "W" ? "#aeea00" : tag === "L" ? "#ff4757" : tag === "D" ? "#ffb800" : "#586058";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: current ? "rgba(174,234,0,0.06)" : undefined, opacity: locked ? 0.4 : 1 }}>
      <div className="font-body" style={{ fontSize: 10, color: "#8a948f", width: 80, flexShrink: 0, letterSpacing: 0.3 }}>{label}</div>
      {crest ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={crest} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
      ) : <div style={{ width: 22, flexShrink: 0 }} />}
      <div className="font-body flex-1 truncate" style={{ fontSize: 13, color: current ? "#fff" : "#c4ccc6" }}>{opp}</div>
      {result ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-display" style={{ fontSize: 14, color: "#fff" }}>{result.you_goals}–{result.opp_goals}</span>
          <span className="font-display rounded px-1.5" style={{ fontSize: 12, color: "#0a0a0f", background: tagColor }}>{tag}</span>
        </div>
      ) : current ? <span className="font-body flex-shrink-0" style={{ fontSize: 11, color: "#aeea00" }}>NEXT</span> : null}
    </div>
  );
}
