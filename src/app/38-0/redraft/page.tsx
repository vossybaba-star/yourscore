"use client";

/**
 * /38-0/redraft — post-loss recovery. Redraft any position, but each position
 * gets exactly ONE redraft over the team's lifetime (tracked in
 * team.redraftedSlots). Distinct from /38-0/swap, which is the post-WIN reward
 * (earned per win, any slot). Offered from the loss result screen.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { Button } from "@/components/ui/Button";
import { spin, allBuckets, ensurePool, isPoolReady, type Spin } from "@/lib/draft/pool";
import {
  loadTeam, saveTeam, isComplete, usedPlayerIds, usedPlayerNames, clearSlot, placePlayer, fittingOpenSlots,
  type LocalTeam,
} from "@/lib/draft/local";
import { slotsFor } from "@/lib/draft/formations";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { PlayerSeason } from "@/lib/draft/types";

export default function RedraftScreen() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [phase, setPhase] = useState<"choose" | "spin">("choose");
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);
  const [lockedTap, setLockedTap] = useState(false);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void ensurePool(); // preload the on-demand player pool for the spin
    const t = loadTeam();
    if (!t) { router.replace("/38-0"); return; }
    if (!isComplete(t)) { router.replace("/38-0/play"); return; }
    setTeam(t);
  }, [router]);

  const used = new Set(team?.redraftedSlots ?? []);

  function dropSlot(slotId: string) {
    if (!team) return;
    if (used.has(slotId)) {
      // That position already spent its one redraft — flash the rule.
      setLockedTap(true);
      setTimeout(() => setLockedTap(false), 1600);
      return;
    }
    const next = clearSlot(team, slotId);
    setTeam(next);
    setOpenSlotId(slotId);
    setPhase("spin");
  }

  function doSpin() {
    if (!team || !openSlotId || spinning) return;
    if (!isPoolReady()) { void ensurePool().then(() => doSpin()); return; }
    setSpinning(true);
    setCurrent(null);
    const slot = slotsFor(team.formation).find((s) => s.id === openSlotId)!;
    const buckets = allBuckets(team.league);
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season });
      if (++ticks > 12) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        const result = spin([slot.pos], usedPlayerIds(team), usedPlayerNames(team), Math.random, new Set(), team.league);
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
    const next = {
      ...placePlayer(team, player, slot),
      redraftedSlots: [...(team.redraftedSlots ?? []), slot.id],
    };
    saveTeam(next);
    router.push("/38-0/team");
  }

  useEffect(() => () => { if (reelTimer.current) clearInterval(reelTimer.current); }, []);

  if (!team) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8a948f" }}>Loading…</div>;
  }

  const allUsed = used.size >= team.squad.length;
  const slot = openSlotId ? slotsFor(team.formation).find((s) => s.id === openSlotId) : null;
  const draftable = current?.players.filter((p) => slot && fittingOpenSlots(team, p).some((s) => s.id === slot.id)) ?? [];

  return (
    <div className="min-h-[100dvh] pb-40" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4 pb-2 text-center">
          <div className="font-display tracking-wide" style={{ fontSize: 30, color: "#ffb800" }}>
            {phase === "choose" ? "REDRAFT A POSITION" : `REPLACE: ${slot?.label}`}
          </div>
          <div className="font-body" style={{ fontSize: 13, color: lockedTap ? "#ff8a3d" : "#8a948f" }}>
            {lockedTap
              ? "That position has used its one redraft"
              : phase === "choose"
              ? `One redraft per position, ever — ${used.size ? `${used.size} used, ` : ""}tap who makes way`
              : "Spin and draft a replacement"}
          </div>
        </div>

        {allUsed && phase === "choose" ? (
          <div className="rounded-2xl px-5 py-6 mt-4 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="font-body text-sm text-white">Every position has used its one redraft.</p>
            <p className="font-body text-xs mt-1" style={{ color: "#8a948f" }}>Win matches to earn swaps, or build a fresh XI.</p>
            <Button variant="primary" tone="lime" size="md" fullWidth className="mt-4" href="/38-0/team">
              Back to my team
            </Button>
          </div>
        ) : (
          <Pitch
            formation={team.formation}
            squad={team.squad}
            highlightSlot={openSlotId}
            onSlotClick={phase === "choose" ? dropSlot : undefined}
            compact
          />
        )}
      </div>

      {phase === "spin" && (
        <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 70%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
          <div className="max-w-lg mx-auto px-4 pt-4">
            {(spinning || reel) && (
              <div className="mb-3 rounded-2xl px-4 py-4 flex items-center gap-4" style={{ background: "#0e1611", border: `1px solid ${spinning ? "rgba(255,184,0,0.4)" : "rgba(255,184,0,0.35)"}` }}>
                {reel && getTeamBadgeUrlSync(reel.club) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getTeamBadgeUrlSync(reel.club)!} alt={reel.club} width={58} height={58}
                    style={{ width: 58, height: 58, objectFit: "contain", filter: spinning ? "grayscale(0.3) opacity(0.85)" : "drop-shadow(0 0 12px rgba(255,184,0,0.45))", transition: "filter .2s" }} />
                ) : (<div style={{ width: 58, height: 58 }} />)}
                <div className="flex-1 text-left min-w-0">
                  <div className="font-display tracking-wide leading-none truncate" style={{ fontSize: 28, color: spinning ? "#ffb800" : "#fff" }}>{reel?.club ?? "—"}</div>
                  <div className="font-body mt-1" style={{ fontSize: 13, color: "#8a948f" }}>{reel?.season ?? ""}</div>
                </div>
              </div>
            )}
            {current && !spinning && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                {draftable.map((p) => (
                  <button key={p.id} onClick={() => draft(p)}
                    className="flex-shrink-0 rounded-xl p-3 text-left active:scale-95 transition-transform"
                    style={{ width: 130, background: "#15211a", border: "1px solid rgba(255,184,0,0.3)" }}>
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
                  <div className="font-body py-3 px-2" style={{ fontSize: 13, color: "#8a948f" }}>No fit from that squad — spin again.</div>
                )}
              </div>
            )}
            {!current || spinning ? (
              <Button variant="primary" tone="lime" size="lg" fullWidth onClick={doSpin} disabled={spinning}>
                {spinning ? "SPINNING…" : "SPIN 🎰"}
              </Button>
            ) : (
              <div className="text-center font-body py-2" style={{ fontSize: 13, color: "#8a948f" }}>
                Draft a replacement from this squad
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
