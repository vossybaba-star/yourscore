"use client";

/**
 * /38-0/wc/run/[id] — World Cup Run: Road to the Final.
 *
 * Group and R32+R16 are resolved as one fast simulation each. QF / SF / Final are
 * duels: the opponent's XI is revealed so you can make changes, then play. Upgrades
 * are spent by tapping a player on your pitch.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spinForNation } from "@/lib/draft/pool";
import { slotsFor } from "@/lib/draft/formations";
import { CATEGORY_COLOR, posCategory } from "@/lib/draft/score";
import { RUN_STAGE_LABEL, UPGRADE_FLOOR, isDuel, type RunStage } from "@/lib/draft/wc";
import { wcNation } from "@/data/draft/wc2026";
import type { Formation, PlacedPlayer, PlayerSeason } from "@/lib/draft/types";

type Fixture = { stage: string; label: string; opponent: { nation: string; crest?: string }; oppTarget: number };
type Run = {
  id: string; nation: string; status: "active" | "eliminated" | "champion";
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
  const [run, setRun] = useState<Run | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [reveal, setReveal] = useState<PlayResp | null>(null);
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  const [slate, setSlate] = useState<PlayerSeason[] | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch { setError("Network error — try again."); }
    setPlaying(false);
  }

  function scoutSlot(slotId: string) {
    if (!run || run.upgrades_left <= 0) return;
    setPickSlot(slotId);
    const slot = slotsFor(run.formation).find((s) => s.id === slotId)!;
    const usedIds = new Set(run.squad.map((p) => p.player_season_id));
    const usedNames = new Set(run.squad.map((p) => p.name));
    setSlate(spinForNation(run.nation, [slot.pos], usedIds, usedNames, { minOverall: UPGRADE_FLOOR[run.stage], count: 6 }));
  }

  async function applyUpgrade(newPlayerId: string) {
    if (!run || !pickSlot || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/draft/wc/upgrade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: id, slotId: pickSlot, newPlayerId }) });
      const data = await res.json();
      if (res.ok) { setPickSlot(null); setSlate(null); await load(); }
      else setError(data.error ?? "Upgrade failed");
    } catch { setError("Network error."); }
    setBusy(false);
  }

  const crest = useMemo(() => (run ? wcNation(run.nation)?.crest : null), [run]);

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
    return `/api/draft/wc-og?${p}`;
  }, [run, matches, crest]);

  function shareRun() {
    if (!run) return;
    const text = run.status === "champion"
      ? `I won the World Cup with ${run.nation} on YourScore! 🏆`
      : `My ${run.nation} World Cup run ended at the ${RUN_STAGE_LABEL[run.stage]}. Beat that 👇`;
    const url = `${window.location.origin}/38-0/wc`;
    if (navigator.share) navigator.share({ title: "YourScore — World Cup Run", text, url }).catch(() => {});
    else { navigator.clipboard?.writeText(`${text} ${url}`); window.open(`${window.location.origin}${scorecardUrl}`, "_blank"); }
  }

  if (loading) return <Screen><div style={{ color: "#8888aa" }}>Loading…</div></Screen>;
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
    : `PLAY THE ${RUN_STAGE_LABEL[run.stage].toUpperCase()}`;

  return (
    <div className="min-h-[100dvh] pb-40" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4"><Link href="/38-0" className="font-body text-sm" style={{ color: "#8888aa" }}>← Exit</Link></div>

        {/* Header */}
        <div className="flex items-center gap-3 pt-2">
          {crest && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={crest} alt={run.nation} width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain" }} />
          )}
          <div className="flex-1">
            <div className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>{run.nation}</div>
            <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>
              {run.status === "champion" ? "🏆 World Champions" : run.status === "eliminated" ? "Eliminated" : RUN_STAGE_LABEL[run.stage]}
            </div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 10, color: "#8888aa", letterSpacing: 1 }}>OVERALL</div>
            <div className="font-display" style={{ fontSize: 32, lineHeight: 1, color: "#00ff87" }}>{run.strength}</div>
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
              <Link href="/38-0/wc" className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 15 }}>NEW RUN</Link>
            </div>
          </div>
        )}

        {/* Road to the Final */}
        <div className="mt-4 rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="px-3 py-2 font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>ROAD TO THE FINAL</div>
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

        {/* Your XI (tap a player to upgrade when picks are available) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>YOUR XI</span>
            {canUpgrade && <span className="font-body" style={{ fontSize: 12, color: "#00ff87" }}>⬆️ Tap a player to upgrade · {run.upgrades_left} left</span>}
          </div>
          <Pitch formation={run.formation} squad={run.squad} compact onSlotClick={canUpgrade ? scoutSlot : undefined} highlightSlot={pickSlot} />
        </div>

        {/* Upgrade slate */}
        {pickSlot && slate && (
          <div className="mt-3 rounded-2xl p-3" style={{ background: "#12121e", border: "1px solid rgba(0,255,135,0.3)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>Replace — pick a better player</span>
              <button onClick={() => { setPickSlot(null); setSlate(null); }} className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>Cancel</button>
            </div>
            <div className="flex flex-col gap-1">
              {slate.map((p) => (
                <button key={p.id} onClick={() => applyUpgrade(p.id)} disabled={busy}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left active:scale-[0.99]" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <span className="flex items-center justify-center rounded font-display" style={{ width: 30, height: 30, fontSize: 15, color: "#0a0a0f", background: CATEGORY_COLOR[posCategory(p.position)] }}>{p.overall}</span>
                  <span className="font-body flex-1 truncate" style={{ fontSize: 13, color: "#fff" }}>{p.name} <span style={{ color: "#8888aa", fontSize: 11 }}>{p.club}</span></span>
                </button>
              ))}
              {slate.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No upgrades available for this slot.</span>}
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
              style={{ background: "#00ff87", color: "#062013", fontSize: 22 }}>
              {playing ? "SIMULATING…" : `▶ ${playLabel}`}
            </button>
          </div>
        </div>
      )}

      {/* Stage reveal */}
      {reveal && (
        <div className="fixed inset-0 z-50 grid place-items-center px-5" style={{ background: "rgba(0,0,0,0.8)" }} onClick={() => { setReveal(null); load(); }}>
          <div className="w-full max-w-sm rounded-3xl p-5" style={{ background: "#12121e", border: `1px solid ${reveal.result === "champion" ? "rgba(255,184,0,0.6)" : reveal.result === "eliminated" ? "rgba(255,71,87,0.5)" : "rgba(0,255,135,0.5)"}` }} onClick={(e) => e.stopPropagation()}>
            <div className="font-body text-center" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>{RUN_STAGE_LABEL[reveal.stage]}</div>
            <div className="flex flex-col gap-2 my-3">
              {reveal.games.map((g, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                  {g.opponent.crest && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.opponent.crest} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />
                  )}
                  <span className="font-body flex-1 truncate" style={{ fontSize: 13, color: "#cfcfe0" }}>{run.nation} v {g.opponent.nation}</span>
                  <span className="font-display" style={{ fontSize: 16, color: "#fff" }}>{g.goals.you}–{g.goals.opp}{g.pens ? ` (${g.pens.you}-${g.pens.opp})` : ""}</span>
                  <span className="font-display rounded px-1.5" style={{ fontSize: 12, color: "#0a0a0f", background: g.outcome === "win" ? "#00ff87" : g.outcome === "loss" ? "#ff4757" : "#ffb800" }}>{g.outcome === "win" ? "W" : g.outcome === "loss" ? "L" : "D"}</span>
                </div>
              ))}
            </div>
            <div className="font-display tracking-wide text-center" style={{ fontSize: 24, color: reveal.result === "champion" ? "#ffb800" : reveal.result === "eliminated" ? "#ff4757" : "#00ff87" }}>
              {reveal.result === "champion" ? "🏆 CHAMPIONS!" : reveal.result === "eliminated" ? "KNOCKED OUT" : "THROUGH ✓"}
            </div>
            <button onClick={() => { setReveal(null); load(); }} className="w-full rounded-2xl py-3 mt-4 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 18 }}>CONTINUE →</button>
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
  return <div className="px-3 py-1.5 font-body" style={{ fontSize: 10, color: "#5a5a72", background: "rgba(255,255,255,0.02)" }}>{text}</div>;
}

function Row({ label, opp, crest, result, current, locked }: {
  label: string; opp: string; crest?: string; result?: MatchRow; current?: boolean; locked?: boolean;
}) {
  const tag = result ? (result.won === true ? "W" : result.won === false ? "L" : "D") : null;
  const tagColor = tag === "W" ? "#00ff87" : tag === "L" ? "#ff4757" : tag === "D" ? "#ffb800" : "#5a5a72";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: current ? "rgba(0,255,135,0.06)" : undefined, opacity: locked ? 0.4 : 1 }}>
      <div className="font-body" style={{ fontSize: 10, color: "#8888aa", width: 80, flexShrink: 0, letterSpacing: 0.3 }}>{label}</div>
      {crest ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={crest} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
      ) : <div style={{ width: 22, flexShrink: 0 }} />}
      <div className="font-body flex-1 truncate" style={{ fontSize: 13, color: current ? "#fff" : "#cfcfe0" }}>{opp}</div>
      {result ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-display" style={{ fontSize: 14, color: "#fff" }}>{result.you_goals}–{result.opp_goals}</span>
          <span className="font-display rounded px-1.5" style={{ fontSize: 12, color: "#0a0a0f", background: tagColor }}>{tag}</span>
        </div>
      ) : current ? <span className="font-body flex-shrink-0" style={{ fontSize: 11, color: "#00ff87" }}>NEXT</span> : null}
    </div>
  );
}
