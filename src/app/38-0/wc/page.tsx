"use client";

/**
 * /38-0/wc — World Cup Run: pick a nation, then draft a NATION-LOCKED XI.
 *
 * Only players from the chosen nation can be spun (spinForNation). Once the XI is
 * complete we POST to /api/draft/wc (start), which validates + plans the bracket and
 * returns a run id; we then go to the Road-to-the-Final screen.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { pickableNations, spinForNation, type PickableNation } from "@/lib/draft/pool";
import {
  emptyTeam, openSlots, isComplete, usedPlayerIds, usedPlayerNames, placePlayer, type LocalTeam,
} from "@/lib/draft/local";
import { slotsFor } from "@/lib/draft/formations";
import { canPlay, lineRatings, posCategory, CATEGORY_COLOR } from "@/lib/draft/score";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { Formation, PlayerSeason, Slot } from "@/lib/draft/types";

const FORMATION = "4-3-3" as Formation; // sensible default; nation pools are deepest here

export default function WorldCupEntry() {
  const router = useRouter();
  const nations = useMemo(() => pickableNations(), []);
  const [nation, setNation] = useState<PickableNation | null>(null);
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [slate, setSlate] = useState<PlayerSeason[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlayerSeason | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function chooseNation(n: PickableNation) {
    setNation(n);
    setTeam(emptyTeam(FORMATION));
    setSlate(null); setSelected(null); setReel(null);
  }

  function doSpin() {
    if (!team || !nation || spinning) return;
    setSpinning(true); setSlate(null); setSelected(null);
    const open = openSlots(team).map((s) => s.pos);
    const pool = spinForNation(nation.nation, open, usedPlayerIds(team), usedPlayerNames(team), { count: 6 });
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      setReel(pool.length ? pool[Math.floor(Math.random() * pool.length)].name : "—");
      if (++ticks > 11) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        setReel(null);
        setSlate(pool);
        setSpinning(false);
      }
    }, 70);
  }

  function placeAt(slot: Slot) {
    if (!team || !selected) return;
    const next = placePlayer(team, selected, slot);
    setTeam(next); setSlate(null); setSelected(null);
  }

  async function start() {
    if (!team || !nation || !isComplete(team) || starting) return;
    setStarting(true); setError(null);
    try {
      const res = await fetch("/api/draft/wc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", nation: nation.nation, formation: team.formation, squad: team.squad }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not start"); setStarting(false); return; }
      router.push(`/38-0/wc/run/${data.runId}`);
    } catch {
      setError("Network error — try again."); setStarting(false);
    }
  }

  // ── Nation picker ───────────────────────────────────────────────────────────
  if (!nation || !team) {
    return (
      <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
        <div className="max-w-lg mx-auto px-4 pt-safe">
          <div className="pt-4"><Link href="/38-0" className="font-body text-sm" style={{ color: "#8888aa" }}>← Back</Link></div>
          <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 32, color: "#fff" }}>🏆 WORLD CUP RUN</h1>
          <p className="font-body mt-1 mb-4" style={{ fontSize: 14, color: "#cfcfe6" }}>
            A solo World Cup campaign. Pick a nation, build an XI from <b style={{ color: "#fff" }}>their players only</b>, and play their real World Cup 2026 path.
          </p>

          {/* How it works */}
          <div className="rounded-2xl p-4 mb-5" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.3)" }}>
            <div className="font-body mb-2.5" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>HOW IT WORKS</div>
            {[
              ["①", "Pick your nation & draft your XI", "Only players from that nation are in your pool."],
              ["②", "Play the real WC 2026 fixtures", "Your group, then the knockouts — vs the actual opponents."],
              ["③", "Win to advance · upgrade each round", "Survive the group, then it's win-or-go-home. Better picks unlock as you progress."],
              ["④", "Lose a knockout and you're out", "Reach the final and lift the trophy. 🏆"],
            ].map(([n, title, desc]) => (
              <div key={n as string} className="flex gap-3 mb-2.5 last:mb-0">
                <span className="font-display flex-shrink-0" style={{ fontSize: 18, color: "#ffb800" }}>{n}</span>
                <div>
                  <div className="font-body" style={{ fontSize: 13.5, color: "#fff" }}>{title}</div>
                  <div className="font-body" style={{ fontSize: 12, color: "#8888aa", lineHeight: 1.35 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="font-body mb-2" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>PICK YOUR NATION</div>
          <div className="grid grid-cols-2 gap-2.5">
            {nations.map((n) => (
              <button key={n.nation} onClick={() => chooseNation(n)}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left active:scale-[0.98] transition-transform"
                style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={n.crest} alt={n.nation} width={34} height={34} style={{ width: 34, height: 34, objectFit: "contain" }} />
                <div className="min-w-0">
                  <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>{n.nation}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Nation-locked draft ───────────────────────────────────────────────────────
  const remaining = 11 - team.squad.length;
  const lines = lineRatings(team.squad);
  const slots = slotsFor(team.formation);
  const filledBySlot = new Map(team.squad.map((p) => [p.slot, p]));
  const available = selected ? slots.filter((s) => !filledBySlot.has(s.id) && canPlay(selected.position, s.pos)) : [];

  return (
    <div className="min-h-[100dvh] pb-44" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4">
          <button onClick={() => setNation(null)} className="font-body text-sm" style={{ color: "#8888aa" }}>← Change nation</button>
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={nation.crest} alt={nation.nation} width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain" }} />
            <div>
              <div className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>YOUR {nation.nation.toUpperCase()} XI</div>
              <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>{team.formation}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>OVERALL</div>
            <div className="font-display" style={{ fontSize: 38, lineHeight: 1, color: "#00ff87" }}>{team.squad.length ? team.strength : "—"}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 mb-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(team.squad.length / 11) * 100}%`, background: "#00ff87" }} />
          </div>
          <span className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>{team.squad.length}/11</span>
        </div>

        <Pitch formation={team.formation} squad={team.squad} compact />

        {team.squad.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {([["ATT", lines.attack, "att"], ["MID", lines.midfield, "mid"], ["DEF", lines.defence, "def"], ["GK", lines.gk, "gk"]] as const).map(([label, val, cat]) => (
              <div key={label} className="rounded-xl px-2 py-2 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-display" style={{ fontSize: 20, color: val ? CATEGORY_COLOR[cat] : "#444" }}>{val || "—"}</div>
                <div className="font-body" style={{ fontSize: 9, color: "#8888aa", letterSpacing: 1 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
        <div className="max-w-lg mx-auto px-4 pt-3">
          {spinning && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.4)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={nation.crest} alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain", opacity: 0.85 }} />
              <div className="font-display tracking-wide truncate" style={{ fontSize: 22, color: "#ffb800" }}>{reel ?? "Scouting…"}</div>
            </div>
          )}

          {selected && (
            <div className="mb-3 rounded-2xl p-3" style={{ background: "#161622", border: "1px solid rgba(0,255,135,0.3)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-body" style={{ fontSize: 14, color: "#fff" }}>Place <b style={{ color: "#00ff87" }}>{selected.name}</b></span>
                <button onClick={() => setSelected(null)} className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>Cancel</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {available.map((s) => (
                  <button key={s.id} onClick={() => placeAt(s)} className="rounded-lg px-3 py-2 font-display tracking-wide active:scale-95 transition-transform"
                    style={{ fontSize: 14, color: "#0a0a0f", background: CATEGORY_COLOR[posCategory(s.pos)] }}>{s.label}</button>
                ))}
                {available.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No open slot fits — pick another player.</span>}
              </div>
            </div>
          )}

          {slate && !spinning && !selected && (
            <div className="mb-3 rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.07)", maxHeight: 320, overflowY: "auto" }}>
              <div className="px-3 py-2 font-body sticky top-0" style={{ fontSize: 11, color: "#8888aa", background: "#0d0d14" }}>Pick a player → choose their slot</div>
              {slate.map((p) => {
                const c = CATEGORY_COLOR[posCategory(p.position)];
                const elig = slots.some((s) => !filledBySlot.has(s.id) && canPlay(p.position, s.pos));
                const badge = getTeamBadgeUrlSync(p.club);
                return (
                  <button key={p.id} onClick={() => elig && setSelected(p)} disabled={!elig}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", opacity: elig ? 1 : 0.4 }}>
                    <div className="flex items-center justify-center rounded-lg font-display flex-shrink-0" style={{ width: 38, height: 38, fontSize: 18, color: "#0a0a0f", background: c }}>{p.overall}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>{p.name} <span style={{ color: "#8888aa", fontSize: 12 }}>{p.club} {p.season}</span></div>
                    </div>
                    {badge && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={badge} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
                    )}
                    <span className="rounded px-1.5 py-0.5 font-body flex-shrink-0" style={{ fontSize: 9, color: c, background: "rgba(255,255,255,0.06)" }}>{p.position}</span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <div className="mb-2 font-body text-center" style={{ fontSize: 13, color: "#ff8a3d" }}>{error}</div>}

          {remaining > 0 ? (
            !slate || spinning ? (
              <button onClick={doSpin} disabled={spinning}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ background: spinning ? "#1a1a2e" : "#00ff87", color: spinning ? "#ffb800" : "#062013", fontSize: 24 }}>
                {spinning ? "SCOUTING…" : `🎰 SCOUT ${nation.nation.toUpperCase()}`}
              </button>
            ) : (
              <div className="text-center font-body py-2" style={{ fontSize: 13, color: "#8888aa" }}>Draft a player to continue</div>
            )
          ) : (
            <button onClick={start} disabled={starting}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
              {starting ? "STARTING…" : "ENTER THE WORLD CUP →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
