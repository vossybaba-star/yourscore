"use client";

/**
 * /38-0/wc/run/[id] — World Cup Run: Road to the Final.
 *
 * Group and R32+R16 are resolved as one fast simulation each. QF / SF / Final are
 * duels: the opponent's XI is revealed so you can make changes, then play. Upgrades
 * are spent by tapping a player on your pitch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spinForNation, spinWorld } from "@/lib/draft/pool";
import { drawQuestion, type ServedQuestion } from "@/lib/draft/wc-quiz";
import { gradeAnswer, type DraftBand } from "@/lib/draft/draft-quiz";
import { slotsFor } from "@/lib/draft/formations";
import { CATEGORY_COLOR, posCategory } from "@/lib/draft/score";
import { RUN_STAGE_LABEL, isDuel, type RunStage, type RunMode } from "@/lib/draft/wc";
import { wcNation } from "@/data/draft/wc2026";
import type { Formation, PlacedPlayer, PlayerSeason } from "@/lib/draft/types";
import { trackGameComplete } from "@/lib/analytics/trackGame";

type Fixture = { stage: string; label: string; opponent: { nation: string; crest?: string } };
type Run = {
  id: string; mode: RunMode; nation: string; status: "active" | "eliminated" | "champion";
  stage: RunStage; stage_index: number; formation: Formation; squad: PlacedPlayer[];
  strength: number; plan: { group: Fixture[]; knockouts: Fixture[] };
  group_points: number; upgrades_left: number;
};
type MatchRow = { stage: string; idx: number; you_goals: number; opp_goals: number; pens_you: number | null; pens_opp: number | null; won: boolean | null };
type Opponent = { nation: string; crest?: string; label: string; formation: Formation; squad: PlacedPlayer[]; strength: number };
type GameReveal = { label: string; opponent: { nation: string; crest?: string }; goals: { you: number; opp: number }; pens: { you: number; opp: number } | null; outcome: "win" | "loss" | "draw" };
type PlayResp = { stage: RunStage; games: GameReveal[]; result: "through" | "eliminated" | "champion"; run: Run };

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
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  const [slate, setSlate] = useState<PlayerSeason[] | null>(null);
  const [spunNation, setSpunNation] = useState<{ nation: string; crest?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Quiz-gated upgrades: answer a WC question to re-spin a slot. Correct (and a streak)
  // raises the quality of the players offered; wrong caps it. Streak is run-local.
  const [quiz, setQuiz] = useState<ServedQuestion | null>(null);
  const [answered, setAnswered] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; streak: number } | null>(null);
  const askedIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch(`/api/draft/wc/${id}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Run not found"); setLoading(false); return; }
    setRun(data.run); setMatches(data.matches); setOpponent(data.opponent); setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function play() {
    if (playing) return;
    setPlaying(true); setError(null); setPickSlot(null); setSlate(null);
    try {
      const res = await fetch("/api/draft/wc/play", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not play"); setPlaying(false); return; }
      setReveal(data);
      if (data.result === "champion" || data.result === "eliminated") {
        trackGameComplete("38-0", { mode: "world_cup_run", result: data.result });
      }
    } catch { setError("Network error — try again."); }
    setPlaying(false);
  }

  // Save this exact XI as the active World Cup team and drop into the WC H2H lane.
  // The team is stored under competition="WC" so it never collides with a PL/La Liga
  // team and only ever faces other WC squads (see /38-0/wc/h2h).
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
    if (!quiz || answered !== null || !pickSlot) return;
    setAnswered(idx);
    const correct = idx === quiz.correctIndex;
    const { streak: newStreak, band } = gradeAnswer(streak, correct);
    askedIds.current.add(quiz.id);
    setStreak(newStreak);
    setFeedback({ correct, streak: newStreak });
    const slotId = pickSlot;
    setTimeout(() => { setQuiz(null); setAnswered(null); spinSlot(slotId, band); }, 900);
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
  const playLabel = run.stage === "group" ? "PLAY GROUP STAGE"
    : run.stage === "ko" ? "PLAY R32 & R16"
    : run.stage === "playoff" ? "TAKE THE PLAY-OFF SHOOTOUT"
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
        {run.status === "champion" && (
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
        {run.status === "eliminated" && (
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
            <div className="font-display tracking-wide" style={{ fontSize: 15, color: "#ffb800" }}>IT&apos;S DOWN TO PENALTIES</div>
            <p className="font-body mt-1.5" style={{ fontSize: 13, color: "#e8d6a8", lineHeight: 1.45 }}>
              You finished 3rd in your group on <b style={{ color: "#fff" }}>{run.group_points} points</b> — level with the other nations on the qualification cut-line. In the World Cup the <b style={{ color: "#fff" }}>best third-placed teams</b> go through, so it comes down to a play-off shootout for the final Round-of-32 spot.
            </p>
          </div>
        )}

        {/* Your XI (tap a player to upgrade when picks are available) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>YOUR XI</span>
            {canUpgrade && <span className="font-body" style={{ fontSize: 12, color: "#aeea00" }}>⚽ Tap a player → answer to upgrade · {run.upgrades_left} left{streak >= 2 ? ` · 🔥×${streak}` : ""}</span>}
          </div>
          <Pitch formation={run.formation} squad={run.squad} compact onSlotClick={canUpgrade ? scoutSlot : undefined} highlightSlot={pickSlot} />
          <button onClick={playH2H} disabled={h2hBusy}
            className="mt-3 w-full rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "#ffb800", color: "#1a1300", fontSize: 16, opacity: h2hBusy ? 0.7 : 1 }}>
            {h2hBusy ? "Readying squad…" : "⚔️ Play this XI head-to-head"}
          </button>
          <p className="mt-1.5 text-center font-body" style={{ fontSize: 11, color: "#7a7a92" }}>Take your World Cup squad live vs another manager — own board.</p>
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
              {playing ? "SIMULATING…" : `▶ ${playLabel}`}
            </button>
          </div>
        </div>
      )}

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
                  <span className="font-display" style={{ fontSize: 16, color: "#fff" }}>{g.goals.you}–{g.goals.opp}{g.pens ? ` (${g.pens.you}-${g.pens.opp})` : ""}</span>
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
                {streak >= 1 ? `🔥 Streak ×${streak}` : "Get it right for a better pick"}
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
                  ? feedback.streak >= 2 ? `🔥 Correct — streak ×${feedback.streak}! Elite players unlocked.` : "✅ Correct — strong players unlocked."
                  : "❌ Not quite — a thinner pick. Streak reset."}
              </p>
            ) : (
              <p className="mt-3 text-center font-body" style={{ fontSize: 11, color: "#5a5a72" }}>Tap outside to cancel — your upgrade isn&apos;t spent until you pick.</p>
            )}
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
