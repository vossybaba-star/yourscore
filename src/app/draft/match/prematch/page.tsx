"use client";

/**
 * /draft/match/prematch — after matchmaking you see your opponent's XI before
 * kick-off and may swap up to THREE of your players (each replaced by a same-line
 * player: defender, midfielder or striker), or stick with your team, then play.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spin, allBuckets, type Spin } from "@/lib/draft/pool";
import {
  loadTeam, saveTeam, usedPlayerIds, usedPlayerNames, placePlayer,
  recordWin, recordLoss, saveLastMatch, loadMatchup, clearMatchup,
  type LocalTeam, type Matchup,
} from "@/lib/draft/local";
import { slotsFor } from "@/lib/draft/formations";
import { posCategory } from "@/lib/draft/score";
import { tierColor } from "@/lib/draft/ui";
import type { PlayerSeason } from "@/lib/draft/types";

const MAX_SWAPS = 3;
const LINE_LABEL: Record<string, string> = { gk: "goalkeeper", def: "defender", mid: "midfielder", att: "striker" };

export default function PreMatch() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [swapsUsed, setSwapsUsed] = useState(0);
  const [swapSlot, setSwapSlot] = useState<string | null>(null);
  const [current, setCurrent] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = loadTeam();
    const m = loadMatchup();
    if (!t || !m) { router.replace("/draft/team"); return; }
    setTeam(t); setMatchup(m);
  }, [router]);
  useEffect(() => () => { if (reelTimer.current) clearInterval(reelTimer.current); }, []);

  if (!team || !matchup) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  const slot = swapSlot ? slotsFor(team.formation).find((s) => s.id === swapSlot) : null;
  const dropping = swapSlot ? team.squad.find((p) => p.slot === swapSlot) : null;

  function beginSwap(slotId: string) {
    if (swapsUsed >= MAX_SWAPS || playing) return;
    setSwapSlot(slotId); setCurrent(null); setReel(null);
  }

  function doSpin() {
    if (!team || !slot || spinning) return;
    setSpinning(true); setCurrent(null);
    const buckets = allBuckets();
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season });
      if (++ticks > 12) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        const result = spin([slot.pos], usedPlayerIds(team), usedPlayerNames(team));
        setReel({ club: result.club, season: result.season });
        setCurrent(result); setSpinning(false);
      }
    }, 65);
  }

  function draft(player: PlayerSeason) {
    if (!team || !slot) return;
    const next = placePlayer(team, player, slot);
    saveTeam(next); setTeam(next);
    setSwapsUsed((n) => n + 1);
    setSwapSlot(null); setCurrent(null); setReel(null);
  }

  async function play() {
    if (!team || !matchup || playing) return;
    setPlaying(true); setErr(null);
    try {
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const saveRes = await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad }) });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save team"); setPlaying(false); return; }

      const r = await fetch("/api/draft/match", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: "resolve", opponentId: matchup.opponentId, findId: matchup.findId, botFormation: matchup.botFormation, leagueId: matchup.leagueId ?? undefined }),
      });
      const m = await r.json();
      if (!r.ok) { setErr(m.error ?? "Match failed"); setPlaying(false); return; }

      saveLastMatch({
        id: m.matchId,
        you: { name: "You", formation: m.you.formation, squad: m.you.squad, strength: m.you.strength, projected: m.you.projected },
        opp: { name: m.opp.name, formation: m.opp.formation, squad: m.opp.squad, strength: m.opp.strength, projected: m.opp.projected },
        winner: m.youWon ? "you" : "opp", margin: m.margin, playedAt: Date.now(),
      });
      saveTeam(m.youWon ? recordWin(team) : recordLoss(team));
      clearMatchup();
      router.push("/draft/match/result");
    } catch { setErr("Network error"); setPlaying(false); }
  }

  const opp = matchup.opp;

  // ── Swapping a single slot ──
  if (slot) {
    const draftable = current?.players ?? [];
    return (
      <div className="min-h-[100dvh] pb-40" style={{ background: "#0a0a0f" }}>
        <div className="max-w-lg mx-auto px-4 pt-safe">
          <div className="pt-4 pb-2 text-center">
            <div className="font-display tracking-wide" style={{ fontSize: 26, color: "#ffb800" }}>REPLACE: {dropping?.name.split(" ").slice(-1)[0]}</div>
            <div className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>Spin and draft a {LINE_LABEL[posCategory(slot.pos)]} ({slot.label})</div>
          </div>
          <Pitch formation={team.formation} squad={team.squad} highlightSlot={slot.id} compact />
        </div>
        <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
          <div className="max-w-lg mx-auto px-4 pt-3">
            {(spinning || reel) && (
              <div className="mb-3 rounded-2xl px-4 py-3 text-center" style={{ background: "#12121e", border: `1px solid ${spinning ? "rgba(255,184,0,0.4)" : "rgba(255,184,0,0.3)"}` }}>
                <div className="font-display tracking-wide" style={{ fontSize: 22, color: spinning ? "#ffb800" : "#fff" }}>{reel?.club ?? "—"} <span style={{ color: "#8888aa", fontSize: 16 }}>{reel?.season ?? ""}</span></div>
              </div>
            )}
            {current && !spinning && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                {draftable.map((p) => (
                  <button key={p.id} onClick={() => draft(p)} className="flex-shrink-0 rounded-xl p-3 text-left active:scale-95 transition-transform" style={{ width: 132, background: "#1a1a2e", border: "1px solid rgba(255,184,0,0.3)" }}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-display" style={{ fontSize: 24, color: "#ffb800" }}>{p.overall}</span>
                      <span className="font-body px-1.5 py-0.5 rounded" style={{ fontSize: 10, color: "#1a1300", background: "#ffb800" }}>{p.position}</span>
                    </div>
                    <div className="font-body mt-1 leading-tight" style={{ fontSize: 13, color: "#fff" }}>{p.name}</div>
                    <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>{p.season}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={doSpin} disabled={spinning} className="rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60" style={{ background: spinning ? "#1a1a2e" : "#ffb800", color: spinning ? "#ffb800" : "#1a1300", fontSize: 20 }}>{spinning ? "SPINNING…" : current ? "SPIN AGAIN ↻" : "SPIN 🎰"}</button>
              <button onClick={() => { setSwapSlot(null); setCurrent(null); setReel(null); }} className="rounded-2xl py-4 font-body active:scale-[0.98] transition-transform" style={{ background: "#12121e", color: "#cfcfe6", fontSize: 15, border: "1px solid rgba(255,255,255,0.1)" }}>Keep {dropping?.name.split(" ").slice(-1)[0]}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Preview both XIs ──
  const swapsLeft = MAX_SWAPS - swapsUsed;
  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-6 text-center">
          <div className="font-body" style={{ fontSize: 12, color: "#8888aa", letterSpacing: 1 }}>MATCH PREVIEW</div>
          <div className="font-display tracking-wide leading-none mt-1" style={{ fontSize: 30, color: "#fff" }}>
            YOU <span style={{ color: "#8888aa", fontSize: 20 }}>vs</span> {opp.name}
          </div>
          <div className="font-body mt-2" style={{ fontSize: 14 }}>
            <b style={{ color: tierColor(team.projected?.tier ?? "Mid-table") }}>{team.strength}</b>
            <span style={{ color: "#8888aa" }}> · </span>
            <b style={{ color: tierColor(opp.projected?.tier ?? "Mid-table") }}>{opp.strength}</b>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <div>
            <div className="font-display tracking-wide mb-1" style={{ fontSize: 15, color: "#00ff87" }}>YOUR XI</div>
            <Pitch formation={team.formation} squad={team.squad} onSlotClick={swapsLeft > 0 ? beginSwap : undefined} compact />
          </div>
          <div>
            <div className="font-display tracking-wide mb-1 truncate" style={{ fontSize: 15, color: "#fff" }}>{opp.name}</div>
            <Pitch formation={opp.formation} squad={opp.squad} compact />
          </div>
        </div>

        {err && <div className="rounded-xl px-4 py-2 mt-4 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

        <div className="mt-5 rounded-2xl p-4 text-center" style={{ background: "#0d0d14", border: "1px solid rgba(255,184,0,0.25)" }}>
          <div className="font-display tracking-wide" style={{ fontSize: 18, color: "#ffb800" }}>
            {swapsLeft > 0 ? `SWAP UP TO ${swapsLeft} PLAYER${swapsLeft === 1 ? "" : "S"}` : "NO SWAPS LEFT"}
          </div>
          <div className="font-body mt-1" style={{ fontSize: 12, color: "#8888aa" }}>
            {swapsLeft > 0 ? "Tap a player in your XI to swap them out — or stick and play." : "You've used all 3 swaps."}
          </div>
        </div>

        <button onClick={play} disabled={playing}
          className="w-full mt-4 rounded-2xl py-5 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
          style={{ background: "#00ff87", color: "#062013", fontSize: 26 }}>
          {playing ? "PLAYING…" : "PLAY MATCH ⚔️"}
        </button>
        <button onClick={() => { clearMatchup(); router.push("/draft/team"); }}
          className="w-full mt-2 rounded-2xl py-3 font-body active:scale-[0.98] transition-transform"
          style={{ background: "transparent", color: "#8888aa", fontSize: 14 }}>
          Back to my team
        </button>
      </div>
    </div>
  );
}
