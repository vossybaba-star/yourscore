"use client";

/**
 * /draft/swap — post-win reward. Drop exactly ONE player, re-spin that slot, draft
 * a replacement. Consumes the earned swap. Wins compound: chain them to upgrade
 * into a genuinely scary XI.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spin, allBuckets, type Spin } from "@/lib/draft/pool";
import {
  loadTeam, saveTeam, isComplete, usedPlayerIds, clearSlot, placePlayer, fittingOpenSlots,
  type LocalTeam,
} from "@/lib/draft/local";
import { slotsFor } from "@/lib/draft/formations";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { PlayerSeason } from "@/lib/draft/types";

export default function SwapScreen() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [phase, setPhase] = useState<"choose" | "spin">("choose");
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = loadTeam();
    if (!t) { router.replace("/draft"); return; }
    if (!isComplete(t)) { router.replace("/draft/play"); return; }
    if (!t.swapAvailable) { router.replace("/draft/team"); return; }
    setTeam(t);
  }, [router]);

  function dropSlot(slotId: string) {
    if (!team) return;
    const next = clearSlot(team, slotId);
    setTeam(next);
    setOpenSlotId(slotId);
    setPhase("spin");
  }

  function doSpin() {
    if (!team || !openSlotId || spinning) return;
    setSpinning(true);
    setCurrent(null);
    const slot = slotsFor(team.formation).find((s) => s.id === openSlotId)!;
    const buckets = allBuckets();
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season });
      if (++ticks > 12) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        const result = spin([slot.pos], usedPlayerIds(team));
        setReel({ club: result.club, season: result.season });
        setCurrent(result);
        setSpinning(false);
      }
    }, 70);
  }

  function draft(player: PlayerSeason) {
    if (!team || !openSlotId) return;
    const slot = slotsFor(team.formation).find((s) => s.id === openSlotId)!;
    if (!fittingOpenSlots(team, player).some((s) => s.id === slot.id)) return;
    const next = { ...placePlayer(team, player, slot), swapAvailable: false };
    saveTeam(next);
    router.push("/draft/team");
  }

  useEffect(() => () => { if (reelTimer.current) clearInterval(reelTimer.current); }, []);

  if (!team) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  // when choosing, the open slot for the dropped player is filtered to fitting players on spin
  const slot = openSlotId ? slotsFor(team.formation).find((s) => s.id === openSlotId) : null;
  const draftable = current?.players.filter((p) => slot && fittingOpenSlots(team, p).some((s) => s.id === slot.id)) ?? [];

  return (
    <div className="min-h-[100dvh] pb-40" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4 pb-2 text-center">
          <div className="font-display tracking-wide" style={{ fontSize: 30, color: "#ffb800" }}>
            {phase === "choose" ? "DROP ONE PLAYER" : `REPLACE: ${slot?.label}`}
          </div>
          <div className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>
            {phase === "choose" ? "Tap the player you want to swap out" : "Spin and draft a replacement"}
          </div>
        </div>

        <Pitch
          formation={team.formation}
          squad={team.squad}
          highlightSlot={openSlotId}
          onSlotClick={phase === "choose" ? dropSlot : undefined}
          compact
        />
      </div>

      {phase === "spin" && (
        <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 70%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
          <div className="max-w-lg mx-auto px-4 pt-4">
            {(spinning || reel) && (
              <div className="mb-3 rounded-2xl px-4 py-4 flex items-center gap-4" style={{ background: "#12121e", border: `1px solid ${spinning ? "rgba(255,184,0,0.4)" : "rgba(255,184,0,0.35)"}` }}>
                {reel && getTeamBadgeUrlSync(reel.club) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getTeamBadgeUrlSync(reel.club)!} alt={reel.club} width={58} height={58}
                    style={{ width: 58, height: 58, objectFit: "contain", filter: spinning ? "grayscale(0.3) opacity(0.85)" : "drop-shadow(0 0 12px rgba(255,184,0,0.45))", transition: "filter .2s" }} />
                ) : (<div style={{ width: 58, height: 58 }} />)}
                <div className="flex-1 text-left min-w-0">
                  <div className="font-display tracking-wide leading-none truncate" style={{ fontSize: 28, color: spinning ? "#ffb800" : "#fff" }}>{reel?.club ?? "—"}</div>
                  <div className="font-body mt-1" style={{ fontSize: 13, color: "#8888aa" }}>{reel?.season ?? ""}</div>
                </div>
              </div>
            )}
            {current && !spinning && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                {draftable.map((p) => (
                  <button key={p.id} onClick={() => draft(p)}
                    className="flex-shrink-0 rounded-xl p-3 text-left active:scale-95 transition-transform"
                    style={{ width: 130, background: "#1a1a2e", border: "1px solid rgba(255,184,0,0.3)" }}>
                    <div className="flex items-baseline justify-between">
                      {team.mode === "expert" ? (
                        <span className="font-display" style={{ fontSize: 26, color: "#ffb800" }}>{p.position}</span>
                      ) : (
                        <>
                          <span className="font-display" style={{ fontSize: 26, color: "#ffb800" }}>{p.overall}</span>
                          <span className="font-body px-1.5 py-0.5 rounded" style={{ fontSize: 10, color: "#1a1300", background: "#ffb800" }}>{p.position}</span>
                        </>
                      )}
                    </div>
                    <div className="font-body mt-1 leading-tight" style={{ fontSize: 13, color: "#fff" }}>{p.name}</div>
                  </button>
                ))}
                {draftable.length === 0 && (
                  <div className="font-body py-3 px-2" style={{ fontSize: 13, color: "#8888aa" }}>No fit from that squad — spin again.</div>
                )}
              </div>
            )}
            <button onClick={doSpin} disabled={spinning}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: spinning ? "#1a1a2e" : "#ffb800", color: spinning ? "#ffb800" : "#1a1300", fontSize: 24 }}>
              {spinning ? "SPINNING…" : current ? "SPIN AGAIN ↻" : "SPIN 🎰"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
