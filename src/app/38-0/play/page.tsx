"use client";

/**
 * /38-0/play — the draft loop (slicker, 38-0-inspired).
 *
 * Spin a CLUB × SEASON, see the whole squad as a list, pick any player, then choose
 * which OPEN slot to put them in (Available vs Unavailable, with reasons). A live
 * OVERALL + Attack/Mid/Def/GK breakdown builds as you draft. Repeat x11.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spin, allBuckets, type Spin } from "@/lib/draft/pool";
import {
  loadTeam, saveTeam, openSlots, isComplete, usedPlayerIds, usedPlayerNames, placePlayer,
  type LocalTeam,
} from "@/lib/draft/local";
import { slotsFor } from "@/lib/draft/formations";
import { canPlay, fitMultiplier, lineRatings, posCategory, CATEGORY_COLOR } from "@/lib/draft/score";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { PlayerSeason, Position, Slot } from "@/lib/draft/types";

// Distinct slot-positions in this formation a player can legally fill, best fit first.
function eligiblePositions(player: PlayerSeason, formation: LocalTeam["formation"]): Position[] {
  const seen = new Set<Position>();
  return slotsFor(formation)
    .filter((s) => canPlay(player.position, s.pos))
    .sort((a, b) => fitMultiplier(player.position, b.pos) - fitMultiplier(player.position, a.pos))
    .map((s) => s.pos)
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

export default function DraftPlay() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [current, setCurrent] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);
  const [selected, setSelected] = useState<PlayerSeason | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Club-seasons already offered this draft ("club|season") — fed to spin() so the
  // same squad's options don't keep reappearing for position after position.
  const seenBuckets = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = loadTeam();
    if (!t) { router.replace("/38-0"); return; }
    setTeam(t);
    // Seed the offered-squads memory from the XI so far (resuming a draft keeps it).
    seenBuckets.current = new Set(t.squad.map((p) => `${p.club}|${p.season}`));
    if (isComplete(t)) router.replace("/38-0/team");
  }, [router]);

  useEffect(() => () => { if (reelTimer.current) clearInterval(reelTimer.current); }, []);

  function doSpin() {
    if (!team || spinning) return;
    setSpinning(true);
    setCurrent(null);
    setSelected(null);
    const buckets = allBuckets(team.league);
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season });
      if (++ticks > 13) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        const open = openSlots(team).map((s) => s.pos);
        const result = spin(open, usedPlayerIds(team), usedPlayerNames(team), Math.random, seenBuckets.current, team.league);
        seenBuckets.current.add(`${result.club}|${result.season}`);
        setReel({ club: result.club, season: result.season });
        setCurrent(result);
        setSpinning(false);
      }
    }, 65);
  }

  function placeAt(slot: Slot) {
    if (!team || !selected) return;
    const next = placePlayer(team, selected, slot);
    saveTeam(next);
    setTeam(next);
    setCurrent(null);
    setReel(null);
    setSelected(null);
    if (isComplete(next)) setTimeout(() => router.push("/38-0/team"), 400);
  }

  if (!team) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8a948f" }}>Loading…</div>;
  }

  const expert = team.mode === "expert";
  const remaining = 11 - team.squad.length;
  const lines = lineRatings(team.squad);
  const filledBySlot = new Map(team.squad.map((p) => [p.slot, p]));
  const badge = reel ? getTeamBadgeUrlSync(reel.club) : null;

  // Placement split for the selected player.
  const slots = slotsFor(team.formation);
  const available = selected ? slots.filter((s) => !filledBySlot.has(s.id) && canPlay(selected.position, s.pos)) : [];
  const unavailable = selected ? slots.filter((s) => !available.includes(s)) : [];

  return (
    <div className="min-h-[100dvh] pb-44" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4">
          <Link href="/38-0" className="font-body text-sm" style={{ color: "#8a948f" }}>← Back</Link>
        </div>
        {/* header: formation + overall */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <div className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>FORMATION</div>
            <div className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>{team.formation}</div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>{expert ? "EXPERT" : "OVERALL"}</div>
            <div className="font-display" style={{ fontSize: 38, lineHeight: 1, color: expert ? "#ffb800" : "#aeea00" }}>
              {expert ? "🔒" : team.squad.length ? team.strength : "—"}
            </div>
          </div>
        </div>

        {/* progress */}
        <div className="flex items-center gap-2 mt-3 mb-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(team.squad.length / 11) * 100}%`, background: "#aeea00" }} />
          </div>
          <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>{team.squad.length}/11</span>
        </div>

        <Pitch formation={team.formation} squad={team.squad} hideOverall={expert} compact />

        {/* live line ratings (hidden in expert) */}
        {!expert && team.squad.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {([["ATT", lines.attack, "att"], ["MID", lines.midfield, "mid"], ["DEF", lines.defence, "def"], ["GK", lines.gk, "gk"]] as const).map(([label, val, cat]) => (
              <div key={label} className="rounded-xl px-2 py-2 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-display" style={{ fontSize: 20, color: val ? CATEGORY_COLOR[cat] : "#444" }}>{val || "—"}</div>
                <div className="font-body" style={{ fontSize: 9, color: "#8a948f", letterSpacing: 1 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* spin / squad tray */}
      <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
        <div className="max-w-lg mx-auto px-4 pt-3">
          {/* CLUB × SEASON reels */}
          {(spinning || reel) && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "#0e1611", border: `1px solid ${spinning ? "rgba(255,184,0,0.4)" : "rgba(174,234,0,0.35)"}` }}>
              {badge ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={badge} alt={reel?.club ?? ""} width={46} height={46}
                  style={{ width: 46, height: 46, objectFit: "contain", filter: spinning ? "grayscale(0.3) opacity(0.85)" : "drop-shadow(0 0 10px rgba(174,234,0,0.45))" }} />
              ) : <div style={{ width: 46, height: 46 }} />}
              <div className="flex-1 min-w-0">
                <div className="font-body" style={{ fontSize: 9, color: "#8a948f", letterSpacing: 1 }}>CLUB × SEASON</div>
                <div className="font-display tracking-wide leading-none truncate" style={{ fontSize: 24, color: spinning ? "#ffb800" : "#fff" }}>
                  {reel?.club ?? "—"} {reel?.season && <span style={{ color: "#8a948f", fontSize: 18 }}>{reel.season}</span>}
                </div>
              </div>
            </div>
          )}

          {/* placement panel */}
          {selected && (
            <div className="mb-3 rounded-2xl p-3" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.3)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-body" style={{ fontSize: 14, color: "#fff" }}>Place <b style={{ color: "#aeea00" }}>{selected.name}</b></span>
                <button onClick={() => setSelected(null)} className="font-body" style={{ fontSize: 13, color: "#8a948f" }}>Cancel</button>
              </div>
              <div className="font-body mb-1" style={{ fontSize: 10, color: "#8a948f", letterSpacing: 1 }}>AVAILABLE ({available.length})</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {available.map((s) => {
                  const c = CATEGORY_COLOR[posCategory(s.pos)];
                  return (
                    <button key={s.id} onClick={() => placeAt(s)} className="rounded-lg px-3 py-2 font-display tracking-wide active:scale-95 transition-transform"
                      style={{ fontSize: 14, color: "#0a0a0f", background: c }}>
                      {s.label}
                    </button>
                  );
                })}
                {available.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No open slot fits — pick another player.</span>}
              </div>
              <div className="font-body mb-1" style={{ fontSize: 10, color: "#8a948f", letterSpacing: 1 }}>UNAVAILABLE</div>
              <div className="flex flex-wrap gap-1.5">
                {unavailable.map((s) => {
                  const taken = filledBySlot.get(s.id);
                  return (
                    <span key={s.id} className="rounded-lg px-2 py-1.5 font-body" style={{ fontSize: 11, color: "#666", background: "rgba(255,255,255,0.04)" }}>
                      {s.label} · {taken ? taken.name.split(" ").slice(-1)[0] : "N/A"}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* squad list */}
          {current && !spinning && !selected && (
            <div className="mb-3 rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.07)", maxHeight: 340, overflowY: "auto" }}>
              <div className="px-3 py-2 font-body sticky top-0" style={{ fontSize: 11, color: "#8a948f", background: "#080d0a" }}>
                Pick a player → choose their slot
              </div>
              {current.players.map((p) => {
                const c = CATEGORY_COLOR[posCategory(p.position)];
                const elig = eligiblePositions(p, team.formation);
                const playable = elig.length > 0;
                return (
                  <button key={p.id} onClick={() => playable && setSelected(p)} disabled={!playable}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)", opacity: playable ? 1 : 0.4 }}>
                    <div className="flex items-center justify-center rounded-lg font-display flex-shrink-0"
                      style={{ width: 38, height: 38, fontSize: expert ? 13 : 18, color: "#0a0a0f", background: c }}>
                      {expert ? p.position : p.overall}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>
                        {p.name} <span style={{ color: "#8a948f", fontSize: 12 }}>{p.club} {p.season}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {elig.slice(0, 3).map((pos) => (
                        <span key={pos} className="rounded px-1.5 py-0.5 font-body" style={{ fontSize: 9, color: CATEGORY_COLOR[posCategory(pos)], background: "rgba(255,255,255,0.06)" }}>{pos}</span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* spin button — once you've spun you must draft from that squad (no re-spin) */}
          {remaining > 0 ? (
            !current || spinning ? (
              <button onClick={doSpin} disabled={spinning}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ background: spinning ? "#15211a" : "#aeea00", color: spinning ? "#ffb800" : "#062013", fontSize: 24 }}>
                {spinning ? "SPINNING…" : "🎰 SPIN THE WHEEL"}
              </button>
            ) : (
              <div className="text-center font-body py-2" style={{ fontSize: 13, color: "#8a948f" }}>
                Draft a player from this squad to continue
              </div>
            )
          ) : (
            <button onClick={() => router.push("/38-0/team")}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#aeea00", color: "#062013", fontSize: 24 }}>
              SEE YOUR RECORD →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
