"use client";

/**
 * /38-0/wc/run/[id] — World Cup Run: Road to the Final.
 *
 * Shows your nation's path (group → R32 → … → Final) with results, the next fixture,
 * an upgrade window between rounds, and a match reveal. Server is authoritative — we
 * POST /play and /upgrade and re-fetch the run state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spinForNation } from "@/lib/draft/pool";
import { slotsFor } from "@/lib/draft/formations";
import { CATEGORY_COLOR, posCategory } from "@/lib/draft/score";
import { stageConfig, WC_STAGE_LABEL, type WCStage, type WCPlan, type WCFixture } from "@/lib/draft/wc";
import { wcNation } from "@/data/draft/wc2026";
import type { Formation, PlacedPlayer, PlayerSeason } from "@/lib/draft/types";

type Run = {
  id: string; nation: string; status: "active" | "eliminated" | "champion";
  stage: WCStage; stage_index: number; formation: Formation; squad: PlacedPlayer[];
  strength: number; plan: WCPlan; group_played: number; group_points: number; upgrades_left: number;
};
type MatchRow = {
  stage: string; idx: number; opponent_nation: string; opponent_crest: string | null;
  you_goals: number; opp_goals: number; pens_you: number | null; pens_opp: number | null; won: boolean | null;
};
type PlayResult = {
  stage: string; opponent: { nation: string }; oppStrength: number;
  goals: { you: number; opp: number }; pens: { you: number; opp: number } | null;
  outcome: "win" | "loss" | "draw"; report: { events: { side: "a" | "b"; minute: number; scorerName: string }[] };
};

export default function WorldCupRun() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [next, setNext] = useState<(WCFixture & { idx: number; allowDraw: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [reveal, setReveal] = useState<PlayResult | null>(null);

  // upgrade UI
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  const [slate, setSlate] = useState<PlayerSeason[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/draft/wc/${id}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Run not found"); setLoading(false); return; }
    setRun(data.run); setMatches(data.matches); setNext(data.next); setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function play() {
    if (playing) return;
    setPlaying(true); setError(null);
    try {
      const res = await fetch("/api/draft/wc/play", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not play"); setPlaying(false); return; }
      setReveal(data.match);
    } catch { setError("Network error — try again."); }
    setPlaying(false);
  }

  async function applyUpgrade(newPlayerId: string) {
    if (!run || !pickSlot || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/draft/wc/upgrade", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: id, slotId: pickSlot, newPlayerId }),
      });
      const data = await res.json();
      if (res.ok) { setPickSlot(null); setSlate(null); await load(); }
      else setError(data.error ?? "Upgrade failed");
    } catch { setError("Network error."); }
    setBusy(false);
  }

  function scoutSlot(slotId: string) {
    if (!run) return;
    setPickSlot(slotId);
    const slot = slotsFor(run.formation).find((s) => s.id === slotId)!;
    const usedIds = new Set(run.squad.map((p) => p.player_season_id));
    const usedNames = new Set(run.squad.map((p) => p.name));
    const floor = stageConfig(run.stage).upgradeFloor;
    setSlate(spinForNation(run.nation, [slot.pos], usedIds, usedNames, { minOverall: floor, count: 6 }));
  }

  const crest = useMemo(() => (run ? wcNation(run.nation)?.crest : null), [run]);

  function shareRun() {
    if (!run) return;
    const last = matches[matches.length - 1];
    const params = new URLSearchParams({ nation: run.nation, status: run.status, stage: run.stage });
    if (crest) params.set("crest", crest);
    if (last) { params.set("opp", last.opponent_nation); params.set("g", `${last.you_goals}-${last.opp_goals}`); }
    const img = `${window.location.origin}/api/draft/wc-og?${params.toString()}`;
    const text = run.status === "champion"
      ? `I won the World Cup with ${run.nation} on YourScore! 🏆`
      : `My ${run.nation} World Cup run ended at the ${WC_STAGE_LABEL[run.stage]}. Beat that 👇`;
    const url = `${window.location.origin}/38-0/wc`;
    if (navigator.share) navigator.share({ title: "YourScore — World Cup Run", text, url }).catch(() => {});
    else { navigator.clipboard?.writeText(`${text} ${url}`); window.open(img, "_blank"); }
  }

  if (loading) return <Screen><div style={{ color: "#8888aa" }}>Loading…</div></Screen>;
  if (error && !run) return <Screen><div style={{ color: "#ff8a3d" }}>{error}</div></Screen>;
  if (!run) return null;

  // Build the road: group (3) then knockouts (5), each with its result if played.
  const groupResult = (i: number) => matches.find((m) => m.stage === "group" && m.idx === i);
  const koResult = (stage: string) => matches.find((m) => m.stage === stage);

  const terminal = run.status !== "active";

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
              {run.status === "champion" ? "🏆 World Champions" : run.status === "eliminated" ? "Eliminated" : WC_STAGE_LABEL[run.stage]}
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
            <div className="font-body mt-1" style={{ fontSize: 14, color: "#cdb98a" }}>{run.nation} are champions of the world.</div>
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
              Your run ended at the {WC_STAGE_LABEL[run.stage]}{run.stage === "group" ? ` (${run.group_points} pts)` : ""}.
            </div>
            <div className="flex items-center justify-center gap-2 mt-3">
              <button onClick={shareRun} className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 15 }}>SHARE</button>
              <Link href="/38-0/wc" className="rounded-xl px-4 py-2 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 15 }}>NEW RUN</Link>
            </div>
          </div>
        )}

        {/* Road to the Final */}
        <div className="mt-4 rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="px-3 py-2 font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>ROAD TO THE FINAL</div>
          {/* group */}
          {run.plan.group.map((f, i) => (
            <Row key={`g${i}`} label={`Group · ${i + 1}/3`} opp={f.opponent.nation} crest={wcNation(f.opponent.nation)?.crest}
              result={groupResult(i)} current={run.status === "active" && run.stage === "group" && run.group_played === i} />
          ))}
          <div className="px-3 py-1.5 font-body" style={{ fontSize: 10, color: "#5a5a72", background: "rgba(255,255,255,0.02)" }}>
            {run.stage === "group" ? `Need ${4} pts to qualify · you have ${run.group_points}` : "Qualified ✓"}
          </div>
          {/* knockouts */}
          {run.plan.knockouts.map((f) => {
            const r = koResult(f.stage);
            const isCurrent = run.status === "active" && run.stage === f.stage;
            return (
              <Row key={f.stage} label={WC_STAGE_LABEL[f.stage]} opp={f.opponent.nation} crest={wcNation(f.opponent.nation)?.crest}
                result={r} current={isCurrent} locked={!r && !isCurrent} />
            );
          })}
        </div>

        {/* Your XI */}
        <div className="mt-4"><Pitch formation={run.formation} squad={run.squad} compact /></div>

        {/* Upgrade window */}
        {!terminal && run.upgrades_left > 0 && (
          <div className="mt-4 rounded-2xl p-3" style={{ background: "#12121e", border: "1px solid rgba(0,255,135,0.3)" }}>
            <div className="font-body mb-2" style={{ fontSize: 13, color: "#fff" }}>
              ⬆️ Upgrade your squad — <b style={{ color: "#00ff87" }}>{run.upgrades_left}</b> pick{run.upgrades_left > 1 ? "s" : ""} left
            </div>
            {!pickSlot ? (
              <div className="flex flex-wrap gap-1.5">
                {run.squad.map((p) => (
                  <button key={p.slot} onClick={() => scoutSlot(p.slot)} className="rounded-lg px-2 py-1.5 font-body active:scale-95 transition-transform"
                    style={{ fontSize: 11, color: "#fff", background: "rgba(255,255,255,0.06)" }}>
                    {p.slotPos} · {p.name.split(" ").slice(-1)[0]} <span style={{ color: "#00ff87" }}>{p.overall}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>Replace — pick a better player</span>
                  <button onClick={() => { setPickSlot(null); setSlate(null); }} className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>Cancel</button>
                </div>
                <div className="flex flex-col gap-1">
                  {(slate ?? []).map((p) => (
                    <button key={p.id} onClick={() => applyUpgrade(p.id)} disabled={busy}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 text-left active:scale-[0.99]" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <span className="flex items-center justify-center rounded font-display" style={{ width: 30, height: 30, fontSize: 15, color: "#0a0a0f", background: CATEGORY_COLOR[posCategory(p.position)] }}>{p.overall}</span>
                      <span className="font-body flex-1 truncate" style={{ fontSize: 13, color: "#fff" }}>{p.name} <span style={{ color: "#8888aa", fontSize: 11 }}>{p.club}</span></span>
                    </button>
                  ))}
                  {slate && slate.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No upgrades available for this slot.</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-3 font-body text-center" style={{ fontSize: 13, color: "#ff8a3d" }}>{error}</div>}
      </div>

      {/* Action bar */}
      {!terminal && next && (
        <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
          <div className="max-w-lg mx-auto px-4 pt-3">
            <button onClick={play} disabled={playing}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: "#00ff87", color: "#062013", fontSize: 22 }}>
              {playing ? "PLAYING…" : `▶ PLAY ${next.opponent.nation.toUpperCase()}`}
            </button>
          </div>
        </div>
      )}

      {/* Result reveal */}
      {reveal && (
        <div className="fixed inset-0 z-50 grid place-items-center px-5" style={{ background: "rgba(0,0,0,0.78)" }} onClick={() => { setReveal(null); load(); }}>
          <div className="w-full max-w-sm rounded-3xl p-5 text-center" style={{ background: "#12121e", border: `1px solid ${reveal.outcome === "win" ? "rgba(0,255,135,0.5)" : reveal.outcome === "loss" ? "rgba(255,71,87,0.5)" : "rgba(255,184,0,0.5)"}` }} onClick={(e) => e.stopPropagation()}>
            <div className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>{WC_STAGE_LABEL[reveal.stage as WCStage]}</div>
            <div className="font-display tracking-wide mt-1" style={{ fontSize: 22, color: "#fff" }}>{run.nation} vs {reveal.opponent.nation}</div>
            <div className="font-display my-2" style={{ fontSize: 56, lineHeight: 1, color: reveal.outcome === "win" ? "#00ff87" : reveal.outcome === "loss" ? "#ff4757" : "#ffb800" }}>
              {reveal.goals.you}–{reveal.goals.opp}
            </div>
            {reveal.pens && <div className="font-body" style={{ fontSize: 13, color: "#ffb800" }}>Penalties: {reveal.pens.you}–{reveal.pens.opp}</div>}
            <div className="font-display tracking-wide mt-1" style={{ fontSize: 20, color: reveal.outcome === "win" ? "#00ff87" : reveal.outcome === "loss" ? "#ff4757" : "#ffb800" }}>
              {reveal.outcome === "win" ? "WIN" : reveal.outcome === "loss" ? "DEFEAT" : "DRAW"}
            </div>
            {reveal.report?.events?.length > 0 && (
              <div className="mt-2 font-body" style={{ fontSize: 11, color: "#8888aa" }}>
                {reveal.report.events.map((e, i) => (
                  <span key={i}>{e.scorerName} {e.minute}&apos;{i < reveal.report.events.length - 1 ? " · " : ""}</span>
                ))}
              </div>
            )}
            <button onClick={() => { setReveal(null); load(); }} className="w-full rounded-2xl py-3 mt-4 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 18 }}>CONTINUE →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] grid place-items-center font-body" style={{ background: "#0a0a0f" }}>{children}</div>;
}

function Row({ label, opp, crest, result, current, locked }: {
  label: string; opp: string; crest?: string; result?: MatchRow; current?: boolean; locked?: boolean;
}) {
  const tag = result
    ? (result.won === true ? "W" : result.won === false ? "L" : "D")
    : null;
  const tagColor = tag === "W" ? "#00ff87" : tag === "L" ? "#ff4757" : tag === "D" ? "#ffb800" : "#5a5a72";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: current ? "rgba(0,255,135,0.06)" : undefined, opacity: locked ? 0.4 : 1 }}>
      <div className="font-body" style={{ fontSize: 10, color: "#8888aa", width: 78, flexShrink: 0, letterSpacing: 0.5 }}>{label}</div>
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
      ) : current ? (
        <span className="font-body flex-shrink-0" style={{ fontSize: 11, color: "#00ff87" }}>NEXT</span>
      ) : null}
    </div>
  );
}
