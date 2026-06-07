"use client";

/**
 * /draft/team — your current XI: Strength, projected 38-game record, tier, status,
 * and the loop actions. Quick Match runs a local single-game H2H (the same engine
 * the server uses for real matchmaking) so the win→swap / lose→rebuild loop works
 * end-to-end before cloud matchmaking is wired up.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { BottomNav } from "@/components/ui/BottomNav";
import {
  loadTeam, saveTeam, isComplete, recordWin, recordLoss, saveLastMatch,
  type LocalTeam,
} from "@/lib/draft/local";
import { makeOpponent } from "@/lib/draft/opponent";
import { resolveH2H, seededRng } from "@/lib/draft/score";
import { tierColor, TIER_TAGLINE, strengthPct } from "@/lib/draft/ui";

export default function TeamScreen() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    const t = loadTeam();
    if (!t) { router.replace("/draft"); return; }
    if (!isComplete(t)) { router.replace("/draft/play"); return; }
    setTeam(t);
  }, [router]);

  function quickMatch() {
    if (!team || matching || team.status === "stale") return;
    setMatching(true);
    const matchId = `local-${team.updatedAt}-${Math.floor(Math.random() * 1e6)}`;
    const opp = makeOpponent(team.formation, team.strength);
    // Single-game resolution via the shared, seeded engine.
    const winner = resolveH2H(team.strength, opp.team.strength, seededRng(matchId));
    const youWon = winner === "A";
    const margin = Math.abs(Math.round((team.strength - opp.team.strength) * 10) / 10);

    saveLastMatch({
      id: matchId,
      you: { name: "You", formation: team.formation, squad: team.squad, strength: team.strength, projected: team.projected },
      opp: { name: opp.name, formation: opp.team.formation, squad: opp.team.squad, strength: opp.team.strength, projected: opp.team.projected },
      winner: youWon ? "you" : "opp",
      margin,
      playedAt: Date.now(),
    });

    const next = youWon ? recordWin(team) : recordLoss(team);
    saveTeam(next);
    setTimeout(() => router.push("/draft/match/result"), 450);
  }

  if (!team || !team.projected) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  const p = team.projected;
  const tc = tierColor(p.tier);
  const stale = team.status === "stale";

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-2">
          <Link href="/draft" className="font-body text-sm" style={{ color: "#8888aa" }}>← Draft XI</Link>
          <div className="flex items-center gap-2">
            {team.mode === "expert" && (
              <span className="font-body text-xs px-2.5 py-1 rounded-full" style={{ color: "#ffb800", background: "rgba(255,184,0,0.12)" }}>
                🔒 EXPERT
              </span>
            )}
            <span
              className="font-body text-xs px-2.5 py-1 rounded-full"
              style={{
                color: stale ? "#ff4757" : "#00ff87",
                background: stale ? "rgba(255,71,87,0.12)" : "rgba(0,255,135,0.12)",
              }}
            >
              {stale ? "STALE" : "● AVAILABLE"}
            </span>
          </div>
        </div>

        {/* tier banner */}
        <div className="rounded-3xl p-5 mb-4" style={{ background: `linear-gradient(135deg, ${tc}22, #0f0f17)`, border: `1px solid ${tc}55` }}>
          <div className="font-display tracking-wide leading-none" style={{ fontSize: 40, color: tc }}>{p.tier}</div>
          <div className="font-body mt-1" style={{ fontSize: 13, color: "#cfcfe6" }}>{TIER_TAGLINE[p.tier]}</div>

          <div className="flex items-end justify-between mt-4">
            <div>
              <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>PROJECTED SEASON</div>
              <div className="font-display tracking-wide" style={{ fontSize: 30, color: "#fff" }}>
                {p.wins}-{p.draws}-{p.losses}
              </div>
              <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>
                {p.points} pts · {ordinal(p.position)} place
              </div>
            </div>
            <div className="text-right">
              <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>STRENGTH</div>
              <div className="font-display" style={{ fontSize: 48, color: tc, lineHeight: 1 }}>{team.strength}</div>
            </div>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div className="h-full rounded-full" style={{ width: `${strengthPct(team.strength)}%`, background: tc }} />
          </div>
        </div>

        {team.winStreak > 0 && (
          <div className="text-center mb-4 font-display tracking-wide" style={{ fontSize: 18, color: "#ffb800" }}>
            🔥 {team.winStreak} WIN STREAK
          </div>
        )}

        <Pitch formation={team.formation} squad={team.squad} compact />

        {/* actions */}
        <div className="mt-5 space-y-3">
          {stale ? (
            <>
              <div className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.3)" }}>
                <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#ff4757" }}>TEAM IS STALE</div>
                <div className="font-body mt-1" style={{ fontSize: 13, color: "#cfcfe6" }}>
                  You lost — no swaps. Rebuild a full new XI to challenge again.
                </div>
              </div>
              <button onClick={() => { router.push("/draft"); }}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
                style={{ background: "#ff4757", color: "#fff", fontSize: 24 }}>
                REBUILD XI →
              </button>
            </>
          ) : (
            <>
              <button onClick={quickMatch} disabled={matching}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
                {matching ? "FINDING OPPONENT…" : "QUICK MATCH ⚔️"}
              </button>

              {team.swapAvailable && (
                <Link href="/draft/swap"
                  className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
                  style={{ background: "rgba(255,184,0,0.12)", color: "#ffb800", fontSize: 22, border: "1px solid rgba(255,184,0,0.4)" }}>
                  ⬆ SWAP ONE PLAYER (you earned it)
                </Link>
              )}

              <button onClick={() => router.push("/draft")}
                className="w-full rounded-2xl py-3 font-body active:scale-[0.98] transition-transform"
                style={{ background: "#12121e", color: "#8888aa", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)" }}>
                Start a fresh team
              </button>
            </>
          )}
        </div>

        <p className="font-body text-center mt-5" style={{ color: "#8888aa", fontSize: 12 }}>
          Friend challenges, random matchmaking & global leaderboards unlock when you sign in.
        </p>
      </div>
      <BottomNav />
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
