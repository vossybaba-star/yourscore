"use client";

/**
 * /draft/play — the draft loop. Spin a random (club, season), draft one of its
 * players into the best-fitting open slot, repeat x11. Live Strength preview
 * updates as you build. When the XI is complete, go to the team screen.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { spin, allBuckets, type Spin } from "@/lib/draft/pool";
import {
  loadTeam, saveTeam, openSlots, isComplete, usedPlayerIds, bestOpenSlot,
  placePlayer, type LocalTeam,
} from "@/lib/draft/local";
import { strengthPct } from "@/lib/draft/ui";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { PlayerSeason } from "@/lib/draft/types";

export default function DraftPlay() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [current, setCurrent] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);
  const [justPlaced, setJustPlaced] = useState<string | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = loadTeam();
    if (!t) {
      router.replace("/draft");
      return;
    }
    setTeam(t);
    if (isComplete(t)) router.replace("/draft/team");
  }, [router]);

  function doSpin() {
    if (!team || spinning) return;
    setSpinning(true);
    setCurrent(null);
    const buckets = allBuckets();
    // slot-machine reel
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season });
      ticks++;
      if (ticks > 12) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        const open = openSlots(team).map((s) => s.pos);
        const result = spin(open, usedPlayerIds(team));
        setReel({ club: result.club, season: result.season });
        setCurrent(result);
        setSpinning(false);
      }
    }, 70);
  }

  function draft(player: PlayerSeason) {
    if (!team) return;
    const slot = bestOpenSlot(team, player);
    if (!slot) return;
    const next = placePlayer(team, player, slot);
    saveTeam(next);
    setTeam(next);
    setCurrent(null);
    setReel(null);
    setJustPlaced(`${player.name.split(" ").slice(-1)[0]} → ${slot.label}`);
    setTimeout(() => setJustPlaced(null), 1800);
    if (isComplete(next)) {
      setTimeout(() => router.push("/draft/team"), 600);
    }
  }

  useEffect(() => () => { if (reelTimer.current) clearInterval(reelTimer.current); }, []);

  if (!team) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  const remaining = 11 - team.squad.length;
  const open = openSlots(team);
  const expert = team.mode === "expert";
  const highlight = current && team.squad.length < 11 ? bestOpenSlotForReel(team, current) : null;

  return (
    <div className="min-h-[100dvh] pb-40" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        {/* header / live strength */}
        <div className="flex items-center justify-between pt-4 pb-3">
          <div>
            <div className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>
              {team.formation}
            </div>
            <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>
              {remaining > 0 ? `${remaining} slot${remaining === 1 ? "" : "s"} to fill` : "XI complete"}
            </div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>{expert ? "EXPERT" : "STRENGTH"}</div>
            <div className="font-display" style={{ fontSize: 34, color: expert ? "#ffb800" : "#00ff87", lineHeight: 1 }}>
              {expert ? "🔒" : team.squad.length > 0 ? team.strength : "—"}
            </div>
          </div>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "rgba(255,255,255,0.08)" }}>
          {!expert && (
            <div className="h-full rounded-full transition-all" style={{ width: `${strengthPct(team.strength)}%`, background: "#00ff87" }} />
          )}
        </div>

        <Pitch formation={team.formation} squad={team.squad} highlightSlot={highlight} compact hideOverall={expert} />

        {justPlaced && (
          <div className="text-center mt-3 font-display tracking-wide animate-fade-in" style={{ fontSize: 18, color: "#00ff87" }}>
            ✓ {justPlaced}
          </div>
        )}
      </div>

      {/* spin / draft tray */}
      <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 70%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
        <div className="max-w-lg mx-auto px-4 pt-4">
          {/* reel — the signature spin: club crest + era reveal */}
          {(spinning || reel) && (
            <div
              className="mb-3 rounded-2xl px-4 py-4 flex items-center gap-4"
              style={{
                background: "#12121e",
                border: `1px solid ${spinning ? "rgba(255,184,0,0.4)" : "rgba(0,255,135,0.35)"}`,
                transition: "border-color .2s",
              }}
            >
              {reel && getTeamBadgeUrlSync(reel.club) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getTeamBadgeUrlSync(reel.club)!}
                  alt={reel.club}
                  width={58}
                  height={58}
                  className={spinning ? "" : "animate-fade-in"}
                  style={{
                    width: 58, height: 58, objectFit: "contain",
                    filter: spinning ? "grayscale(0.3) opacity(0.85)" : "drop-shadow(0 0 12px rgba(0,255,135,0.45))",
                    transition: "filter .2s",
                  }}
                />
              ) : (
                <div style={{ width: 58, height: 58 }} />
              )}
              <div className="flex-1 text-left min-w-0">
                <div className="font-display tracking-wide leading-none truncate" style={{ fontSize: 28, color: spinning ? "#ffb800" : "#fff" }}>
                  {reel?.club ?? "—"}
                </div>
                <div className="font-body mt-1" style={{ fontSize: 13, color: "#8888aa" }}>{reel?.season ?? ""}</div>
              </div>
            </div>
          )}

          {/* draftable players */}
          {current && !spinning && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {current.players.map((p) => {
                const slot = bestOpenSlot(team, p);
                return (
                  <button
                    key={p.id}
                    onClick={() => draft(p)}
                    className="flex-shrink-0 rounded-xl p-3 text-left active:scale-95 transition-transform"
                    style={{ width: 130, background: "#1a1a2e", border: `1px solid ${expert ? "rgba(255,184,0,0.3)" : "rgba(0,255,135,0.25)"}` }}
                  >
                    <div className="flex items-baseline justify-between">
                      {expert ? (
                        <span className="font-display" style={{ fontSize: 26, color: "#ffb800" }}>{p.position}</span>
                      ) : (
                        <>
                          <span className="font-display" style={{ fontSize: 26, color: "#00ff87" }}>{p.overall}</span>
                          <span className="font-body px-1.5 py-0.5 rounded" style={{ fontSize: 10, color: "#0a0a0f", background: "#00ff87" }}>{p.position}</span>
                        </>
                      )}
                    </div>
                    <div className="font-body mt-1 leading-tight" style={{ fontSize: 13, color: "#fff" }}>{p.name}</div>
                    <div className="font-body mt-1" style={{ fontSize: 11, color: "#8888aa" }}>
                      → {slot ? slot.label : "—"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {remaining > 0 ? (
            <button
              onClick={doSpin}
              disabled={spinning}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: spinning ? "#1a1a2e" : "#00ff87", color: spinning ? "#ffb800" : "#062013", fontSize: 24 }}
            >
              {spinning ? "SPINNING…" : current ? "SPIN AGAIN ↻" : "SPIN 🎰"}
            </button>
          ) : (
            <button
              onClick={() => router.push("/draft/team")}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}
            >
              SEE YOUR RECORD →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Slot the first draftable player would land in — used to highlight the pitch.
function bestOpenSlotForReel(team: LocalTeam, current: Spin): string | null {
  for (const p of current.players) {
    const s = bestOpenSlot(team, p);
    if (s) return s.id;
  }
  return null;
}
